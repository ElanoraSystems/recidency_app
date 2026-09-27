"""add purchase request code and cost center

Revision ID: c9d0e1f2a3b4
Revises: b7c8d9e0f1a2
Create Date: 2026-09-28 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c9d0e1f2a3b4'
down_revision: Union[str, None] = 'b7c8d9e0f1a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('purchase_requests', sa.Column('code', sa.String(length=20), nullable=True))
    op.add_column('purchase_requests', sa.Column('cost_center', sa.String(length=80), nullable=True))

    conn = op.get_bind()
    rows = conn.execute(sa.text(
        "SELECT id FROM purchase_requests ORDER BY request_date, created_at"
    )).fetchall()
    for n, (row_id,) in enumerate(rows, start=3001):
        conn.execute(
            sa.text("UPDATE purchase_requests SET code = :code WHERE id = :id"),
            {"code": f"PR-{n}", "id": row_id},
        )

    op.alter_column('purchase_requests', 'code', nullable=False)
    op.create_unique_constraint('uq_purchase_requests_code', 'purchase_requests', ['code'])


def downgrade() -> None:
    op.drop_constraint('uq_purchase_requests_code', 'purchase_requests', type_='unique')
    op.drop_column('purchase_requests', 'cost_center')
    op.drop_column('purchase_requests', 'code')
