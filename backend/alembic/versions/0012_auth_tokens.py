"""token_version on users, and auth_tokens for password reset and email verification

token_version starts at 0 for everyone. Login tokens issued before this
migration carry no version and count as 0, so nobody is logged out by the deploy;
the first password reset or change then ends every older session.

auth_tokens is new and empty. Only a SHA-256 hash of each token is stored.

Revision ID: 0012_auth_tokens
Revises: 0011_user_email
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012_auth_tokens"
down_revision: str | Sequence[str] | None = "0011_user_email"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("token_version", sa.Integer(), server_default="0", nullable=False))

    op.create_table(
        "auth_tokens",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("purpose", sa.String(), nullable=False),
        sa.Column("token_hash", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("purpose IN ('password_reset', 'verify_email')", name="ck_auth_tokens_purpose"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash", name="uq_auth_tokens_token_hash"),
    )
    op.create_index(op.f("ix_auth_tokens_id"), "auth_tokens", ["id"])
    op.create_index(op.f("ix_auth_tokens_user_id"), "auth_tokens", ["user_id"])


def downgrade() -> None:
    op.drop_table("auth_tokens")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("token_version")
