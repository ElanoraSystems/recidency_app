"""add stock_counts and stock_count_lines for physical stock-take variance

Revision ID: d4e5f6a1b2c3
Revises: c3d4e5f6a1b2
Create Date: 2026-09-27 09:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4e5f6a1b2c3'
down_revision: Union[str, None] = 'c3d4e5f6a1b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'stock_counts',
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('counted_by', sa.Uuid(), nullable=True),
        sa.Column('notes', sa.String(), nullable=True),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['counted_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'stock_count_lines',
        sa.Column('count_id', sa.Uuid(), nullable=False),
        sa.Column('item_master_id', sa.Uuid(), nullable=False),
        sa.Column('book_qty', sa.Numeric(precision=12, scale=3), nullable=False),
        sa.Column('counted_qty', sa.Numeric(precision=12, scale=3), nullable=True),
        sa.Column('unit_cost', sa.Numeric(precision=12, scale=6), nullable=False),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(['count_id'], ['stock_counts.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['item_master_id'], ['item_master.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('stock_count_lines')
    op.drop_table('stock_counts')
