"""ledger: account_config goal/other-income + cash_flow table

Revision ID: e1a2b3c4d5e6
Revises: dc4f392e7cd0
Create Date: 2026-07-01 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e1a2b3c4d5e6'
down_revision: Union[str, Sequence[str], None] = 'dc4f392e7cd0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Predictive-ledger inputs on the per-account config (both nullable = unset).
    op.add_column('account_config', sa.Column('year_end_goal', sa.Numeric(precision=16, scale=2), nullable=True))
    op.add_column('account_config', sa.Column('other_annual_income', sa.Numeric(precision=16, scale=2), nullable=True))

    # Outside money in/out (deposits/wires/withdrawals): Schwab-auto + manual.
    op.create_table(
        'cash_flow',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('account_hash', sa.String(length=64), nullable=False),
        sa.Column('day', sa.Date(), nullable=False),
        sa.Column('amount', sa.Numeric(precision=16, scale=2), nullable=False),
        sa.Column('kind', sa.String(length=16), nullable=False),
        sa.Column('source', sa.String(length=12), nullable=False),
        sa.Column('memo', sa.String(length=256), nullable=True),
        sa.Column('schwab_txn_id', sa.String(length=64), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_cash_flow_account_hash', 'cash_flow', ['account_hash'])
    op.create_unique_constraint('uq_cash_flow_schwab_txn_id', 'cash_flow', ['schwab_txn_id'])


def downgrade() -> None:
    op.drop_constraint('uq_cash_flow_schwab_txn_id', 'cash_flow', type_='unique')
    op.drop_index('ix_cash_flow_account_hash', table_name='cash_flow')
    op.drop_table('cash_flow')
    op.drop_column('account_config', 'other_annual_income')
    op.drop_column('account_config', 'year_end_goal')
