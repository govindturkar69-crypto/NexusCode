"""
FastAPI application. Routes live in app/routers; this module wires them up.

Tables are managed by Alembic (alembic/versions). Deploys run
scripts/migrate.py before starting the app; see the Dockerfile.
"""
import logging
import re

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from sqlalchemy import text

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.rate_limit import limiter, rate_limit_exceeded_handler
from app.routers import admin, ai, analytics, auth, chat, files, github, projects, tasks
from app.services.storage import MAX_UPLOAD_BYTES

logger = logging.getLogger("nexuscode")

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
)

for module in (auth, projects, tasks, files, chat, ai, github, analytics, admin):
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
