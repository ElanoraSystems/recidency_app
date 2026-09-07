"""add security role and patrol module

Revision ID: f4a5b6c7d8e9
Revises: d2e3f4a5b6c7
Create Date: 2026-09-06 00:20:00.000000

"""
import uuid
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f4a5b6c7d8e9'
down_revision: Union[str, None] = 'd2e3f4a5b6c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SECURITY_MODULES = ["dashboard", "tasks", "documents", "patrol"]


def upgrade() -> None:
    op.create_table('patrol_log',
    sa.Column('area_id', sa.Uuid(), nullable=True),
    sa.Column('staff_id', sa.Uuid(), nullable=True),
    sa.Column('scanned_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('notes', sa.String(), nullable=True),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(['area_id'], ['areas.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['staff_id'], ['staff_profiles.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    )

    # seed.py only runs against a brand-new database — this patches the data
    # into a database that was already seeded before this feature existed
    # (seed.py itself is also updated so a *fresh* seed ends up the same way).
    # Guard on residence_settings having a row (the same "already seeded?"
    # signal seed.py itself checks) so this migration is a no-op on a fresh
    # database — otherwise seed.py's own ROLE_NAV loop, which now also
    # creates "security", would collide with this one on the unique key.
    conn = op.get_bind()
    already_seeded = conn.execute(sa.text("SELECT 1 FROM residence_settings LIMIT 1")).scalar_one_or_none()
    if not already_seeded:
        return

    roles = sa.table('roles', sa.column('id', sa.Uuid()), sa.column('key', sa.String()), sa.column('label', sa.String()))
    rma = sa.table('role_module_access', sa.column('id', sa.Uuid()), sa.column('role_id', sa.Uuid()), sa.column('module', sa.String()))

    existing = conn.execute(sa.text("SELECT id FROM roles WHERE key = 'security'")).scalar_one_or_none()
    if not existing:
        security_role_id = uuid.uuid4()
        conn.execute(roles.insert().values(id=security_role_id, key='security', label='Security Guard'))
        for module in SECURITY_MODULES:
            conn.execute(rma.insert().values(id=uuid.uuid4(), role_id=security_role_id, module=module))

    manager_role_id = conn.execute(sa.text("SELECT id FROM roles WHERE key = 'manager'")).scalar_one_or_none()
    if manager_role_id:
        has_patrol = conn.execute(
            sa.text("SELECT 1 FROM role_module_access WHERE role_id = :rid AND module = 'patrol'"),
            {"rid": manager_role_id},
        ).scalar_one_or_none()
        if not has_patrol:
            conn.execute(rma.insert().values(id=uuid.uuid4(), role_id=manager_role_id, module='patrol'))


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("DELETE FROM role_module_access WHERE module = 'patrol'"))
    conn.execute(sa.text("DELETE FROM roles WHERE key = 'security'"))
    op.drop_table('patrol_log')
