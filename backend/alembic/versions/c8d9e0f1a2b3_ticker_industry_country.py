"""ticker industry + country columns

Revision ID: c8d9e0f1a2b3
Revises: b7c8d9e0f1a2
Create Date: 2026-07-02 14:40:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c8d9e0f1a2b3'
down_revision: Union[str, Sequence[str], None] = 'b7c8d9e0f1a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('ticker', sa.Column('industry', sa.String(length=64), nullable=True))
    op.add_column('ticker', sa.Column('country', sa.String(length=8), nullable=True))


def downgrade() -> None:
    op.drop_column('ticker', 'country')
    op.drop_column('ticker', 'industry')
