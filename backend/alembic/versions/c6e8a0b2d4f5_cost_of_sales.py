"""monthly cost of sales per cost center

Revision ID: c6e8a0b2d4f5
Revises: b4d6f8a0c2e3
Create Date: 2026-10-02 18:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c6e8a0b2d4f5'
down_revision: Union[str, None] = 'b4d6f8a0c2e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'cost_of_sales',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('cost_center_id', sa.Uuid(), nullable=False),
        sa.Column('period', sa.String(length=7), nullable=False),
        sa.Column('stock_type', sa.String(length=10), nullable=False),
        sa.Column('stock_count_id', sa.Uuid(), nullable=True),
        sa.Column('count_date', sa.DateTime(timezone=True), nullable=False),
        sa.Column('opening_value', sa.Numeric(14, 3), nullable=False, server_default='0'),
        sa.Column('purchases', sa.Numeric(14, 3), nullable=False, server_default='0'),
        sa.Column('transfers_in', sa.Numeric(14, 3), nullable=False, server_default='0'),
        sa.Column('transfers_out', sa.Numeric(14, 3), nullable=False, server_default='0'),
        sa.Column('closing_value', sa.Numeric(14, 3), nullable=False, server_default='0'),
        sa.Column('cost_of_sales', sa.Numeric(14, 3), nullable=False, server_default='0'),
        sa.Column('meals_value', sa.Numeric(14, 3), nullable=False, server_default='0'),
        sa.Column('waste_value', sa.Numeric(14, 3), nullable=False, server_default='0'),
        sa.Column('count_variance', sa.Numeric(14, 3), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['cost_center_id'], ['cost_centers.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['stock_count_id'], ['stock_counts.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('cost_center_id', 'period', 'stock_type', name='uq_cos_period'),
    )


def downgrade() -> None:
    op.drop_table('cost_of_sales')
