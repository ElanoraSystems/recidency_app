"""add cost centers

Revision ID: b7c8d9e0f1a2
Revises: e5f6a1b2c3d4
Create Date: 2026-09-27 00:00:00.000000

"""
import uuid
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7c8d9e0f1a2'
down_revision: Union[str, None] = 'e5f6a1b2c3d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COST_CENTERS = ["Family", "Guests", "Staff", "Events", "Villa Security Team"]


def upgrade() -> None:
    cost_centers = op.create_table('cost_centers',
    sa.Column('label', sa.String(length=60), nullable=False),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('label')
    )
    op.bulk_insert(cost_centers, [{"id": uuid.uuid4(), "label": label} for label in COST_CENTERS])

    op.alter_column('meal_log', 'produced_for', new_column_name='cost_center')


def downgrade() -> None:
    op.alter_column('meal_log', 'cost_center', new_column_name='produced_for')
    op.drop_table('cost_centers')
