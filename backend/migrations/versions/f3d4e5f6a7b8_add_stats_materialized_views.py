"""create materialized views for StatsPage dashboard queries

Three pre-aggregated views that serve the dashboard's most common filter
combinations. Instead of GROUP BY on 11M rows per API request, the API
reads ~100-150K rows of pre-computed aggregates.

Views:
  mv_crashes_by_hour   — (county, year, severity, cause, hour) → count
                         ~150K rows, powers the 24-hour time-of-day chart
  mv_crashes_by_cause  — (county, year, severity, cause) → count, killed, injured
                         ~30K rows, powers the "top causes" chart
  mv_crashes_by_year   — (county, year, severity) → count, killed, injured
                         ~6K rows, powers the yearly trend chart

Each view has a UNIQUE index on its grouping columns so that
`REFRESH MATERIALIZED VIEW CONCURRENTLY` works — refresh won't block reads.

The views depend on the denormalized columns from migration f2c3d4e5f6a7
(crash_year, canonical_cause, severity). That migration's backfill must
run before a meaningful initial refresh of these views — raw CREATE
MATERIALIZED VIEW here will work but might show many NULLs until the
backfills catch up.

Refresh is handled by etl.refresh_materialized_views, wired into
run_all_etl.sh as the last step before vacuum_analyze.

Revision ID: f3d4e5f6a7b8
Revises: f2c3d4e5f6a7
Create Date: 2026-04-17 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'f3d4e5f6a7b8'
down_revision: Union[str, None] = 'f2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- mv_crashes_by_hour: powers the 24-hour time-of-day chart ---
    op.execute("""
        CREATE MATERIALIZED VIEW mv_crashes_by_hour AS
        SELECT
            county_code,
            crash_year,
            COALESCE(severity, 'Unknown') AS severity,
            COALESCE(canonical_cause, 'uncategorized') AS canonical_cause,
            crash_hour,
            COUNT(*)::integer AS crash_count
        FROM crashes
        WHERE crash_hour IS NOT NULL
          AND crash_year IS NOT NULL
        GROUP BY county_code, crash_year, severity, canonical_cause, crash_hour
        WITH NO DATA
    """)
    # UNIQUE index is required for REFRESH CONCURRENTLY.
    op.execute("""
        CREATE UNIQUE INDEX ix_mv_crashes_by_hour_pk
        ON mv_crashes_by_hour
        (county_code, crash_year, severity, canonical_cause, crash_hour)
    """)
    # Narrow index for "all hours in county X, year Y" — most common query.
    op.execute("""
        CREATE INDEX ix_mv_crashes_by_hour_county_year
        ON mv_crashes_by_hour (county_code, crash_year)
    """)

    # --- mv_crashes_by_cause: powers the "top causes" chart ---
    op.execute("""
        CREATE MATERIALIZED VIEW mv_crashes_by_cause AS
        SELECT
            county_code,
            crash_year,
            COALESCE(severity, 'Unknown') AS severity,
            COALESCE(canonical_cause, 'uncategorized') AS canonical_cause,
            COUNT(*)::integer AS crash_count,
            COALESCE(SUM(number_killed), 0)::integer AS total_killed,
            COALESCE(SUM(number_injured), 0)::integer AS total_injured
        FROM crashes
        WHERE crash_year IS NOT NULL
        GROUP BY county_code, crash_year, severity, canonical_cause
        WITH NO DATA
    """)
    op.execute("""
        CREATE UNIQUE INDEX ix_mv_crashes_by_cause_pk
        ON mv_crashes_by_cause
        (county_code, crash_year, severity, canonical_cause)
    """)
    op.execute("""
        CREATE INDEX ix_mv_crashes_by_cause_county_year
        ON mv_crashes_by_cause (county_code, crash_year)
    """)

    # --- mv_crashes_by_year: powers the yearly trend chart ---
    op.execute("""
        CREATE MATERIALIZED VIEW mv_crashes_by_year AS
        SELECT
            county_code,
            crash_year,
            COALESCE(severity, 'Unknown') AS severity,
            COUNT(*)::integer AS crash_count,
            COALESCE(SUM(number_killed), 0)::integer AS total_killed,
            COALESCE(SUM(number_injured), 0)::integer AS total_injured
        FROM crashes
        WHERE crash_year IS NOT NULL
        GROUP BY county_code, crash_year, severity
        WITH NO DATA
    """)
    op.execute("""
        CREATE UNIQUE INDEX ix_mv_crashes_by_year_pk
        ON mv_crashes_by_year
        (county_code, crash_year, severity)
    """)
    op.execute("""
        CREATE INDEX ix_mv_crashes_by_year_county
        ON mv_crashes_by_year (county_code)
    """)


def downgrade() -> None:
    op.execute("DROP MATERIALIZED VIEW IF EXISTS mv_crashes_by_year")
    op.execute("DROP MATERIALIZED VIEW IF EXISTS mv_crashes_by_cause")
    op.execute("DROP MATERIALIZED VIEW IF EXISTS mv_crashes_by_hour")
