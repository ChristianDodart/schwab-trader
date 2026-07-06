"""ticker sector column

Revision ID: b7c8d9e0f1a2
Revises: a3c4d5e6f7a8
Create Date: 2026-07-02 13:10:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7c8d9e0f1a2'
down_revision: Union[str, Sequence[str], None] = 'a3c4d5e6f7a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('ticker', sa.Column('sector', sa.String(length=48), nullable=True))


def downgrade() -> None:
    op.drop_column('ticker', 'sector')
