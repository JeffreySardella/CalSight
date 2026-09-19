"""add mv_crashes_by_day

One row per county per calendar day: crashes, killed, injured and the DUI
subset. Nothing else in the schema carries day-of-month — mv_crashes_wide
stops at (year, month, day-of-week, hour) — so a question like "the Wednesday
before Thanksgiving" could only be answered by scanning the 11.6M-row crashes
table. This view is ~530k rows (58 counties x ~25 years) and answers it with
an index range scan.

Serves /api/holidays ("Holidays on the road"). Created WITH NO DATA plus the
unique index REFRESH ... CONCURRENTLY requires; the nightly refresh job
populates it. The endpoint returns an empty payload rather than an error while
it is unpopulated, so this view is registered as OPTIONAL in app/health.py and
does not gate the site-wide rebuilding banner.

`dui_crashes` uses canonical_cause = 'dui' — the same definition the county
insight cards use for their DUI share (etl/generate_county_cards.py). The
is_alcohol_involved flag is deliberately not used here: it is NULL for every
SWITRS row, so a share built on it would be silently understated wherever
SWITRS is the source.

Revision ID: e15a88b36527
Revises: 7ab20fdc7c98
Create Date: 2026-09-18 21:01:48.743196
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e15a88b36527'
down_revision: Union[str, None] = '7ab20fdc7c98'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE MATERIALIZED VIEW mv_crashes_by_day AS
        SELECT
            county_code,
            crash_datetime::date                                     AS day,
            COUNT(*)::integer                                        AS crashes,
            COALESCE(SUM(number_killed), 0)::integer                 AS killed,
            COALESCE(SUM(number_injured), 0)::integer                AS injured,
            COUNT(*) FILTER (WHERE canonical_cause = 'dui')::integer AS dui_crashes
        FROM crashes
        WHERE crash_datetime IS NOT NULL
        GROUP BY county_code, crash_datetime::date
        WITH NO DATA
    """)
    # Unique index is what makes REFRESH MATERIALIZED VIEW CONCURRENTLY legal,
    # and it doubles as the (day) range scan the endpoint needs.
    op.execute("""
        CREATE UNIQUE INDEX ix_mv_crashes_by_day_pk
        ON mv_crashes_by_day (county_code, day)
    """)
    op.execute("""
        CREATE INDEX ix_mv_crashes_by_day_day
        ON mv_crashes_by_day (day)
    """)


def downgrade() -> None:
    op.execute("DROP MATERIALIZED VIEW IF EXISTS mv_crashes_by_day")
