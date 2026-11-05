"""task details: assignee, due date, priority

Backfill: existing tasks get no assignee, no due date and 'medium' priority.
Nothing else changes (description and position already exist).

Revision ID: 0006_task_details
Revises: 0005_project_members
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006_task_details"
down_revision: str | Sequence[str] | None = "0005_project_members"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("tasks") as batch:
        batch.add_column(sa.Column("assignee_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("due_date", sa.Date(), nullable=True))
        batch.add_column(sa.Column("priority", sa.String(), server_default="medium", nullable=False))
        batch.create_foreign_key("fk_tasks_assignee_id_users", "users", ["assignee_id"], ["id"], ondelete="SET NULL")
        batch.create_check_constraint("ck_tasks_priority", "priority IN ('low', 'medium', 'high')")
        batch.create_index("ix_tasks_assignee_id", ["assignee_id"])


def downgrade() -> None:
    with op.batch_alter_table("tasks") as batch:
        batch.drop_index("ix_tasks_assignee_id")
        batch.drop_constraint("ck_tasks_priority", type_="check")
        batch.drop_constraint("fk_tasks_assignee_id_users", type_="foreignkey")
        batch.drop_column("priority")
        batch.drop_column("due_date")
        batch.drop_column("assignee_id")
