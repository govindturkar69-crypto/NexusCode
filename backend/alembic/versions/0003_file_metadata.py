"""file metadata: resource_type, content_type, size_bytes

resource_type is needed to delete an asset from Cloudinary (alongside
public_id from 0002). All three are NULL for files uploaded before this
migration; nothing is backfilled because the values were never recorded.

Revision ID: 0003_file_metadata
Revises: 0002_schema_improvements
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_file_metadata"
down_revision: str | Sequence[str] | None = "0002_schema_improvements"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("files") as batch:
        batch.add_column(sa.Column("resource_type", sa.String(), nullable=True))
        batch.add_column(sa.Column("content_type", sa.String(), nullable=True))
        batch.add_column(sa.Column("size_bytes", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("files") as batch:
        batch.drop_column("size_bytes")
        batch.drop_column("content_type")
        batch.drop_column("resource_type")
