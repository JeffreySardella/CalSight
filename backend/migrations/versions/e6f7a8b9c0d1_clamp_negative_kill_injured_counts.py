"""clamp negative number_killed and number_injured to zero

Revision ID: e6f7a8b9c0d1
Revises: d4e5f6a7b8c9
Create Date: 2026-04-26 00:00:00.000000

5 crashes had number_killed < 0 (impossible values that survived ETL).
They caused total_killed: -1 in /api/stats?group_by=severity for the Injury
bucket. Clamp them to 0 here; the ETL is also fixed to prevent new negatives.
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'e6f7a8b9c0d1'
down_revision: Union[str, None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE crashes SET number_killed  = 0 WHERE number_killed  < 0")
    op.execute("UPDATE crashes SET number_injured = 0 WHERE number_injured < 0")


def downgrade() -> None:
    pass
