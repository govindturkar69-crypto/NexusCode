"""schema improvements: FK indexes, timestamps, messages.user_id, tasks.position, files.public_id

Backfill-safe on a live database:
- created_at / updated_at are added with DEFAULT now(), so existing rows get
  the migration time (the real creation time was never recorded).
- messages.user_id is filled from the existing username; the username column
  stays for old rows and display.
- tasks.position starts as the task id, which keeps today's order.
- files.public_id stays NULL for old uploads: they were stored under the bare
  filename, which collided across users, so guessing it could later delete
  someone else's file.

Revision ID: 0002_schema_improvements
Revises: 0001_baseline
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_schema_improvements"
down_revision: str | Sequence[str] | None = "0001_baseline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TIMESTAMPED_TABLES = ("users", "projects", "tasks", "files", "messages", "code_files")
FK_INDEXES = {
    "ix_projects_owner_id": ("projects", "owner_id"),
    "ix_tasks_project_id": ("tasks", "project_id"),
    "ix_files_project_id": ("files", "project_id"),
    "ix_messages_project_id": ("messages", "project_id"),
    # code_files.project_id already has a unique constraint (which is indexed)
}


def upgrade() -> None:
    # Timestamps. batch_alter_table is a plain ALTER on Postgres and a table
    # rebuild on SQLite (which can't add a column with a non-constant default).
    for table in TIMESTAMPED_TABLES:
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
            batch.add_column(sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))

    for name, (table, column) in FK_INDEXES.items():
        op.create_index(name, table, [column])

    with op.batch_alter_table("messages") as batch:
        batch.add_column(sa.Column("user_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_messages_user_id_users", "users", ["user_id"], ["id"], ondelete="SET NULL")
        batch.create_index("ix_messages_user_id", ["user_id"])
    op.execute(
        "UPDATE messages SET user_id = (SELECT users.id FROM users WHERE users.username = messages.username) "
        "WHERE user_id IS NULL"
    )

    with op.batch_alter_table("tasks") as batch:
        batch.add_column(sa.Column("position", sa.Integer(), server_default="0", nullable=False))
    op.execute("UPDATE tasks SET position = id")

    with op.batch_alter_table("files") as batch:
        batch.add_column(sa.Column("public_id", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("files") as batch:
        batch.drop_column("public_id")
    with op.batch_alter_table("tasks") as batch:
        batch.drop_column("position")
    with op.batch_alter_table("messages") as batch:
        batch.drop_index("ix_messages_user_id")
        batch.drop_constraint("fk_messages_user_id_users", type_="foreignkey")
        batch.drop_column("user_id")
    for name, (table, _column) in FK_INDEXES.items():
        op.drop_index(name, table_name=table)
    for table in TIMESTAMPED_TABLES:
        with op.batch_alter_table(table) as batch:
            batch.drop_column("updated_at")
            batch.drop_column("created_at")
