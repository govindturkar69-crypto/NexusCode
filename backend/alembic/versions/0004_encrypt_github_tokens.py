"""encrypt stored GitHub tokens

Encrypts every plaintext users.github_token with GITHUB_TOKEN_ENC_KEY (the
first key if several are given). Rows that are already encrypted are left
alone, so running it twice is harmless. The column type doesn't change.

Requires GITHUB_TOKEN_ENC_KEY in the environment when any token exists.
Keep that key: tokens can't be decrypted without it (users would have to
reconnect GitHub).

Revision ID: 0004_encrypt_github_tokens
Revises: 0003_file_metadata
"""
import os
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from cryptography.fernet import Fernet, MultiFernet

revision: str = "0004_encrypt_github_tokens"
down_revision: str | Sequence[str] | None = "0003_file_metadata"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PREFIX = "enc:v1:"


def _fernet() -> MultiFernet:
    keys = os.environ.get("GITHUB_TOKEN_ENC_KEY", "")
    parts = [k.strip() for k in keys.split(",") if k.strip()]
    if not parts:
        # Fall back to the app settings (which also read backend/.env)
        from app.core.config import settings

        parts = [k.strip() for k in settings.github_token_enc_key.split(",") if k.strip()]
    return MultiFernet([Fernet(k.encode()) for k in parts])


def _rows(conn):
    return conn.execute(sa.text("SELECT id, github_token FROM users WHERE github_token IS NOT NULL")).all()


def upgrade() -> None:
    conn = op.get_bind()
    rows = [r for r in _rows(conn) if not r.github_token.startswith(PREFIX)]
    if not rows:
        return
    fernet = _fernet()
    for row in rows:
        encrypted = PREFIX + fernet.encrypt(row.github_token.encode()).decode()
        conn.execute(sa.text("UPDATE users SET github_token = :t WHERE id = :id"), {"t": encrypted, "id": row.id})


def downgrade() -> None:
    conn = op.get_bind()
    rows = [r for r in _rows(conn) if r.github_token.startswith(PREFIX)]
    if not rows:
        return
    fernet = _fernet()
    for row in rows:
        plain = fernet.decrypt(row.github_token[len(PREFIX):].encode()).decode()
        conn.execute(sa.text("UPDATE users SET github_token = :t WHERE id = :id"), {"t": plain, "id": row.id})
