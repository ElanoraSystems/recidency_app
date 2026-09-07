"""add task categories

Revision ID: f1a2b3c4d5e6
Revises: 02d8ef033834
Create Date: 2026-09-05 00:00:00.000000

"""
import uuid
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, None] = '02d8ef033834'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Seeded with the categories previously hardcoded in the frontend's New Task
# form, so every existing task's category still matches an entry.
TASK_CATEGORIES = ["Housekeeping", "Kitchen", "Maintenance", "Vehicles", "Garden & Pool", "Purchasing", "General"]


def upgrade() -> None:
    task_categories = op.create_table('task_categories',
    sa.Column('label', sa.String(length=60), nullable=False),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('label')
    )

    op.bulk_insert(task_categories, [{"id": uuid.uuid4(), "label": label} for label in TASK_CATEGORIES])


def downgrade() -> None:
    op.drop_table('task_categories')
