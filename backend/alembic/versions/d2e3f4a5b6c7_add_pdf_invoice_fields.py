"""add pdf invoice fields

Revision ID: d2e3f4a5b6c7
Revises: c1d2e3f4a5b6
Create Date: 2026-09-06 00:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd2e3f4a5b6c7'
down_revision: Union[str, None] = 'c1d2e3f4a5b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('suppliers', sa.Column('email', sa.String(length=200), nullable=True))

    op.add_column('purchase_orders', sa.Column('created_by', sa.Uuid(), nullable=True))
    op.add_column('purchase_orders', sa.Column('approved_by', sa.Uuid(), nullable=True))
    op.create_foreign_key(
        'purchase_orders_created_by_fkey', 'purchase_orders', 'users', ['created_by'], ['id'], ondelete='SET NULL'
    )
    op.create_foreign_key(
        'purchase_orders_approved_by_fkey', 'purchase_orders', 'users', ['approved_by'], ['id'], ondelete='SET NULL'
    )

    op.add_column('residence_settings', sa.Column('logo_path', sa.String(length=500), nullable=True))
    op.add_column('residence_settings', sa.Column('address', sa.String(length=300), nullable=True))
    op.add_column('residence_settings', sa.Column('phone', sa.String(length=50), nullable=True))
    op.add_column('residence_settings', sa.Column('terms_and_conditions', sa.String(), nullable=True))

    op.add_column('meal_log', sa.Column('produced_for', sa.String(length=200), nullable=True))


def downgrade() -> None:
    op.drop_column('meal_log', 'produced_for')

    op.drop_column('residence_settings', 'terms_and_conditions')
    op.drop_column('residence_settings', 'phone')
    op.drop_column('residence_settings', 'address')
    op.drop_column('residence_settings', 'logo_path')

    op.drop_constraint('purchase_orders_approved_by_fkey', 'purchase_orders', type_='foreignkey')
    op.drop_constraint('purchase_orders_created_by_fkey', 'purchase_orders', type_='foreignkey')
    op.drop_column('purchase_orders', 'approved_by')
    op.drop_column('purchase_orders', 'created_by')

    op.drop_column('suppliers', 'email')
