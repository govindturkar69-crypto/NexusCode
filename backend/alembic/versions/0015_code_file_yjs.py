"""code_file_yjs: each code file's live-editing (Yjs) document

New and empty. Existing files are backfilled lazily: the first time a file is
opened for live editing, its code_files.content becomes the start of its Yjs
document, which is then saved here. code_files.content stays the text everything
else reads, and is kept in sync with the document.

Downgrade drops the table. The text is safe in code_files.content; only the
editing history is lost, so browsers still holding an old document start afresh.

Revision ID: 0015_code_file_yjs
Revises: 0014_agent_runs
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015_code_file_yjs"
down_revision: str | Sequence[str] | None = "0014_agent_runs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "code_file_yjs",
        sa.Column("code_file_id", sa.Integer(), nullable=False),
        sa.Column("state", sa.LargeBinary(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["code_file_id"], ["code_files.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("code_file_id"),
    )


def downgrade() -> None:
    op.drop_table("code_file_yjs")
