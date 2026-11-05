"""
Runs user code on Judge0. User code never runs on this server: it's sent to
Judge0's sandbox, with no network and with time and memory limits.
"""
import base64

import httpx

from app.core.config import settings

REQUEST_TIMEOUT_SECONDS = 30
CPU_LIMIT_SECONDS = 5
WALL_LIMIT_SECONDS = 10
# The JVM can't start with much less
MEMORY_LIMIT_KB = 256_000
MAX_OUTPUT_CHARS = 64_000

# Monaco language id -> (Judge0 CE language id, name shown to users)
LANGUAGES = {
    "python": (71, "Python"),
    "javascript": (63, "JavaScript"),
    "typescript": (74, "TypeScript"),
    "java": (62, "Java"),
    "c": (50, "C"),
    "cpp": (54, "C++"),
    "csharp": (51, "C#"),
    "go": (60, "Go"),
    "rust": (73, "Rust"),
    "ruby": (72, "Ruby"),
    "php": (68, "PHP"),
    "shell": (46, "Bash"),
}

STATUS_ACCEPTED = 3
STATUS_TIMED_OUT = 5
# Still queued or running: Judge0 didn't finish within its wait
STATUS_NOT_FINISHED = (1, 2)
# Judge0's own failures, which aren't the fault of the user's code
STATUS_INTERNAL_ERROR = 13
STATUS_EXEC_FORMAT_ERROR = 14


class RunnerUnavailableError(Exception):
    """The run couldn't happen. The message is safe to show to users."""


class RunnerQuotaError(Exception):
    """Judge0's own limit has been reached."""


def is_configured() -> bool:
    return bool(settings.judge0_api_key)


def _encode(text: str) -> str:
    return base64.b64encode(text.encode("utf-8", "replace")).decode()


def _decode(value: str | None) -> tuple[str, bool]:
    """Decoded text, and whether it had to be cut short."""
    if not value:
        return "", False
    text = base64.b64decode(value).decode("utf-8", "replace")
    if len(text) > MAX_OUTPUT_CHARS:
        return text[:MAX_OUTPUT_CHARS], True
    return text, False


def run_code(language: str, source: str, stdin: str = "") -> dict:
    language_id, _ = LANGUAGES[language]
    try:
        response = httpx.post(
            f"{settings.judge0_api_url.rstrip('/')}/submissions",
            params={
                "base64_encoded": "true",
                "wait": "true",
                "fields": "stdout,stderr,compile_output,message,status,time,memory,exit_code",
            },
            headers={
                "X-RapidAPI-Key": settings.judge0_api_key,
                "X-RapidAPI-Host": settings.judge0_api_host,
                "Content-Type": "application/json",
            },
            json={
                "language_id": language_id,
                "source_code": _encode(source),
                "stdin": _encode(stdin),
                "cpu_time_limit": CPU_LIMIT_SECONDS,
                "wall_time_limit": WALL_LIMIT_SECONDS,
                "memory_limit": MEMORY_LIMIT_KB,
                "enable_network": False,
            },
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as e:
        raise RunnerUnavailableError("Could not reach the code runner. Please try again.") from e

    if response.status_code == 429:
        raise RunnerQuotaError("The code runner's limit has been reached. Please try again later.")
    if response.status_code in (401, 403):
        raise RunnerUnavailableError("The code runner rejected this server's key. The site owner needs to check it.")
    if not response.is_success:
        raise RunnerUnavailableError("The code runner had a problem. Please try again.")

    try:
        data = response.json()
        status = data["status"]
        status_id = status["id"]
        stdout, stdout_cut = _decode(data.get("stdout"))
        stderr, stderr_cut = _decode(data.get("stderr"))
        compile_output, compile_cut = _decode(data.get("compile_output"))
    except (ValueError, KeyError, TypeError) as e:
        raise RunnerUnavailableError("The code runner sent a reply that couldn't be read. Please try again.") from e

    if status_id in STATUS_NOT_FINISHED:
        raise RunnerUnavailableError("The code runner is busy. Please try again in a moment.")
    if status_id in (STATUS_INTERNAL_ERROR, STATUS_EXEC_FORMAT_ERROR):
        raise RunnerUnavailableError("The code runner had a problem. Please try again.")

    return {
        "status": status.get("description") or "Unknown",
        "succeeded": status_id == STATUS_ACCEPTED,
        "timed_out": status_id == STATUS_TIMED_OUT,
        "stdout": stdout,
        "stderr": stderr,
        "compile_output": compile_output,
        "exit_code": data.get("exit_code"),
        "time_seconds": float(data["time"]) if data.get("time") else None,
        "memory_kb": data.get("memory"),
        "truncated": stdout_cut or stderr_cut or compile_cut,
    }
