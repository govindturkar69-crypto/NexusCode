"""drop code_runs: code now runs in the browser, so there's nothing to count

0009 stays in the history because it has already run in production. Any rows
only recorded that a run happened, so nothing of value is lost.

Downgrade recreates the empty table. The old counts can't be brought back.

Revision ID: 0010_drop_code_runs
Revises: 0009_code_runs
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010_drop_code_runs"
down_revision: str | Sequence[str] | None = "0009_code_runs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_table("code_runs")


def downgrade() -> None:
    op.create_table(
        "code_runs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_code_runs_id"), "code_runs", ["id"])
    op.create_index(op.f("ix_code_runs_project_id"), "code_runs", ["project_id"])
    op.create_index(op.f("ix_code_runs_user_id"), "code_runs", ["user_id"])
    op.create_index(op.f("ix_code_runs_created_at"), "code_runs", ["created_at"])
