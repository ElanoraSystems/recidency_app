"""add waste log and waste reasons

Revision ID: c1d2e3f4a5b6
Revises: b2c3d4e5f6a7
Create Date: 2026-09-06 00:00:00.000000

"""
import uuid
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c1d2e3f4a5b6'
down_revision: Union[str, None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

WASTE_REASONS = ["Spoilage", "Overproduction", "Trim/Prep Waste", "Expired", "Dropped/Contaminated", "Other"]


def upgrade() -> None:
    waste_reasons = op.create_table('waste_reasons',
    sa.Column('label', sa.String(length=60), nullable=False),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('label')
    )

    op.create_table('waste_log',
    sa.Column('date', sa.Date(), nullable=False),
    sa.Column('reason', sa.String(length=60), nullable=False),
    sa.Column('notes', sa.String(), nullable=True),
    sa.Column('status', sa.String(length=20), nullable=False, server_default='Pending Review'),
    sa.Column('logged_by', sa.Uuid(), nullable=True),
    sa.Column('reviewed_by', sa.Uuid(), nullable=True),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['logged_by'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['reviewed_by'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    )

    op.create_table('waste_log_lines',
    sa.Column('waste_log_id', sa.Uuid(), nullable=False),
    sa.Column('food_inventory_id', sa.Uuid(), nullable=True),
    sa.Column('item_master_id', sa.Uuid(), nullable=True),
    sa.Column('ingredient_name', sa.String(length=150), nullable=False),
    sa.Column('qty', sa.Numeric(precision=12, scale=3), nullable=False),
    sa.Column('unit', sa.String(length=20), nullable=False),
    sa.Column('unit_cost', sa.Numeric(precision=12, scale=6), nullable=False, server_default='0'),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(['waste_log_id'], ['waste_log.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['food_inventory_id'], ['food_inventory.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['item_master_id'], ['item_master.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    )

    op.bulk_insert(waste_reasons, [{"id": uuid.uuid4(), "label": label} for label in WASTE_REASONS])


def downgrade() -> None:
    op.drop_table('waste_log_lines')
    op.drop_table('waste_log')
    op.drop_table('waste_reasons')
