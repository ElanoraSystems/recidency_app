"""recipe photos and diet tags

Revision ID: d4f6b8a0c2e3
Revises: c3e5a7b9d1f2
Create Date: 2026-10-07 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'd4f6b8a0c2e3'
down_revision: Union[str, None] = 'c3e5a7b9d1f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('recipes', sa.Column('diet_tags', postgresql.JSONB(), server_default='[]', nullable=False))
    op.create_table(
        'recipe_photos',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('recipe_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('recipes.id', ondelete='CASCADE'), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('content_type', sa.String(length=40), nullable=False),
        sa.Column('data', sa.LargeBinary(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_recipe_photos_recipe_id', 'recipe_photos', ['recipe_id'])


def downgrade() -> None:
    op.drop_index('ix_recipe_photos_recipe_id', table_name='recipe_photos')
    op.drop_table('recipe_photos')
    op.drop_column('recipes', 'diet_tags')
