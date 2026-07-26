"""price_alert: add account_hash (per-account notification routing)

A price alert now records which account owns it (the selected account when it was
created), so the notification it raises is gated by that account's prefs. Existing
alerts get NULL = legacy/global. Nullable add, SQLite-safe via batch.

Revision ID: a2f1c9d4e6b0
Revises: a1b2c3d4e5f6
Create Date: 2026-07-26 20:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a2f1c9d4e6b0'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('price_alert') as b:
        b.add_column(sa.Column('account_hash', sa.String(length=64), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('price_alert') as b:
        b.drop_column('account_hash')
