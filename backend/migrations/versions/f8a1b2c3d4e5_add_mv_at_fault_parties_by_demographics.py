"""create materialized view mv_at_fault_parties_by_demographics

Powers /api/stats?group_by=at_fault_gender|at_fault_age_bracket. Mirrors
mv_crash_victims_by_demographics (b5e9d3f1c8a4) but counts AT-FAULT parties
(typically drivers) instead of victims. Useful for the "who causes crashes"
question that complements the "who gets hurt" question covered by the
victim view.

Source: crash_parties WHERE at_fault = TRUE, joined to crashes on
(collision_id, data_source) — see docs/db-schema.md for why both columns
are required.

Estimated size: similar order to victim view (~140K rows). One row per
(county, year, severity, gender, age_bracket).

Refresh is concurrent (UNIQUE index below); add to refresh_materialized_views.

Revision ID: f8a1b2c3d4e5
Revises: e2f3a4b5c6d7
Create Date: 2026-05-09 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'f8a1b2c3d4e5'
down_revision: Union[str, None] = 'e2f3a4b5c6d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # GROUP BY uses the same COALESCE/CASE expressions as SELECT so that
    # NULL-gender rows fold into 'U' and don't form a separate group from
    # rows where cp.gender = 'U' — same trick as the victim MV migration.
    op.execute("""
        CREATE MATERIALIZED VIEW mv_at_fault_parties_by_demographics AS
        SELECT
            c.county_code,
            c.crash_year,
            COALESCE(c.severity, 'Unknown') AS severity,
            COALESCE(cp.gender, 'U') AS gender,
            CASE
                WHEN cp.age IS NULL THEN 'unknown'
                WHEN cp.age < 18  THEN 'under_18'
                WHEN cp.age <= 24 THEN '18_24'
                WHEN cp.age <= 44 THEN '25_44'
                WHEN cp.age <= 64 THEN '45_64'
                ELSE 'over_65'
            END AS age_bracket,
            COUNT(*)::integer AS party_count,
            SUM(CASE WHEN c.severity = 'Fatal' THEN 1 ELSE 0 END)::integer AS fatal_party_count
        FROM crash_parties cp
        JOIN crashes c
          ON c.collision_id = cp.collision_id
         AND c.data_source = cp.data_source
        WHERE cp.at_fault = TRUE
          AND c.crash_year IS NOT NULL
        GROUP BY
            c.county_code,
            c.crash_year,
            COALESCE(c.severity, 'Unknown'),
            COALESCE(cp.gender, 'U'),
            CASE
                WHEN cp.age IS NULL THEN 'unknown'
                WHEN cp.age < 18  THEN 'under_18'
                WHEN cp.age <= 24 THEN '18_24'
                WHEN cp.age <= 44 THEN '25_44'
                WHEN cp.age <= 64 THEN '45_64'
                ELSE 'over_65'
            END
        WITH NO DATA
    """)
    # UNIQUE index required for REFRESH CONCURRENTLY.
    op.execute("""
        CREATE UNIQUE INDEX ix_mv_at_fault_parties_by_demographics_pk
        ON mv_at_fault_parties_by_demographics
        (county_code, crash_year, severity, gender, age_bracket)
    """)
    op.execute("""
        CREATE INDEX ix_mv_at_fault_parties_by_demographics_county_year
        ON mv_at_fault_parties_by_demographics (county_code, crash_year)
    """)


def downgrade() -> None:
    op.execute("DROP MATERIALIZED VIEW IF EXISTS mv_at_fault_parties_by_demographics")
