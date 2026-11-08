"""users.email and users.email_verified

Existing users get no email (NULL) and email_verified false; they can add one
in Settings. Emails are stored lowercased, which a check constraint enforces, so
the unique constraint is case-insensitive in effect. Several NULLs are allowed.

Revision ID: 0011_user_email
Revises: 0010_drop_code_runs
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011_user_email"
down_revision: str | Sequence[str] | None = "0010_drop_code_runs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("email", sa.String(), nullable=True))
        batch.add_column(sa.Column("email_verified", sa.Boolean(), server_default=sa.false(), nullable=False))
        batch.create_unique_constraint("uq_users_email", ["email"])
        batch.create_check_constraint("ck_users_email_lowercase", "email = lower(email)")


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_constraint("ck_users_email_lowercase", type_="check")
        batch.drop_constraint("uq_users_email", type_="unique")
        batch.drop_column("email_verified")
        batch.drop_column("email")
