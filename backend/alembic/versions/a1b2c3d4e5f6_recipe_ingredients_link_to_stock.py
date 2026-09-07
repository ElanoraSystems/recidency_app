"""recipe ingredients link to stock

Revision ID: a1b2c3d4e5f6
Revises: f4a5b6c7d8e9
Create Date: 2026-09-07 00:00:00.000000

Recipe costing was a manually-typed, never-updated number with no link to
real stock prices. Ingredients now require a FoodInventory link so cost is
always read live off the (now moving-average) stock cost. No production
data exists for recipes/recipe_ingredients at the time of this migration
(confirmed empty), so this is a straight drop-and-add rather than a
data-preserving transform.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'f4a5b6c7d8e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column('recipe_ingredients', 'name')
    op.drop_column('recipe_ingredients', 'unit')
    op.drop_column('recipe_ingredients', 'cost_per_unit')
    op.add_column('recipe_ingredients', sa.Column('food_inventory_id', sa.Uuid(), nullable=False))
    op.create_foreign_key(
        'recipe_ingredients_food_inventory_id_fkey', 'recipe_ingredients', 'food_inventory',
        ['food_inventory_id'], ['id'], ondelete='RESTRICT',
    )


def downgrade() -> None:
    op.drop_constraint('recipe_ingredients_food_inventory_id_fkey', 'recipe_ingredients', type_='foreignkey')
    op.drop_column('recipe_ingredients', 'food_inventory_id')
    op.add_column('recipe_ingredients', sa.Column('cost_per_unit', sa.Numeric(precision=12, scale=6), nullable=False, server_default='0'))
    op.add_column('recipe_ingredients', sa.Column('unit', sa.String(length=20), nullable=False, server_default=''))
    op.add_column('recipe_ingredients', sa.Column('name', sa.String(length=150), nullable=False, server_default=''))
