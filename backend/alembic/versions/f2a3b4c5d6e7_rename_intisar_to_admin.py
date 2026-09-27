"""rename seeded owner name to admin

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-09-28 00:00:00.000003

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'f2a3b4c5d6e7'
down_revision: Union[str, None] = 'e1f2a3b4c5d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OLD_NAME = 'Intisar Salem Al Ali Al Sabah'
NEW_NAME = 'Admin'


def upgrade() -> None:
    op.execute(f"UPDATE users SET name = '{NEW_NAME}' WHERE name = '{OLD_NAME}'")
    op.execute(f"UPDATE family_members SET name = '{NEW_NAME}' WHERE name = '{OLD_NAME}'")


def downgrade() -> None:
    op.execute(f"UPDATE users SET name = '{OLD_NAME}' WHERE name = '{NEW_NAME}'")
    op.execute(f"UPDATE family_members SET name = '{OLD_NAME}' WHERE name = '{NEW_NAME}'")
