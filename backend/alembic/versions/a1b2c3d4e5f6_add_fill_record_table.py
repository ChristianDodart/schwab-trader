"""add fill_record table (persistent fill ledger)

Dialect note: this migration RUNS on existing SQLite desktop installs (they are
stamped and upgrade incrementally), so everything here must be SQLite-safe —
CURRENT_TIMESTAMP (not now()), plain create_table (no ALTER of existing rows).

Revision ID: a1b2c3d4e5f6
Revises: c8d9e0f1a2b3
Create Date: 2026-07-06
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'c8d9e0f1a2b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'fill_record',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('account_hash', sa.String(length=64), nullable=False),
        sa.Column('symbol', sa.String(length=16), nullable=False),
        sa.Column('side', sa.String(length=4), nullable=False),
        sa.Column('shares', sa.Numeric(precision=14, scale=4), nullable=False),
        sa.Column('price', sa.Numeric(precision=14, scale=4), nullable=False),
        sa.Column('at', sa.DateTime(), nullable=False),
        sa.Column('trade_date', sa.Date(), nullable=False),
        sa.Column('order_type', sa.String(length=16), nullable=True),
        sa.Column('order_id', sa.String(length=32), nullable=True),
        sa.Column('source', sa.String(length=8), nullable=False),
        sa.Column('fill_key', sa.String(length=180), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('fill_key'),
        sqlite_autoincrement=True,
    )
    op.create_index(op.f('ix_fill_record_account_hash'), 'fill_record', ['account_hash'], unique=False)
    op.create_index(op.f('ix_fill_record_symbol'), 'fill_record', ['symbol'], unique=False)
    op.create_index(op.f('ix_fill_record_trade_date'), 'fill_record', ['trade_date'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_fill_record_trade_date'), table_name='fill_record')
    op.drop_index(op.f('ix_fill_record_symbol'), table_name='fill_record')
    op.drop_index(op.f('ix_fill_record_account_hash'), table_name='fill_record')
    op.drop_table('fill_record')
