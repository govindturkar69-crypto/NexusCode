"""oauth_identities, and accounts without a password

Accounts created through Google or GitHub have no password until they set one,
so users.hashed_password becomes nullable. Every existing user keeps theirs.
oauth_identities is new and empty.

Downgrade: rows with no password would break the old NOT NULL rule, so it stops
with an error naming how many there are instead of deleting accounts.

Revision ID: 0013_oauth_identities
Revises: 0012_auth_tokens
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013_oauth_identities"
down_revision: str | Sequence[str] | None = "0012_auth_tokens"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.alter_column("hashed_password", existing_type=sa.String(), nullable=True)

    op.create_table(
        "oauth_identities",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("provider_user_id", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("provider IN ('google', 'github')", name="ck_oauth_identities_provider"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider", "provider_user_id", name="uq_oauth_identities_provider_user"),
        sa.UniqueConstraint("user_id", "provider", name="uq_oauth_identities_user_provider"),
    )
    op.create_index(op.f("ix_oauth_identities_id"), "oauth_identities", ["id"])
    op.create_index(op.f("ix_oauth_identities_user_id"), "oauth_identities", ["user_id"])


def downgrade() -> None:
    bind = op.get_bind()
    without = bind.execute(sa.text("SELECT count(*) FROM users WHERE hashed_password IS NULL")).scalar()
    if without:
        raise RuntimeError(
            f"{without} account(s) have no password (they sign in with Google or GitHub only). "
            "They must set a password, or be removed, before this migration can be undone."
        )
    op.drop_table("oauth_identities")
    with op.batch_alter_table("users") as batch:
        batch.alter_column("hashed_password", existing_type=sa.String(), nullable=False)
