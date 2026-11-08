"""agent_runs: one row per run of the coding agent

New and empty, so nothing to backfill. Each row keeps a run's Gemini conversation
while it's going (cleared when it ends), the limits it has used, and what happened,
which is also what the daily quotas count.

Downgrade drops the table and the runs' history with it.

Revision ID: 0014_agent_runs
Revises: 0013_oauth_identities
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014_agent_runs"
down_revision: str | Sequence[str] | None = "0013_oauth_identities"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "agent_runs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("goal", sa.Text(), nullable=False),
        sa.Column("status", sa.String(), server_default="running", nullable=False),
        sa.Column("phase", sa.String(), server_default="ready", nullable=False),
        sa.Column("steps", sa.Integer(), server_default="0", nullable=False),
        sa.Column("tokens", sa.Integer(), server_default="0", nullable=False),
        sa.Column("nonce", sa.String(), nullable=False),
        sa.Column("history", sa.Text(), nullable=True),
        sa.Column("pending_calls", sa.Text(), nullable=True),
        sa.Column("failure_hash", sa.String(), nullable=True),
        sa.Column("failure_streak", sa.Integer(), server_default="0", nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("stop_reason", sa.String(), nullable=True),
        sa.Column("changes_accepted", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('running', 'finished', 'stopped', 'capped', 'stuck', 'failed')", name="ck_agent_runs_status"
        ),
        sa.CheckConstraint("phase IN ('ready', 'thinking')", name="ck_agent_runs_phase"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_agent_runs_id"), "agent_runs", ["id"])
    op.create_index(op.f("ix_agent_runs_project_id"), "agent_runs", ["project_id"])
    op.create_index(op.f("ix_agent_runs_user_id"), "agent_runs", ["user_id"])
    op.create_index(op.f("ix_agent_runs_created_at"), "agent_runs", ["created_at"])


def downgrade() -> None:
    op.drop_table("agent_runs")
