"""add food_inventory_batches for FEFO tracking, backfill one batch per existing item

Revision ID: c3d4e5f6a1b2
Revises: b2c3d4e5f6a1
Create Date: 2026-09-27 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3d4e5f6a1b2'
down_revision: Union[str, None] = 'b2c3d4e5f6a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'food_inventory_batches',
        sa.Column('food_inventory_id', sa.Uuid(), nullable=False),
        sa.Column('batch_label', sa.String(length=40), nullable=True),
        sa.Column('qty', sa.Numeric(precision=12, scale=3), nullable=False),
        sa.Column('expiry', sa.Date(), nullable=True),
        sa.Column('cost', sa.Numeric(precision=12, scale=6), nullable=False),
        sa.Column('received_date', sa.Date(), nullable=False),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(['food_inventory_id'], ['food_inventory.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.execute(
        "INSERT INTO food_inventory_batches (id, food_inventory_id, batch_label, qty, expiry, cost, received_date) "
        "SELECT gen_random_uuid(), id, batch, qty, expiry, cost, CURRENT_DATE "
        "FROM food_inventory WHERE qty > 0"
    )


def downgrade() -> None:
    op.drop_table('food_inventory_batches')
