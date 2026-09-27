"""add credit notes table

Revision ID: f5a6b7c8d9e0
Revises: e7f8a9b0c1d2
Create Date: 2026-09-17 20:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f5a6b7c8d9e0'
down_revision: Union[str, None] = 'e7f8a9b0c1d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('credit_notes',
    sa.Column('supplier_id', sa.Uuid(), nullable=False),
    sa.Column('po_id', sa.Uuid(), nullable=True),
    sa.Column('date', sa.Date(), nullable=False),
    sa.Column('reason', sa.String(length=200), nullable=False),
    sa.Column('amount', sa.Numeric(precision=10, scale=2), nullable=False),
    sa.Column('notes', sa.String(), nullable=True),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['supplier_id'], ['suppliers.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['po_id'], ['purchase_orders.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('credit_notes')
