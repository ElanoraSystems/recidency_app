"""PR/PO standard statuses, delivery date and unit prices, meal plan history, recipe portions

Revision ID: b4d6f8a0c2e3
Revises: a3c5e7f9b1d2
Create Date: 2026-10-02 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b4d6f8a0c2e3'
down_revision: Union[str, None] = 'a3c5e7f9b1d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _signoffs(table: str, who_list: tuple[str, ...]) -> None:
    for who in who_list:
        op.add_column(table, sa.Column(f'{who}_by', sa.Uuid(), nullable=True))
        op.add_column(table, sa.Column(f'{who}_at', sa.DateTime(timezone=True), nullable=True))


def upgrade() -> None:
    # Purchase requests: required delivery date, per-line unit price, sign-offs.
    op.add_column('purchase_requests', sa.Column('required_delivery_date', sa.Date(), nullable=True))
    _signoffs('purchase_requests', ('submitted', 'approved', 'closed'))
    op.add_column('purchase_request_lines', sa.Column('est_unit_price', sa.Numeric(10, 3), server_default='0', nullable=False))
    op.execute("UPDATE purchase_request_lines SET est_unit_price = round(est_cost / qty, 3) WHERE qty > 0")

    # Purchase orders already have approved_by.
    op.add_column('purchase_orders', sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True))
    _signoffs('purchase_orders', ('submitted', 'closed'))

    # Meal plans: reference number + who submitted/approved.
    op.add_column('weekly_meal_plans', sa.Column('code', sa.String(length=20), nullable=True))
    _signoffs('weekly_meal_plans', ('submitted', 'approved'))
    op.execute(
        """
        UPDATE weekly_meal_plans w SET code = 'MP-' || n.rn
        FROM (SELECT id, 1000 + row_number() OVER (ORDER BY created_at, id) AS rn FROM weekly_meal_plans) n
        WHERE w.id = n.id
        """
    )
    op.create_unique_constraint('uq_weekly_meal_plans_code', 'weekly_meal_plans', ['code'])

    # Recipe options: number of portions the proposal needs.
    op.add_column('menu_options', sa.Column('portions', sa.Integer(), nullable=True))

    # Standard status vocabulary.
    op.execute("UPDATE purchase_requests SET status = 'Submitted' WHERE status = 'Pending Approval'")
    op.execute("UPDATE purchase_requests SET status = 'Closed' WHERE status LIKE 'Ordered%'")
    op.execute("UPDATE purchase_orders SET status = 'Submitted' WHERE status = 'Pending Approval'")
    op.execute("UPDATE purchase_orders SET status = 'Approved' WHERE status = 'Ordered'")
    op.execute("UPDATE purchase_orders SET status = 'Fully Received' WHERE status = 'Goods Received'")
    op.execute("UPDATE weekly_meal_plans SET status = 'Submitted' WHERE status = 'Pending Approval'")


def downgrade() -> None:
    op.execute("UPDATE weekly_meal_plans SET status = 'Pending Approval' WHERE status = 'Submitted'")
    op.execute("UPDATE purchase_orders SET status = 'Goods Received' WHERE status = 'Fully Received'")
    op.execute("UPDATE purchase_orders SET status = 'Ordered' WHERE status IN ('Approved', 'Closed', 'Draft')")
    op.execute("UPDATE purchase_orders SET status = 'Pending Approval' WHERE status = 'Submitted'")
    op.execute("UPDATE purchase_requests SET status = 'Pending Approval' WHERE status IN ('Submitted', 'Draft')")
    op.drop_column('menu_options', 'portions')
    op.drop_constraint('uq_weekly_meal_plans_code', 'weekly_meal_plans', type_='unique')
    for col in ('code', 'submitted_by', 'submitted_at', 'approved_by', 'approved_at'):
        op.drop_column('weekly_meal_plans', col)
    for col in ('approved_at', 'submitted_by', 'submitted_at', 'closed_by', 'closed_at'):
        op.drop_column('purchase_orders', col)
    op.drop_column('purchase_request_lines', 'est_unit_price')
    for col in ('required_delivery_date', 'submitted_by', 'submitted_at', 'approved_by', 'approved_at', 'closed_by', 'closed_at'):
        op.drop_column('purchase_requests', col)
