"""supplier invoice number on goods receipts

Revision ID: a1c3e5f7b9d0
Revises: f9b1d3e5a7c8
Create Date: 2026-10-04 15:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a1c3e5f7b9d0'
down_revision: Union[str, None] = 'f9b1d3e5a7c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('grns', sa.Column('supplier_invoice_no', sa.String(length=60), nullable=True))


def downgrade() -> None:
    op.drop_column('grns', 'supplier_invoice_no')
