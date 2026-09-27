"""move purchase requests to header + lines (multi-item requests)

Revision ID: e5f6a1b2c3d4
Revises: d4e5f6a1b2c3
Create Date: 2026-10-04 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5f6a1b2c3d4'
down_revision: Union[str, None] = 'd4e5f6a1b2c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'purchase_request_lines',
        sa.Column('pr_id', sa.Uuid(), nullable=False),
        sa.Column('item_master_id', sa.Uuid(), nullable=True),
        sa.Column('item_name', sa.String(length=150), nullable=False),
        sa.Column('qty', sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column('unit', sa.String(length=20), nullable=False),
        sa.Column('category', sa.String(length=80), nullable=False),
        sa.Column('est_cost', sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(['pr_id'], ['purchase_requests.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['item_master_id'], ['item_master.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.execute(
        "INSERT INTO purchase_request_lines "
        "(id, pr_id, item_master_id, item_name, qty, unit, category, est_cost) "
        "SELECT gen_random_uuid(), id, linked_inventory_id, item, qty, unit, category, est_cost "
        "FROM purchase_requests"
    )
    op.drop_column('purchase_requests', 'item')
    op.drop_column('purchase_requests', 'qty')
    op.drop_column('purchase_requests', 'unit')
    op.drop_column('purchase_requests', 'category')
    op.drop_column('purchase_requests', 'est_cost')
    op.drop_column('purchase_requests', 'linked_inventory_id')


def downgrade() -> None:
    op.add_column('purchase_requests', sa.Column('linked_inventory_id', sa.Uuid(), nullable=True))
    op.add_column('purchase_requests', sa.Column('est_cost', sa.Numeric(precision=10, scale=2), server_default='0', nullable=False))
    op.add_column('purchase_requests', sa.Column('category', sa.String(length=80), server_default='', nullable=False))
    op.add_column('purchase_requests', sa.Column('unit', sa.String(length=20), server_default='', nullable=False))
    op.add_column('purchase_requests', sa.Column('qty', sa.Numeric(precision=10, scale=2), server_default='0', nullable=False))
    op.add_column('purchase_requests', sa.Column('item', sa.String(length=150), server_default='', nullable=False))
    op.execute(
        "UPDATE purchase_requests pr SET "
        "item = l.item_name, qty = l.qty, unit = l.unit, category = l.category, "
        "est_cost = l.est_cost, linked_inventory_id = l.item_master_id "
        "FROM ("
        "  SELECT DISTINCT ON (pr_id) pr_id, item_name, qty, unit, category, est_cost, item_master_id "
        "  FROM purchase_request_lines ORDER BY pr_id, id"
        ") l WHERE pr.id = l.pr_id"
    )
    op.drop_table('purchase_request_lines')
