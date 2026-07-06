"""cash_flow: per-account unique on (account_hash, schwab_txn_id)

Schwab's activityId/transactionId is only unique WITHIN an account, so a global
unique on schwab_txn_id could drop/reject another account's transfer that shares
an id. Swap it for a composite unique.

Revision ID: f2b3c4d5e6f7
Revises: e1a2b3c4d5e6
Create Date: 2026-07-01 00:30:00.000000
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'f2b3c4d5e6f7'
down_revision: Union[str, Sequence[str], None] = 'e1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint('uq_cash_flow_schwab_txn_id', 'cash_flow', type_='unique')
    op.create_unique_constraint('uq_cash_flow_account_txn', 'cash_flow', ['account_hash', 'schwab_txn_id'])


def downgrade() -> None:
    op.drop_constraint('uq_cash_flow_account_txn', 'cash_flow', type_='unique')
    op.create_unique_constraint('uq_cash_flow_schwab_txn_id', 'cash_flow', ['schwab_txn_id'])
