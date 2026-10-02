"""cost centers through purchasing, price variance, posting dates and period locks, recipe cost history

Revision ID: e8a0c2d4f6b7
Revises: d7f9b1c3e5a6
Create Date: 2026-10-03 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e8a0c2d4f6b7'
down_revision: Union[str, None] = 'd7f9b1c3e5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Business date of every ledger row, on the residence's calendar. Existing
    # rows only know when they were posted, so that is the best backfill.
    op.add_column('stock_movements', sa.Column('posting_date', sa.Date(), nullable=True))
    op.execute("UPDATE stock_movements SET posting_date = (created_at AT TIME ZONE 'Asia/Kuwait')::date")
    op.alter_column('stock_movements', 'posting_date', nullable=False)
    op.create_index('ix_stock_movements_posting_date', 'stock_movements', ['posting_date'])

    op.create_table(
        'period_closes',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('period', sa.String(length=7), nullable=False),
        sa.Column('closed', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('closed_by', sa.Uuid(), nullable=True),
        sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('reopened_by', sa.Uuid(), nullable=True),
        sa.Column('reopened_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('reopen_reason', sa.String(), nullable=True),
        sa.ForeignKeyConstraint(['closed_by'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['reopened_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('period'),
    )

    op.create_table(
        'recipe_cost_snapshots',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('recipe_id', sa.Uuid(), nullable=False),
        sa.Column('total_cost', sa.Numeric(12, 3), nullable=False),
        sa.Column('cost_per_portion', sa.Numeric(12, 3), nullable=False),
        sa.Column('portions', sa.Integer(), nullable=False),
        sa.Column('reason', sa.String(length=80), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['recipe_id'], ['recipes.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_recipe_cost_snapshots_recipe', 'recipe_cost_snapshots', ['recipe_id', 'created_at'])

    # Purchasing: real cost center ids behind the label, carried PR -> PO.
    op.add_column('purchase_requests', sa.Column('cost_center_id', sa.Uuid(), nullable=True))
    op.create_foreign_key('fk_pr_cost_center', 'purchase_requests', 'cost_centers', ['cost_center_id'], ['id'], ondelete='SET NULL')
    op.execute("UPDATE purchase_requests p SET cost_center_id = c.id FROM cost_centers c WHERE c.label = p.cost_center")
    op.add_column('purchase_orders', sa.Column('cost_center_id', sa.Uuid(), nullable=True))
    op.create_foreign_key('fk_po_cost_center', 'purchase_orders', 'cost_centers', ['cost_center_id'], ['id'], ondelete='SET NULL')
    op.execute("UPDATE purchase_orders o SET cost_center_id = p.cost_center_id FROM purchase_requests p WHERE o.source_pr_id = p.id")

    # Expenses auto-logged from a GRN know their GRN and cost center.
    op.add_column('expenses', sa.Column('cost_center_id', sa.Uuid(), nullable=True))
    op.add_column('expenses', sa.Column('grn_id', sa.Uuid(), nullable=True))
    op.create_foreign_key('fk_expense_cost_center', 'expenses', 'cost_centers', ['cost_center_id'], ['id'], ondelete='SET NULL')
    op.create_foreign_key('fk_expense_grn', 'expenses', 'grns', ['grn_id'], ['id'], ondelete='SET NULL')
    op.execute(
        """
        UPDATE expenses e SET grn_id = g.id, cost_center_id = g.receiving_cost_center_id
        FROM grns g WHERE e.notes LIKE 'Auto-logged from ' || g.code || ' %'
        """
    )

    op.add_column('grns', sa.Column('variance_note', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('grns', 'variance_note')
    op.drop_constraint('fk_expense_grn', 'expenses', type_='foreignkey')
    op.drop_constraint('fk_expense_cost_center', 'expenses', type_='foreignkey')
    op.drop_column('expenses', 'grn_id')
    op.drop_column('expenses', 'cost_center_id')
    op.drop_constraint('fk_po_cost_center', 'purchase_orders', type_='foreignkey')
    op.drop_column('purchase_orders', 'cost_center_id')
    op.drop_constraint('fk_pr_cost_center', 'purchase_requests', type_='foreignkey')
    op.drop_column('purchase_requests', 'cost_center_id')
    op.drop_index('ix_recipe_cost_snapshots_recipe', table_name='recipe_cost_snapshots')
    op.drop_table('recipe_cost_snapshots')
    op.drop_table('period_closes')
    op.drop_index('ix_stock_movements_posting_date', table_name='stock_movements')
    op.drop_column('stock_movements', 'posting_date')
