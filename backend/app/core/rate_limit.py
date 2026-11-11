"""
Request rate limits (slowapi). Counters live in process memory, which is
right for a single instance; several instances would need a shared store
(e.g. Limiter(storage_uri="redis://...")).

Behind Render's proxy the client IP comes from X-Forwarded-For, so uvicorn
runs with --proxy-headers (see Dockerfile).
"""
from fastapi import Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.core.security import decode_access_token

LOGIN_LIMIT = "5/minute"
SIGNUP_LIMIT = "3/hour"
AI_LIMIT = "10/minute"
# One agent run is up to 8 steps, plus retries; starting a run uses AI_LIMIT
AGENT_STEP_LIMIT = "30/minute"
TEST_EMAIL_LIMIT = "3/hour"
# Per IP. Small, because each request can send an email
RESET_REQUEST_LIMIT = "5/hour"
RESET_CONFIRM_LIMIT = "10/hour"
OAUTH_LIMIT = "20/minute"
# WebSocket tickets are cheap (sign a JWT, one membership read), but a client
# fetches one per connect/reconnect. 60/min/user is far above any real reconnect
# burst (a handful of open files plus chat) and far below a flood.
WS_TICKET_LIMIT = "60/minute"


def user_or_ip(request: Request) -> str:
    """Per-user key for authenticated routes, falling back to the client IP."""
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        username = decode_access_token(header[7:])
        if username:
            return f"user:{username}"
    return f"ip:{get_remote_address(request)}"


limiter = Limiter(key_func=get_remote_address)


async def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    """Same {"detail": ...} shape as every other error, plus Retry-After."""
    window_seconds = exc.limit.limit.get_expiry()
    return JSONResponse(
        status_code=429,
        content={"detail": f"Too many requests ({exc.detail}). Please wait and try again."},
        headers={"Retry-After": str(window_seconds)},
    )
