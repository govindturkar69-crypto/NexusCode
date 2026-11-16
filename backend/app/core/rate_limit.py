"""
Request rate limits (slowapi). Counters live in process memory, which is
right for a single instance; several instances would need a shared store
(e.g. Limiter(storage_uri="redis://...")).

Per-IP limits key on app.core.client_ip.rate_limit_key: the X-Forwarded-For
entry TRUSTED_PROXY_HOPS places from the right (the address Render's proxy
saw), never one the caller wrote.
"""
from fastapi import Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded

from app.core.client_ip import limiter_key
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
# A meeting token is fetched once per Join click (LiveKit reconnects reuse it)
MEETING_TOKEN_LIMIT = "20/minute"
# Restoring a file version rewrites content for everyone in the file
RESTORE_LIMIT = "10/minute"
# Per user. Each upload goes to the one shared Cloudinary account (review M3)
UPLOAD_LIMIT = "30/minute"


def user_or_ip(request: Request) -> str:
    """Per-user key for authenticated routes, falling back to the client IP."""
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        username = decode_access_token(header[7:])
        if username:
            return f"user:{username}"
    return f"ip:{limiter_key(request)}"


limiter = Limiter(key_func=limiter_key)


async def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    """Same {"detail": ...} shape as every other error, plus Retry-After."""
    window_seconds = exc.limit.limit.get_expiry()
    return JSONResponse(
        status_code=429,
        content={"detail": f"Too many requests ({exc.detail}). Please wait and try again."},
        headers={"Retry-After": str(window_seconds)},
    )
