"""add area completion task counts

Revision ID: b2c3d4e5f6a7
Revises: a7b8c9d0e1f2
Create Date: 2026-09-05 00:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, None] = 'a7b8c9d0e1f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('areas', sa.Column('completion_tasks_done', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('areas', sa.Column('completion_tasks_total', sa.Integer(), nullable=False, server_default='0'))


def downgrade() -> None:
    op.drop_column('areas', 'completion_tasks_total')
    op.drop_column('areas', 'completion_tasks_done')
