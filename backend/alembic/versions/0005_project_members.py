"""project members: who can access a project, and with which role

Backfill: every existing project's owner_id gets an 'owner' row, so nobody
loses access. projects.owner_id stays (it records the creator) but no longer
grants access by itself.

Revision ID: 0005_project_members
Revises: 0004_encrypt_github_tokens
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005_project_members"
down_revision: str | Sequence[str] | None = "0004_encrypt_github_tokens"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "project_members",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("role IN ('owner', 'editor', 'viewer')", name="ck_project_members_role"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "user_id", name="uq_project_members_project_user"),
    )
    op.create_index(op.f("ix_project_members_id"), "project_members", ["id"])
    op.create_index(op.f("ix_project_members_project_id"), "project_members", ["project_id"])
    op.create_index(op.f("ix_project_members_user_id"), "project_members", ["user_id"])
    op.execute("INSERT INTO project_members (project_id, user_id, role) SELECT id, owner_id, 'owner' FROM projects")


def downgrade() -> None:
    op.drop_table("project_members")
