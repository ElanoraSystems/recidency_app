"""move task timing (due/start/end time) from task/template level down to checklist items

Revision ID: a1b2c3d4e5f7
Revises: f5a6b7c8d9e0
Create Date: 2026-09-17 21:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f7'
down_revision: Union[str, None] = 'f5a6b7c8d9e0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('task_checklist_items', sa.Column('start_time', sa.Time(), nullable=True))
    op.add_column('task_checklist_items', sa.Column('end_time', sa.Time(), nullable=True))
    op.drop_column('tasks', 'due_time')
    op.drop_column('tasks', 'start_time')
    op.drop_column('tasks', 'end_time')
    op.drop_column('task_templates', 'due_time')
    op.drop_column('task_templates', 'start_time')
    op.drop_column('task_templates', 'end_time')


def downgrade() -> None:
    op.add_column('task_templates', sa.Column('end_time', sa.Time(), nullable=True))
    op.add_column('task_templates', sa.Column('start_time', sa.Time(), nullable=True))
    op.add_column('task_templates', sa.Column('due_time', sa.Time(), nullable=True))
    op.add_column('tasks', sa.Column('end_time', sa.Time(), nullable=True))
    op.add_column('tasks', sa.Column('start_time', sa.Time(), nullable=True))
    op.add_column('tasks', sa.Column('due_time', sa.Time(), nullable=True))
    op.drop_column('task_checklist_items', 'end_time')
    op.drop_column('task_checklist_items', 'start_time')
