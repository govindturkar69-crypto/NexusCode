import os
import time
from dotenv import load_dotenv
from google import genai
from google.genai import errors

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
client = genai.Client(api_key=GEMINI_API_KEY)

MODEL_NAME = "gemini-2.5-flash"


class AIQuotaExceededError(Exception):
    """Raised when Gemini's free-tier daily quota is exhausted."""
    pass


class AIServiceBusyError(Exception):
    """Raised when Gemini is temporarily overloaded but should work again soon."""
    pass


def _generate_with_retry(prompt: str, max_retries: int = 3) -> str:
    last_error = None
    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(model=MODEL_NAME, contents=prompt)
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