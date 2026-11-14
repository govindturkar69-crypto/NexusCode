import threading
import time

from google import genai
from google.genai import errors

from app.core.config import settings

# Shown to users (as a 503) when no Gemini key is set. It names no key or value.
AI_NOT_CONFIGURED = "AI is not configured"


class AINotConfiguredError(Exception):
    """No Gemini API key is set, so the AI features are off. main.py turns this
    into a 503 with AI_NOT_CONFIGURED for every route."""

    def __init__(self) -> None:
        super().__init__(AI_NOT_CONFIGURED)


def resolve_agent_api_key() -> str | None:
    """The key the coding agent uses: its own AGENT_GEMINI_API_KEY when set, else
    the shared GEMINI_API_KEY. Kept separate so the agent's small daily quota
    doesn't eat into Explain / Find bugs / Generate docs."""
    return settings.agent_gemini_api_key or settings.gemini_api_key


def is_configured() -> bool:
    """Can the AI assistant (generate, review, docs, streaming, task ideas) run?"""
    return bool(settings.gemini_api_key)


def agent_is_configured() -> bool:
    return bool(resolve_agent_api_key())


# Clients are made on first use, not at import: genai.Client refuses an empty key,
# and the app must start (and /health answer) without one. One client per key, so
# the agent gets its own when AGENT_GEMINI_API_KEY is set, and the same one as the
# assistant when it isn't (the behaviour before this was lazy).
_clients: dict[str, genai.Client] = {}
_clients_lock = threading.Lock()


def _client_for(key: str | None) -> genai.Client:
    if not key:
        raise AINotConfiguredError()
    with _clients_lock:
        client = _clients.get(key)
        if client is None:
            client = _clients[key] = genai.Client(api_key=key)
        return client


def get_client() -> genai.Client:
    """The assistant's Gemini client. Raises AINotConfiguredError without a key."""
    return _client_for(settings.gemini_api_key)


def get_agent_client() -> genai.Client:
    """The agent's Gemini client (AGENT_GEMINI_API_KEY, else GEMINI_API_KEY)."""
    return _client_for(resolve_agent_api_key())


MODEL_NAME = "gemini-2.5-flash"


class AIQuotaExceededError(Exception):
    """Raised when Gemini's free-tier daily quota is exhausted."""
    pass


class AIServiceBusyError(Exception):
    """Raised when Gemini is temporarily overloaded but should work again soon."""
    pass


def _generate_with_retry(prompt: str, max_retries: int = 3, config=None) -> str:
    client = get_client()  # AINotConfiguredError before any attempt
    extra = {"config": config} if config is not None else {}
    last_error = None
    for _attempt in range(max_retries):
        try:
            response = client.models.generate_content(model=MODEL_NAME, contents=prompt, **extra)
            return response.text
        except errors.ClientError as e:
            # 429 = quota exceeded — retrying won't help, fail immediately with a clear message
            if e.code == 429:
                raise AIQuotaExceededError(
                    "The AI service's free daily quota has been reached. Please try again tomorrow."
                ) from e
            raise
        except errors.ServerError as e:
            # 503 = temporarily overloaded — worth retrying a few times
            last_error = e
            time.sleep(2)

    raise AIServiceBusyError(
        "The AI service is temporarily busy. Please try again in a moment."
    ) from last_error


def generate_code(prompt: str) -> str:
    full_prompt = f"""You are a helpful coding assistant. Generate clean, working code based on this request:

{prompt}

Only return the code itself, with brief comments if helpful. Do not include lengthy explanations outside the code."""
    return _generate_with_retry(full_prompt)


def detect_bugs(code: str) -> str:
    full_prompt = f"""You are a code reviewer. Analyze the following code for bugs, potential issues, or bad practices. List each issue clearly with a brief explanation. If there are no issues, say so.

Code:
{code}"""
    return _generate_with_retry(full_prompt)


def generate_docs(code: str) -> str:
    full_prompt = f"""You are a technical writer. Write clear, concise documentation for the following code. Explain what it does, its parameters/inputs, and what it returns, in Markdown format.

Code:
{code}"""
    return _generate_with_retry(full_prompt)
