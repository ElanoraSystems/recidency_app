"""restrict task categories to kitchen only

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-09-28 00:00:00.000001

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd0e1f2a3b4c5'
down_revision: Union[str, None] = 'c9d0e1f2a3b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DELETE FROM tasks WHERE category != 'Kitchen'")
    op.execute("DELETE FROM task_templates WHERE category != 'Kitchen'")
    op.execute("DELETE FROM task_categories WHERE label != 'Kitchen'")


def downgrade() -> None:
    # Deleted rows are not recoverable — this migration is one-way.
    pass
