"""activity feed and in-app notifications

Two new empty tables; existing data is untouched and nothing is backfilled
(the feed starts from this deploy).

Revision ID: 0007_activity_notifications
Revises: 0006_task_details
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_activity_notifications"
down_revision: str | Sequence[str] | None = "0006_task_details"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "activity",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("target", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_activity_id"), "activity", ["id"])
    op.create_index(op.f("ix_activity_project_id"), "activity", ["project_id"])
    op.create_index(op.f("ix_activity_user_id"), "activity", ["user_id"])

    op.create_table(
        "notifications",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("message", sa.String(), nullable=False),
        sa.Column("is_read", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("kind IN ('assigned', 'added', 'role_changed')", name="ck_notifications_kind"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_notifications_id"), "notifications", ["id"])
    op.create_index(op.f("ix_notifications_project_id"), "notifications", ["project_id"])
    op.create_index(op.f("ix_notifications_user_id"), "notifications", ["user_id"])


def downgrade() -> None:
    op.drop_table("notifications")
    op.drop_table("activity")
