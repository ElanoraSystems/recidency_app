"""description on purchase request and order lines

Revision ID: f9b1d3e5a7c8
Revises: e8a0c2d4f6b7
Create Date: 2026-10-04 09:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'f9b1d3e5a7c8'
down_revision: Union[str, None] = 'e8a0c2d4f6b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('purchase_request_lines', sa.Column('description', sa.String(length=300), nullable=True))
    op.add_column('po_lines', sa.Column('description', sa.String(length=300), nullable=True))


def downgrade() -> None:
    op.drop_column('po_lines', 'description')
    op.drop_column('purchase_request_lines', 'description')
