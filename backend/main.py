"""Compatibility entry point so `uvicorn main:app` keeps working. The app lives in app/main.py."""
from app.main import app  # noqa: F401
