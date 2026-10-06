"""moving weighted-average cost persists at zero stock

Revision ID: b2d4f6a8c0e1
Revises: a1c3e5f7b9d0
Create Date: 2026-10-06 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b2d4f6a8c0e1'
down_revision: Union[str, None] = 'a1c3e5f7b9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Food stock cost used to be recomputed from the batches on hand, so an
    # item that had run out read 0. It is now a moving average that stays; give
    # those items the price they were last bought at as the starting point.
    op.execute(
        """
        UPDATE food_inventory f SET cost = im.last_price
        FROM item_master im
        WHERE im.stock_type = 'food' AND im.stock_id = f.id AND f.cost = 0 AND im.last_price > 0
        """
    )


def downgrade() -> None:
    pass  # data-only change
