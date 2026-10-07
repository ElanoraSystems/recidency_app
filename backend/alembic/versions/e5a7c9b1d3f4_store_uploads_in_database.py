"""store uploaded files in the database

Revision ID: e5a7c9b1d3f4
Revises: d4f6b8a0c2e3
Create Date: 2026-10-07 14:00:00.000000

"""
from pathlib import Path
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e5a7c9b1d3f4'
down_revision: Union[str, None] = 'd4f6b8a0c2e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UPLOAD_ROOT = Path(__file__).resolve().parents[2] / "uploads"


def upgrade() -> None:
    op.add_column('document_files', sa.Column('data', sa.LargeBinary(), nullable=True))
    op.add_column('attachments', sa.Column('data', sa.LargeBinary(), nullable=True))
    op.add_column('residence_settings', sa.Column('logo_data', sa.LargeBinary(), nullable=True))
    op.add_column('residence_settings', sa.Column('logo_content_type', sa.String(length=60), nullable=True))

    # Copy any file that still exists on the server's disk into the database.
    # Where the disk was wiped by a deploy there is nothing to copy; those rows
    # keep their record and report the file as no longer stored.
    bind = op.get_bind()
    for table in ('document_files', 'attachments'):
        for row_id, key in bind.execute(sa.text(f"SELECT id, s3_key FROM {table}")).all():
            path = UPLOAD_ROOT / key
            if path.is_file():
                bind.execute(
                    sa.text(f"UPDATE {table} SET data = :data WHERE id = :id").bindparams(sa.bindparam('data', type_=sa.LargeBinary())),
                    {"data": path.read_bytes(), "id": row_id},
                )
    for row_id, key in bind.execute(sa.text("SELECT id, logo_path FROM residence_settings WHERE logo_path IS NOT NULL")).all():
        path = UPLOAD_ROOT / key
        if path.is_file():
            ext = path.suffix.lstrip('.').lower()
            mime = 'image/jpeg' if ext in ('jpg', 'jpeg') else f'image/{ext or "png"}'
            bind.execute(
                sa.text("UPDATE residence_settings SET logo_data = :data, logo_content_type = :mime WHERE id = :id").bindparams(sa.bindparam('data', type_=sa.LargeBinary())),
                {"data": path.read_bytes(), "mime": mime, "id": row_id},
            )


def downgrade() -> None:
    op.drop_column('residence_settings', 'logo_content_type')
    op.drop_column('residence_settings', 'logo_data')
    op.drop_column('attachments', 'data')
    op.drop_column('document_files', 'data')
