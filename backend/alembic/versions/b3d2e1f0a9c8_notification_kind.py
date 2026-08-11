"""notification: add kind (category for per-type unread pills)

Each notification now records its category (alert | trigger | fill | system) so the
Notifications nav tab can show a separate count pill per type. Existing rows get
NULL = legacy (bucketed as "other"). Nullable add, SQLite-safe via batch.

Revision ID: b3d2e1f0a9c8
Revises: a2f1c9d4e6b0
Create Date: 2026-08-11 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b3d2e1f0a9c8'
down_revision: Union[str, Sequence[str], None] = 'a2f1c9d4e6b0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('notification') as b:
        b.add_column(sa.Column('kind', sa.String(length=16), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('notification') as b:
        b.drop_column('kind')
