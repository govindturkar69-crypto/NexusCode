"""
FastAPI application. Routes live in app/routers; this module wires them up.

Tables are managed by Alembic (alembic/versions). Deploys run
scripts/migrate.py before starting the app; see the Dockerfile.
"""
import logging
import re
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from sqlalchemy import text

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.observability import configure_logging, init_sentry
from app.core.rate_limit import limiter, rate_limit_exceeded_handler
from app.routers import (
    activity,
    admin,
    ai,
    analytics,
    auth,
    chat,
    files,
    github,
    members,
    projects,
    tasks,
)
from app.services.storage import MAX_UPLOAD_BYTES

configure_logging(settings.log_level, settings.log_format)
SENTRY_ENABLED = init_sentry(settings.sentry_dsn, settings.sentry_environment, settings.sentry_traces_sample_rate)

logger = logging.getLogger("nexuscode")
access_logger = logging.getLogger("nexuscode.access")

app = FastAPI(title="NexusCode API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

UPLOAD_PATH = re.compile(r"^/projects/\d+/files$")
# Multipart framing adds a little on top of the file itself
UPLOAD_BODY_LIMIT = MAX_UPLOAD_BYTES + 64 * 1024


# Registered before CORS so CORS wraps it and these errors still carry CORS headers
@app.middleware("http")
async def limit_upload_size(request: Request, call_next):
    """Rejects oversized uploads from the header, before the body is read.
    FastAPI would otherwise receive and spool the whole body first."""
    if request.method == "POST" and UPLOAD_PATH.match(request.url.path):
        length = request.headers.get("content-length")
        if length is None:
            return JSONResponse(status_code=411, content={"detail": "Content-Length is required for uploads."})
        if not length.isdigit():
            return JSONResponse(status_code=400, content={"detail": "Invalid Content-Length."})
        if int(length) > UPLOAD_BODY_LIMIT:
            return JSONResponse(status_code=413, content={"detail": "Files can be at most 10 MB."})
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)

REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9-]{1,64}$")


# Registered last, so it is the outermost middleware and sees every response
@app.middleware("http")
async def log_requests(request: Request, call_next):
    """One structured log line per request, tagged with a request id that is
    also returned as X-Request-ID (and attached to Sentry events). Query
    strings are never logged, so tickets and codes don't end up in logs."""
    incoming = request.headers.get("x-request-id", "")
    request_id = incoming if REQUEST_ID_PATTERN.fullmatch(incoming) else uuid.uuid4().hex
    if SENTRY_ENABLED:
        import sentry_sdk

        sentry_sdk.set_tag("request_id", request_id)

    context = {"request_id": request_id, "method": request.method, "path": request.url.path}
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        access_logger.exception("Unhandled error", extra={**context, "status": 500})
        raise
    duration_ms = round((time.perf_counter() - start) * 1000, 1)
    response.headers["X-Request-ID"] = request_id
    # Health checks run every 30 s; keep them out of the normal log level
    level = logging.DEBUG if request.url.path == "/health" else logging.INFO
    access_logger.log(level, "request", extra={**context, "status": response.status_code, "duration_ms": duration_ms})
    return response

for module in (auth, projects, members, tasks, files, chat, ai, github, activity, analytics, admin):
    app.include_router(module.router)


@app.get("/", include_in_schema=False)
def read_root():
    return {"message": "Hello! Your FastAPI server is running."}


@app.get("/health", tags=["meta"])
def health():
    """Liveness + database check for Docker HEALTHCHECK and Render health checks."""
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
    except Exception:
        logger.exception("Health check: database unreachable")
        return JSONResponse(status_code=503, content={"status": "error", "database": "unreachable"})
    return {"status": "ok", "database": "ok"}
