"""
All configuration, read once from environment variables (and backend/.env
for local development). Real environment variables win over .env.
"""
from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]

DEV_ORIGINS = ("http://localhost:5173", "http://127.0.0.1:5173")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    # Required: there are deliberately no defaults for these
    jwt_secret: str = Field(min_length=1)
    # Where the React app lives (CORS + redirect after GitHub OAuth)
    frontend_url: str = Field(min_length=1)

    # Database: DATABASE_URL, or the individual DB_* variables
    database_url: str | None = None
    db_host: str = "localhost"
    db_port: int = 5432
    db_name: str = "college_project_db"
    db_user: str = "postgres"
    db_password: str | None = None
    db_sslmode: str | None = None

    gemini_api_key: str | None = None

    cloudinary_cloud_name: str | None = None
    cloudinary_api_key: str | None = None
    cloudinary_api_secret: str | None = None

    github_client_id: str | None = None
    github_client_secret: str | None = None
    github_redirect_uri: str | None = None
    # Required: Fernet key(s) for encrypting stored GitHub tokens (app/core/crypto.py)
    github_token_enc_key: str = Field(min_length=1)

    @field_validator("frontend_url")
    @classmethod
    def strip_trailing_slash(cls, value: str) -> str:
        return value.rstrip("/")

    @property
    def cors_origins(self) -> list[str]:
        return list(dict.fromkeys([self.frontend_url, *DEV_ORIGINS]))


@lru_cache
def get_settings() -> Settings:
    try:
        return Settings()
    except Exception as e:
        # Same fail-fast message style as before, naming the missing variables
        missing = [err["loc"][0].upper() for err in getattr(e, "errors", lambda: [])() if err.get("type") in ("missing", "string_too_short")]
        if missing:
            raise RuntimeError(
                f"Missing required environment variable(s): {', '.join(missing)}. "
                "JWT_SECRET: python -c \"import secrets; print(secrets.token_urlsafe(64))\"; "
                "FRONTEND_URL: e.g. http://localhost:5173; "
                "GITHUB_TOKEN_ENC_KEY: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
            ) from None
        raise


settings = get_settings()
