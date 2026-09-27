"""add task requires_verification and template timing fields

Revision ID: e7f8a9b0c1d2
Revises: d5e6f7a8b9c0
Create Date: 2026-09-17 19:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e7f8a9b0c1d2'
down_revision: Union[str, None] = 'd5e6f7a8b9c0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'tasks',
        sa.Column('requires_verification', sa.Boolean(), nullable=False, server_default='true'),
    )
    op.add_column('task_templates', sa.Column('due_time', sa.Time(), nullable=True))
    op.add_column('task_templates', sa.Column('start_time', sa.Time(), nullable=True))
    op.add_column('task_templates', sa.Column('end_time', sa.Time(), nullable=True))
    op.add_column(
        'task_templates',
        sa.Column('requires_verification', sa.Boolean(), nullable=False, server_default='true'),
    )


def downgrade() -> None:
    op.drop_column('task_templates', 'requires_verification')
    op.drop_column('task_templates', 'end_time')
    op.drop_column('task_templates', 'start_time')
    op.drop_column('task_templates', 'due_time')
    op.drop_column('tasks', 'requires_verification')
