"""code_file_versions: server-side snapshots of each code file's text

New and empty. Snapshots are written from then on, whenever a save commits
(throttled to one a minute per file, deduplicated by content hash, at most 50
kept per file; see docs/VERSION-HISTORY.md). Nothing is backfilled: a file's
history starts with its next save.

Downgrade drops the table. The files themselves (code_files.content and their
Yjs documents) are untouched; only the history is lost.

Revision ID: 0016_code_file_versions
Revises: 0015_code_file_yjs
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016_code_file_versions"
down_revision: str | Sequence[str] | None = "0015_code_file_yjs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "code_file_versions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("file_id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("content", sa.String(), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("author_user_id", sa.Integer(), nullable=True),
        sa.Column("label", sa.String(length=200), nullable=True),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("source IN ('save', 'autosnapshot', 'restore', 'import')", name="ck_code_file_versions_source"),
        sa.ForeignKeyConstraint(["file_id"], ["code_files.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    # Listing is always "this file, newest first"; project_id scopes every read
    op.create_index("ix_code_file_versions_file_created", "code_file_versions", ["file_id", "created_at"])
    op.create_index(op.f("ix_code_file_versions_project_id"), "code_file_versions", ["project_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_code_file_versions_project_id"), table_name="code_file_versions")
    op.drop_index("ix_code_file_versions_file_created", table_name="code_file_versions")
    op.drop_table("code_file_versions")
