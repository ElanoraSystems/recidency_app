"""add item master created_by

Revision ID: e1f2a3b4c5d6
Revises: d0e1f2a3b4c5
Create Date: 2026-09-28 00:00:00.000002

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e1f2a3b4c5d6'
down_revision: Union[str, None] = 'd0e1f2a3b4c5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('item_master', sa.Column('created_by', sa.Uuid(), nullable=True))
    op.create_foreign_key(
        'fk_item_master_created_by_users', 'item_master', 'users', ['created_by'], ['id'], ondelete='SET NULL'
    )


def downgrade() -> None:
    op.drop_constraint('fk_item_master_created_by_users', 'item_master', type_='foreignkey')
    op.drop_column('item_master', 'created_by')
