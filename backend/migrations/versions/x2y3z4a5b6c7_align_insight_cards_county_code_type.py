"""align county_insight_cards.county_code with counties.code (smallint)

DB audit (2026-07-09, issue #292): county_insight_cards.county_code was
declared Integer while its FK target counties.code — and every other
county_code column in the schema — is SmallInteger. The type mismatch
forces an implicit cast in FK checks and joins and is simply inconsistent.
Values are CA county codes (1-58), so SMALLINT is always sufficient.

USING cast is safe and rewrites in place; the table is ~2K rows.

Revision ID: x2y3z4a5b6c7
Revises: w1x2y3z4a5b6
Create Date: 2026-07-10 00:00:01.000000
"""
from typing import Sequence, Union

from alembic import op

revision: str = "x2y3z4a5b6c7"
down_revision: Union[str, None] = "w1x2y3z4a5b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE county_insight_cards "
        "ALTER COLUMN county_code TYPE SMALLINT "
        "USING county_code::smallint"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE county_insight_cards "
        "ALTER COLUMN county_code TYPE INTEGER "
        "USING county_code::integer"
    )
