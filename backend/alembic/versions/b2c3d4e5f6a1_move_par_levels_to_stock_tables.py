"""move par levels (min/max) from item_master to stock tables (food_inventory, inventory)

Revision ID: b2c3d4e5f6a1
Revises: a1b2c3d4e5f7
Create Date: 2026-09-20 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a1'
down_revision: Union[str, None] = 'a1b2c3d4e5f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('food_inventory', sa.Column('min', sa.Numeric(10, 2), server_default='0', nullable=False))
    op.add_column('food_inventory', sa.Column('max', sa.Numeric(10, 2), server_default='0', nullable=False))
    op.execute(
        "UPDATE food_inventory f SET min = im.min_stock, max = im.reorder_level "
        "FROM item_master im WHERE im.stock_type = 'food' AND im.stock_id = f.id"
    )
    op.execute(
        "UPDATE inventory i SET min = im.min_stock, max = im.reorder_level "
        "FROM item_master im WHERE im.stock_type = 'general' AND im.stock_id = i.id "
        "AND im.min_stock > 0"
    )
    op.drop_column('item_master', 'min_stock')
    op.drop_column('item_master', 'reorder_level')


def downgrade() -> None:
    op.add_column('item_master', sa.Column('reorder_level', sa.Numeric(10, 2), server_default='0', nullable=False))
    op.add_column('item_master', sa.Column('min_stock', sa.Numeric(10, 2), server_default='0', nullable=False))
    op.execute(
        "UPDATE item_master im SET min_stock = f.min, reorder_level = f.max "
        "FROM food_inventory f WHERE im.stock_type = 'food' AND im.stock_id = f.id"
    )
    op.execute(
        "UPDATE item_master im SET min_stock = i.min, reorder_level = i.max "
        "FROM inventory i WHERE im.stock_type = 'general' AND im.stock_id = i.id"
    )
    op.drop_column('food_inventory', 'max')
    op.drop_column('food_inventory', 'min')
