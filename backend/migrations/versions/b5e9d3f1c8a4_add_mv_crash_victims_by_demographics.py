"""create materialized view mv_crash_victims_by_demographics

Powers /api/stats?group_by=gender|age_bracket. Joins crash_victims to
crashes on (collision_id, data_source) — see docs/db-schema.md for why
that's the only correct join key — and aggregates victim counts by
(county, year, severity, gender, age_bracket).

Age brackets mirror the demographics convention (under_18, 18_24, 25_44,
45_64, 65_plus) so victim distributions can be compared against county
population distributions without re-bucketing.

Estimated size: 58 counties × ~25 years × 4 severities × 4 genders ×
6 age buckets = ~140K rows.

Refresh is concurrent (UNIQUE index below); the ETL orchestrator
(issue #101) should refresh this alongside the existing 3 MVs.

Revision ID: b5e9d3f1c8a4
Revises: a4f8c2d9e1b3
Create Date: 2026-04-18 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'b5e9d3f1c8a4'
down_revision: Union[str, None] = 'a4f8c2d9e1b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # GROUP BY must use the same COALESCE/CASE expressions as SELECT so that
    # rows where (e.g.) cv.gender is NULL don't form a separate group from
    # rows where cv.gender = 'U' — both collapse to 'U' in the SELECT and
    # would otherwise violate the UNIQUE index below on first refresh.
    op.execute("""
        CREATE MATERIALIZED VIEW mv_crash_victims_by_demographics AS
        SELECT
            c.county_code,
            c.crash_year,
            COALESCE(c.severity, 'Unknown') AS severity,
            COALESCE(cv.gender, 'U') AS gender,
            CASE
                WHEN cv.age IS NULL THEN 'unknown'
                WHEN cv.age < 18  THEN 'under_18'
                WHEN cv.age <= 24 THEN '18_24'
                WHEN cv.age <= 44 THEN '25_44'
                WHEN cv.age <= 64 THEN '45_64'
                ELSE 'over_65'
            END AS age_bracket,
            COUNT(*)::integer AS victim_count,
            SUM(CASE WHEN cv.injury_severity = 'Fatal' THEN 1 ELSE 0 END)::integer AS fatal_victim_count
        FROM crash_victims cv
        JOIN crashes c
          ON c.collision_id = cv.collision_id
         AND c.data_source = cv.data_source
        WHERE c.crash_year IS NOT NULL
        GROUP BY
            c.county_code,
            c.crash_year,
            COALESCE(c.severity, 'Unknown'),
            COALESCE(cv.gender, 'U'),
            CASE
                WHEN cv.age IS NULL THEN 'unknown'
                WHEN cv.age < 18  THEN 'under_18'
                WHEN cv.age <= 24 THEN '18_24'
                WHEN cv.age <= 44 THEN '25_44'
                WHEN cv.age <= 64 THEN '45_64'
                ELSE 'over_65'
            END
        WITH NO DATA
    """)
    # UNIQUE index required for REFRESH CONCURRENTLY.
    op.execute("""
        CREATE UNIQUE INDEX ix_mv_crash_victims_by_demographics_pk
        ON mv_crash_victims_by_demographics
        (county_code, crash_year, severity, gender, age_bracket)
    """)
    op.execute("""
        CREATE INDEX ix_mv_crash_victims_by_demographics_county_year
        ON mv_crash_victims_by_demographics (county_code, crash_year)
    """)


def downgrade() -> None:
    op.execute("DROP MATERIALIZED VIEW IF EXISTS mv_crash_victims_by_demographics")
