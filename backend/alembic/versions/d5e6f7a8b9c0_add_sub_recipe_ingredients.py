"""add sub-recipe ingredients

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Create Date: 2026-09-06 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd5e6f7a8b9c0'
down_revision: Union[str, None] = 'c4d5e6f7a8b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('recipe_ingredients', 'food_inventory_id', nullable=True)
    op.add_column('recipe_ingredients', sa.Column('sub_recipe_id', sa.Uuid(), nullable=True))
    op.create_foreign_key(
        'recipe_ingredients_sub_recipe_id_fkey',
        'recipe_ingredients', 'recipes',
        ['sub_recipe_id'], ['id'], ondelete='RESTRICT',
    )
    op.create_check_constraint(
        'ck_recipe_ingredient_exactly_one_source',
        'recipe_ingredients',
        '(food_inventory_id IS NOT NULL) != (sub_recipe_id IS NOT NULL)',
    )


def downgrade() -> None:
    op.drop_constraint('ck_recipe_ingredient_exactly_one_source', 'recipe_ingredients', type_='check')
    op.drop_constraint('recipe_ingredients_sub_recipe_id_fkey', 'recipe_ingredients', type_='foreignkey')
    op.drop_column('recipe_ingredients', 'sub_recipe_id')
    op.alter_column('recipe_ingredients', 'food_inventory_id', nullable=False)
