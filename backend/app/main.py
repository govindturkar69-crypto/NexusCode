"""
FastAPI application. Routes live in app/routers; this module wires them up.

Tables are managed by Alembic (alembic/versions). Deploys run
scripts/migrate.py before starting the app; see the Dockerfile.
"""
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.config import settings
from app.core.database import SessionLocal
from app.routers import admin, ai, analytics, auth, chat, files, github, projects, tasks

logger = logging.getLogger("nexuscode")

app = FastAPI(title="NexusCode API")

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
