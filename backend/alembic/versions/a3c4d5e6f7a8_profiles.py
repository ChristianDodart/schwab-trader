"""profiles: profile table + widen app_setting.key for profile-scoped keys

Revision ID: a3c4d5e6f7a8
Revises: f2b3c4d5e6f7
Create Date: 2026-07-01 01:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3c4d5e6f7a8'
down_revision: Union[str, Sequence[str], None] = 'f2b3c4d5e6f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'profile',
        sa.Column('id', sa.String(length=36), primary_key=True),
        sa.Column('name', sa.String(length=64), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    # Profile-scoped setting keys are prefixed `p:{id}:...`, which can exceed 64 chars.
    op.alter_column('app_setting', 'key',
                    existing_type=sa.String(length=64), type_=sa.String(length=96),
                    existing_nullable=False)


def downgrade() -> None:
    op.alter_column('app_setting', 'key',
                    existing_type=sa.String(length=96), type_=sa.String(length=64),
                    existing_nullable=False)
    op.drop_table('profile')
