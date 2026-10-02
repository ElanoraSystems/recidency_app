"""recipe portion count and optional custom portion size

Revision ID: d7f9b1c3e5a6
Revises: c6e8a0b2d4f5
Create Date: 2026-10-03 09:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'd7f9b1c3e5a6'
down_revision: Union[str, None] = 'c6e8a0b2d4f5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Existing recipes keep their stored size and keep counting portions by it.
    op.add_column('recipes', sa.Column('portions', sa.Integer(), nullable=True))
    op.alter_column('recipes', 'portion_size_g', existing_type=sa.Numeric(10, 2), nullable=True)


def downgrade() -> None:
    op.execute("UPDATE recipes SET portion_size_g = 250 WHERE portion_size_g IS NULL")
    op.alter_column('recipes', 'portion_size_g', existing_type=sa.Numeric(10, 2), nullable=False)
    op.drop_column('recipes', 'portions')
