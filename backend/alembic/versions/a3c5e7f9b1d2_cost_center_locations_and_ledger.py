"""cost center locations, stock ledger and transaction workflow

Revision ID: a3c5e7f9b1d2
Revises: f2a3b4c5d6e7
Create Date: 2026-10-02 00:00:00.000000

"""
import uuid
from datetime import date
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'a3c5e7f9b1d2'
down_revision: Union[str, None] = 'f2a3b4c5d6e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MAIN_STORE = "Main Store"


def _workflow_columns(table: str, with_status: bool = True) -> None:
    if with_status:
        op.add_column(table, sa.Column('status', sa.String(length=20), server_default='Draft', nullable=False))
    for who in ('submitted', 'approved', 'closed'):
        op.add_column(table, sa.Column(f'{who}_by', sa.Uuid(), nullable=True))
        op.add_column(table, sa.Column(f'{who}_at', sa.DateTime(timezone=True), nullable=True))
        op.create_foreign_key(f'fk_{table}_{who}_by_users', table, 'users', [f'{who}_by'], ['id'], ondelete='SET NULL')


def _add_cost_center(table: str, column: str, main_id, nullable: bool = False) -> None:
    op.add_column(table, sa.Column(column, sa.Uuid(), nullable=True))
    op.execute(sa.text(f"UPDATE {table} SET {column} = :main").bindparams(main=main_id))
    if not nullable:
        op.alter_column(table, column, nullable=False)
    op.create_foreign_key(f'fk_{table}_{column}_cost_centers', table, 'cost_centers', [column], ['id'], ondelete='RESTRICT')


def _backfill_codes(conn, table: str, prefix: str, start: int = 1001) -> None:
    op.add_column(table, sa.Column('code', sa.String(length=20), nullable=True))
    rows = conn.execute(sa.text(f"SELECT id FROM {table} ORDER BY date, created_at, id")).fetchall()
    for n, (row_id,) in enumerate(rows, start=start):
        conn.execute(sa.text(f"UPDATE {table} SET code = :c WHERE id = :i"), {"c": f"{prefix}-{n}", "i": row_id})
    op.alter_column(table, 'code', nullable=False)
    op.create_unique_constraint(f'uq_{table}_code', table, ['code'])


def _mark_legacy_closed(table: str, creator_col: str | None) -> None:
    """Rows from before the workflow existed are already-posted history."""
    creator = creator_col if creator_col else "NULL"
    op.execute(sa.text(
        f"UPDATE {table} SET status = 'Closed', submitted_by = {creator}, submitted_at = created_at, "
        f"approved_at = created_at, closed_at = created_at"
    ))


def upgrade() -> None:
    conn = op.get_bind()

    # ---------------------------------------------------------- new tables
    op.create_table(
        'stock_movements',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('txn_type', sa.String(length=20), nullable=False),
        sa.Column('txn_id', sa.Uuid(), nullable=True),
        sa.Column('txn_code', sa.String(length=30), nullable=True),
        sa.Column('stock_type', sa.String(length=10), nullable=False),
        sa.Column('stock_id', sa.Uuid(), nullable=False),
        sa.Column('item_name', sa.String(length=150), nullable=False),
        sa.Column('unit', sa.String(length=20), nullable=False),
        sa.Column('from_cost_center_id', sa.Uuid(), nullable=True),
        sa.Column('to_cost_center_id', sa.Uuid(), nullable=True),
        sa.Column('qty', sa.Numeric(12, 3), nullable=False),
        sa.Column('unit_cost', sa.Numeric(12, 6), nullable=False),
        sa.Column('total_value', sa.Numeric(14, 4), nullable=False),
        sa.Column('batch_id', sa.Uuid(), nullable=True),
        sa.Column('source_batch_id', sa.Uuid(), nullable=True),
        sa.Column('user_id', sa.Uuid(), nullable=True),
        sa.Column('status', sa.String(length=10), nullable=False),
        sa.Column('reverses_id', sa.Uuid(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['from_cost_center_id'], ['cost_centers.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['to_cost_center_id'], ['cost_centers.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_stock_movements_item', 'stock_movements', ['stock_type', 'stock_id'])
    op.create_index('ix_stock_movements_txn', 'stock_movements', ['txn_id'])
    op.create_index('ix_stock_movements_created', 'stock_movements', ['created_at'])

    op.create_table(
        'inventory_balances',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('inventory_id', sa.Uuid(), nullable=False),
        sa.Column('cost_center_id', sa.Uuid(), nullable=False),
        sa.Column('qty', sa.Numeric(12, 3), nullable=False, server_default='0'),
        sa.ForeignKeyConstraint(['inventory_id'], ['inventory.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['cost_center_id'], ['cost_centers.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('inventory_id', 'cost_center_id', name='uq_inventory_balance_location'),
    )

    op.create_table(
        'audit_log',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('entity_type', sa.String(length=30), nullable=False),
        sa.Column('entity_id', sa.Uuid(), nullable=False),
        sa.Column('entity_code', sa.String(length=30), nullable=True),
        sa.Column('action', sa.String(length=20), nullable=False),
        sa.Column('from_status', sa.String(length=20), nullable=True),
        sa.Column('to_status', sa.String(length=20), nullable=True),
        sa.Column('user_id', sa.Uuid(), nullable=True),
        sa.Column('user_name', sa.String(length=150), nullable=True),
        sa.Column('reason', sa.String(), nullable=True),
        sa.Column('changes', postgresql.JSONB(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_audit_log_entity', 'audit_log', ['entity_type', 'entity_id'])

    op.create_table(
        'meal_log_lines',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('meal_log_id', sa.Uuid(), nullable=False),
        sa.Column('recipe_id', sa.Uuid(), nullable=True),
        sa.Column('dish', sa.String(length=200), nullable=False),
        sa.Column('qty', sa.Integer(), nullable=False),
        sa.Column('unit', sa.String(length=20), nullable=False, server_default='portion'),
        sa.Column('unit_cost', sa.Numeric(10, 3), nullable=False, server_default='0'),
        sa.ForeignKeyConstraint(['meal_log_id'], ['meal_log.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['recipe_id'], ['recipes.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )

    # ------------------------------------------------------ Main Store
    main_id = conn.execute(sa.text("SELECT id FROM cost_centers WHERE label = :l"), {"l": MAIN_STORE}).scalar()
    if main_id is None:
        main_id = uuid.uuid4()
        conn.execute(sa.text("INSERT INTO cost_centers (id, label) VALUES (:i, :l)"), {"i": main_id, "l": MAIN_STORE})

    # ------------------------------------------- batches become located
    op.add_column('food_inventory_batches', sa.Column('cost_center_id', sa.Uuid(), nullable=True))
    op.execute(sa.text("UPDATE food_inventory_batches SET cost_center_id = :m").bindparams(m=main_id))
    bare = conn.execute(sa.text(
        "SELECT fi.id, fi.qty, fi.cost, fi.expiry FROM food_inventory fi WHERE fi.qty > 0 AND NOT EXISTS "
        "(SELECT 1 FROM food_inventory_batches b WHERE b.food_inventory_id = fi.id)"
    )).fetchall()
    for fid, qty, cost, expiry in bare:
        conn.execute(sa.text(
            "INSERT INTO food_inventory_batches (id, food_inventory_id, batch_label, qty, expiry, cost, received_date, "
            "cost_center_id) VALUES (:i, :f, 'Opening', :q, :e, :c, :d, :m)"
        ), {"i": uuid.uuid4(), "f": fid, "q": qty, "e": expiry, "c": cost, "d": date.today(), "m": main_id})
    op.alter_column('food_inventory_batches', 'cost_center_id', nullable=False)
    op.create_foreign_key(
        'fk_food_inventory_batches_cost_center', 'food_inventory_batches', 'cost_centers',
        ['cost_center_id'], ['id'], ondelete='RESTRICT',
    )

    # --------------------------------- general stock balances + OPENING rows
    for inv_id, stock_qty in conn.execute(sa.text("SELECT id, stock FROM inventory WHERE stock > 0")).fetchall():
        conn.execute(sa.text(
            "INSERT INTO inventory_balances (id, inventory_id, cost_center_id, qty) VALUES (:i, :inv, :m, :q)"
        ), {"i": uuid.uuid4(), "inv": inv_id, "m": main_id, "q": stock_qty})
    opening = conn.execute(sa.text(
        "SELECT b.id, b.qty, b.cost, fi.id, fi.name, fi.unit FROM food_inventory_batches b "
        "JOIN food_inventory fi ON fi.id = b.food_inventory_id WHERE b.qty > 0"
    )).fetchall()
    ins = (
        "INSERT INTO stock_movements (id, txn_type, stock_type, stock_id, item_name, unit, to_cost_center_id, qty, "
        "unit_cost, total_value, batch_id, status) VALUES (:id, 'OPENING', :t, :sid, :n, :u, :m, :q, :c, :v, :b, 'Posted')"
    )
    for batch_id, qty, cost, fid, name, unit in opening:
        conn.execute(sa.text(ins), {"id": uuid.uuid4(), "t": "food", "sid": fid, "n": name, "u": unit, "m": main_id,
                                    "q": qty, "c": cost, "v": float(qty) * float(cost), "b": batch_id})
    for inv_id, name, unit, qty, avg in conn.execute(sa.text(
        "SELECT id, name, unit, stock, avg_price FROM inventory WHERE stock > 0"
    )).fetchall():
        conn.execute(sa.text(ins), {"id": uuid.uuid4(), "t": "general", "sid": inv_id, "n": name, "u": unit, "m": main_id,
                                    "q": qty, "c": avg, "v": float(qty) * float(avg), "b": None})

    # --------------------------------------------------------- meal_log
    _workflow_columns('meal_log')
    _backfill_codes(conn, 'meal_log', 'ML')
    op.add_column('meal_log', sa.Column('cost_center_id', sa.Uuid(), nullable=True))
    for mid, label, dish, recipe_id, qty, unit_cost in conn.execute(sa.text(
        "SELECT id, cost_center, dish, recipe_id, qty, unit_cost FROM meal_log"
    )).fetchall():
        cc = conn.execute(sa.text("SELECT id FROM cost_centers WHERE label = :l"), {"l": label}).scalar() if label else None
        conn.execute(sa.text("UPDATE meal_log SET cost_center_id = :c WHERE id = :i"), {"c": cc or main_id, "i": mid})
        conn.execute(sa.text(
            "INSERT INTO meal_log_lines (id, meal_log_id, recipe_id, dish, qty, unit, unit_cost) "
            "VALUES (:i, :m, :r, :d, :q, 'portion', :u)"
        ), {"i": uuid.uuid4(), "m": mid, "r": recipe_id, "d": dish, "q": qty, "u": unit_cost})
    op.alter_column('meal_log', 'cost_center_id', nullable=False)
    op.create_foreign_key('fk_meal_log_cost_center_id', 'meal_log', 'cost_centers', ['cost_center_id'], ['id'], ondelete='RESTRICT')
    op.alter_column('meal_log', 'category', nullable=True)
    for col in ('dish', 'recipe_id', 'qty', 'unit_cost'):
        op.drop_column('meal_log', col)
    _mark_legacy_closed('meal_log', 'logged_by')

    # --------------------------------------------------- stock_transfers
    _workflow_columns('stock_transfers')
    _backfill_codes(conn, 'stock_transfers', 'RT')
    _add_cost_center('stock_transfers', 'from_cost_center_id', main_id)
    op.add_column('stock_transfers', sa.Column('to_cost_center_id', sa.Uuid(), nullable=True))
    op.create_foreign_key('fk_stock_transfers_to_cost_center', 'stock_transfers', 'cost_centers',
                          ['to_cost_center_id'], ['id'], ondelete='RESTRICT')
    op.add_column('stock_transfer_lines', sa.Column('unit_cost', sa.Numeric(12, 6), nullable=False, server_default='0'))
    op.execute(sa.text(
        "UPDATE stock_transfer_lines l SET unit_cost = fi.cost FROM food_inventory fi WHERE fi.id = l.food_inventory_id"
    ))
    _mark_legacy_closed('stock_transfers', 'logged_by')

    # ------------------------------------------------------- waste_log
    _workflow_columns('waste_log', with_status=False)
    op.alter_column('waste_log', 'status', server_default='Draft')
    _backfill_codes(conn, 'waste_log', 'WL')
    _add_cost_center('waste_log', 'cost_center_id', main_id)
    op.execute(sa.text(
        "UPDATE waste_log SET submitted_by = logged_by, submitted_at = created_at, "
        "approved_by = reviewed_by, approved_at = CASE WHEN reviewed_by IS NULL THEN NULL ELSE created_at END, "
        "status = CASE status WHEN 'Pending Review' THEN 'Submitted' ELSE 'Approved' END"
    ))

    # ------------------------------------------------------------ grns
    _workflow_columns('grns')
    _add_cost_center('grns', 'receiving_cost_center_id', main_id)
    op.add_column('grns', sa.Column('notes', sa.String(), nullable=True))
    _mark_legacy_closed('grns', 'received_by')
    op.add_column('grn_lines', sa.Column('expiry', sa.Date(), nullable=True))
    op.add_column('grn_lines', sa.Column('batch_label', sa.String(length=40), nullable=True))

    # ---------------------------------------------------- stock_counts
    _add_cost_center('stock_counts', 'cost_center_id', main_id, nullable=True)


def downgrade() -> None:
    raise NotImplementedError("cost center locations / stock ledger migration is one-way")
