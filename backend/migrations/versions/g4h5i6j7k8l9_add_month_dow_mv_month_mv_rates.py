"""add crash_month, day_of_week_num columns and mv_crashes_by_month, mv_crash_rates

Two new pre-extracted columns on crashes (same pattern as crash_hour/crash_year),
plus two new materialized views:
  - mv_crashes_by_month: seasonality charts without EXTRACT on 11M rows
  - mv_crash_rates: per-capita/per-driver/per-mile normalization

Issue: #139 (supersedes #103, #104, #105)

Revision ID: g4h5i6j7k8l9
Revises: e6f7a8b9c0d1
Create Date: 2026-05-02 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'g4h5i6j7k8l9'
down_revision: Union[str, None] = 'e6f7a8b9c0d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- New columns on crashes ---
    op.add_column("crashes", sa.Column("crash_month", sa.SmallInteger))
    op.add_column("crashes", sa.Column("day_of_week_num", sa.SmallInteger))
    op.create_index("ix_crashes_crash_month", "crashes", ["crash_month"])
    op.create_index("ix_crashes_day_of_week_num", "crashes", ["day_of_week_num"])

    # --- mv_crashes_by_month: powers seasonality chart ---
    op.execute("""
        CREATE MATERIALIZED VIEW mv_crashes_by_month AS
        SELECT
            county_code,
            crash_year,
            crash_month,
            COALESCE(severity, 'Unknown') AS severity,
            COALESCE(canonical_cause, 'uncategorized') AS canonical_cause,
            COUNT(*)::integer AS crash_count,
            COALESCE(SUM(number_killed), 0)::integer AS total_killed,
            COALESCE(SUM(number_injured), 0)::integer AS total_injured
        FROM crashes
        WHERE crash_month IS NOT NULL AND crash_year IS NOT NULL
        GROUP BY county_code, crash_year, crash_month, severity, canonical_cause
        WITH NO DATA
    """)
    op.execute("""
        CREATE UNIQUE INDEX ix_mv_crashes_by_month_pk
        ON mv_crashes_by_month
        (county_code, crash_year, crash_month, severity, canonical_cause)
    """)
    op.execute("""
        CREATE INDEX ix_mv_crashes_by_month_county_year
        ON mv_crashes_by_month (county_code, crash_year)
    """)

    # --- mv_crash_rates: per-capita normalization ---
    op.execute("""
        CREATE MATERIALIZED VIEW mv_crash_rates AS
        SELECT
            y.county_code,
            y.crash_year,
            y.severity,
            y.crash_count AS total_crashes,
            y.total_killed,
            y.total_injured,
            ROUND((y.crash_count * 100000.0 / NULLIF(d.population, 0))::numeric, 2)
                AS per_100k_population,
            ROUND((y.crash_count * 10000.0 / NULLIF(ld.driver_count, 0))::numeric, 2)
                AS per_10k_licensed_drivers,
            ROUND((y.crash_count * 100.0 / NULLIF(rm.total_miles, 0))::numeric, 2)
                AS per_100_road_miles,
            ROUND((y.crash_count * 100000.0 / NULLIF(tv.total_aadt, 0))::numeric, 2)
                AS per_100k_aadt,
            ROUND((y.crash_count * 10000.0 / NULLIF(vr.total_vehicles, 0))::numeric, 2)
                AS per_10k_vehicles
        FROM mv_crashes_by_year y
        LEFT JOIN demographics d
            ON d.county_code = y.county_code AND d.year = y.crash_year
        LEFT JOIN licensed_drivers ld
            ON ld.county_code = y.county_code AND ld.year = y.crash_year
        LEFT JOIN (
            SELECT county_code, SUM(total_miles) AS total_miles
            FROM road_miles
            GROUP BY county_code
        ) rm ON rm.county_code = y.county_code
        LEFT JOIN traffic_volumes tv
            ON tv.county_code = y.county_code
        LEFT JOIN vehicle_registrations vr
            ON vr.county_code = y.county_code AND vr.year = y.crash_year
        WITH NO DATA
    """)
    op.execute("""
        CREATE UNIQUE INDEX ix_mv_crash_rates_pk
        ON mv_crash_rates (county_code, crash_year, severity)
    """)
    op.execute("""
        CREATE INDEX ix_mv_crash_rates_year_severity
        ON mv_crash_rates (crash_year, severity)
    """)


def downgrade() -> None:
    op.execute("DROP MATERIALIZED VIEW IF EXISTS mv_crash_rates")
    op.execute("DROP MATERIALIZED VIEW IF EXISTS mv_crashes_by_month")
    op.drop_index("ix_crashes_day_of_week_num", table_name="crashes")
    op.drop_index("ix_crashes_crash_month", table_name="crashes")
    op.drop_column("crashes", "day_of_week_num")
    op.drop_column("crashes", "crash_month")
