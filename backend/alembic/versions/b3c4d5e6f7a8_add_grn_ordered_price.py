"""add grn ordered price

Revision ID: b3c4d5e6f7a8
Revises: a1b2c3d4e5f6
Create Date: 2026-09-07 00:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b3c4d5e6f7a8'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('grn_lines', sa.Column('ordered_price', sa.Numeric(precision=10, scale=3), nullable=False, server_default='0'))
    op.alter_column('grn_lines', 'ordered_price', server_default=None)


def downgrade() -> None:
    op.drop_column('grn_lines', 'ordered_price')
