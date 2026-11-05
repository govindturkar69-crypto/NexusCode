"""multi-file projects: code_files gets a path, one project can have many files

Backfill: each project's existing single file becomes main.<ext>, named the way
the GitHub push always named it. Its content is untouched.

Downgrade: the old schema allows one file per project, so every project keeps
only its oldest file. Any other files are permanently deleted.

Revision ID: 0008_multi_file_code
Revises: 0007_activity_notifications
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008_multi_file_code"
down_revision: str | Sequence[str] | None = "0007_activity_notifications"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The baseline left this constraint unnamed, so each database names it itself:
# SQLite needs a naming convention to find it, Postgres can just be asked.
NAMING = {"uq": "uq_%(table_name)s_%(column_0_name)s"}
OLD_SQLITE_NAME = "uq_code_files_project_id"
OLD_POSTGRES_NAME = "code_files_project_id_key"


def _project_only_unique(bind) -> str:
    for constraint in sa.inspect(bind).get_unique_constraints("code_files"):
        if constraint["column_names"] == ["project_id"]:
            return constraint["name"]
    raise RuntimeError("code_files has no unique constraint on project_id")


def upgrade() -> None:
    bind = op.get_bind()
    op.add_column("code_files", sa.Column("path", sa.String(), nullable=True))
    op.execute(
        """
        UPDATE code_files SET path = CASE language
            WHEN 'python' THEN 'main.py'
            WHEN 'javascript' THEN 'main.js'
            WHEN 'java' THEN 'main.java'
            WHEN 'cpp' THEN 'main.cpp'
            WHEN 'html' THEN 'main.html'
            ELSE 'main.txt'
        END
        """
    )
    op.execute("UPDATE code_files SET language = 'plaintext' WHERE language IS NULL")
    op.execute("UPDATE code_files SET content = '' WHERE content IS NULL")

    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("code_files", naming_convention=NAMING) as batch:
            batch.drop_constraint(OLD_SQLITE_NAME, type_="unique")
            batch.alter_column("path", existing_type=sa.String(), nullable=False)
            batch.create_unique_constraint("uq_code_files_project_path", ["project_id", "path"])
    else:
        op.drop_constraint(_project_only_unique(bind), "code_files", type_="unique")
        op.alter_column("code_files", "path", existing_type=sa.String(), nullable=False)
        op.create_unique_constraint("uq_code_files_project_path", "code_files", ["project_id", "path"])


def downgrade() -> None:
    bind = op.get_bind()
    op.execute(
        """
        DELETE FROM code_files WHERE id NOT IN (
            SELECT keep FROM (SELECT min(id) AS keep FROM code_files GROUP BY project_id) AS oldest
        )
        """
    )
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("code_files") as batch:
            batch.drop_constraint("uq_code_files_project_path", type_="unique")
            batch.drop_column("path")
            batch.create_unique_constraint(OLD_SQLITE_NAME, ["project_id"])
    else:
        op.drop_constraint("uq_code_files_project_path", "code_files", type_="unique")
        op.drop_column("code_files", "path")
        op.create_unique_constraint(OLD_POSTGRES_NAME, "code_files", ["project_id"])
