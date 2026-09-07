"""units of measure, recipe ingredient unit override, drop menu plan entries

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
Create Date: 2026-09-07 00:00:00.000000

"""
import uuid
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4d5e6f7a8b9'
down_revision: Union[str, None] = 'b3c4d5e6f7a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_table('menu_plan_entries')

    units = op.create_table('units_of_measure',
    sa.Column('label', sa.String(length=20), nullable=False),
    sa.Column('base_unit_id', sa.Uuid(), nullable=True),
    sa.Column('factor_to_base', sa.Numeric(precision=14, scale=6), nullable=False, server_default='1'),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(['base_unit_id'], ['units_of_measure.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('label'),
    )

    op.add_column('recipe_ingredients', sa.Column('override_unit_id', sa.Uuid(), nullable=True))
    op.create_foreign_key(
        'recipe_ingredients_override_unit_id_fkey', 'recipe_ingredients', 'units_of_measure',
        ['override_unit_id'], ['id'], ondelete='SET NULL',
    )

    # Seed the same unit vocabulary that was previously a hardcoded array in
    # the New Item Master frontend form, now with real conversion pairs.
    g_id, kg_id, ml_id, l_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    op.bulk_insert(units, [
        {"id": g_id, "label": "g", "base_unit_id": None, "factor_to_base": 1},
        {"id": kg_id, "label": "kg", "base_unit_id": g_id, "factor_to_base": 1000},
        {"id": ml_id, "label": "ml", "base_unit_id": None, "factor_to_base": 1},
        {"id": l_id, "label": "L", "base_unit_id": ml_id, "factor_to_base": 1000},
        {"id": uuid.uuid4(), "label": "units", "base_unit_id": None, "factor_to_base": 1},
        {"id": uuid.uuid4(), "label": "pack", "base_unit_id": None, "factor_to_base": 1},
        {"id": uuid.uuid4(), "label": "bottle", "base_unit_id": None, "factor_to_base": 1},
        {"id": uuid.uuid4(), "label": "set", "base_unit_id": None, "factor_to_base": 1},
    ])


def downgrade() -> None:
    op.drop_constraint('recipe_ingredients_override_unit_id_fkey', 'recipe_ingredients', type_='foreignkey')
    op.drop_column('recipe_ingredients', 'override_unit_id')
    op.drop_table('units_of_measure')

    op.create_table('menu_plan_entries',
    sa.Column('meal_type', sa.String(length=20), nullable=False),
    sa.Column('day_of_week', sa.String(length=3), nullable=False),
    sa.Column('dish_name', sa.String(length=200), nullable=False),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    )
