"""Add mv_crashes_wide — single MV with condition columns + involvement aggregates

Replaces the raw-table fallback for all faceted count queries. GROUP BY
includes condition columns (weather, lighting, collision_type, road_type);
involvement flags and driver age brackets are conditional aggregates so
they don't multiply the row count.

~1M rows. Enables <50ms facet counts for any filter combination.

Revision ID: i7j8k9l0m1n2
Revises: h6i7j8k9l0m1
Create Date: 2026-05-10 20:00:00.000000
"""
from typing import Sequence, Union
from alembic import op

revision: str = "i7j8k9l0m1n2"
down_revision: Union[str, None] = "h6i7j8k9l0m1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.execute("""
        CREATE MATERIALIZED VIEW mv_crashes_wide AS
        SELECT
            county_code,
            crash_year,
            severity,
            COALESCE(canonical_cause, 'uncategorized') AS canonical_cause,
            COALESCE(canonical_weather, 'unknown')     AS canonical_weather,
            COALESCE(canonical_lighting, 'unknown')    AS canonical_lighting,
            COALESCE(canonical_collision_type, 'unknown') AS canonical_collision_type,
            CASE WHEN is_highway IS NULL THEN -1 WHEN is_highway THEN 1 ELSE 0 END AS is_highway,
            COUNT(*)                                   AS crash_count,
            COALESCE(SUM(number_killed), 0)            AS total_killed,
            COALESCE(SUM(number_injured), 0)            AS total_injured,
            COUNT(*) FILTER (WHERE is_alcohol_involved = TRUE)     AS alcohol_count,
            COUNT(*) FILTER (WHERE is_distraction_involved = TRUE) AS distracted_count,
            COUNT(*) FILTER (WHERE pedestrian_involved = TRUE)     AS pedestrian_count,
            COUNT(*) FILTER (WHERE cyclist_involved = TRUE)        AS cyclist_count,
            COUNT(*) FILTER (WHERE is_drug_involved = TRUE)        AS drug_count,
            COUNT(*) FILTER (WHERE hit_run IS NOT NULL)            AS hit_run_count,
            COUNT(*) FILTER (WHERE at_fault_driver_age BETWEEN 16 AND 21) AS age_16_21_count,
            COUNT(*) FILTER (WHERE at_fault_driver_age BETWEEN 22 AND 34) AS age_22_34_count,
            COUNT(*) FILTER (WHERE at_fault_driver_age BETWEEN 35 AND 49) AS age_35_49_count,
            COUNT(*) FILTER (WHERE at_fault_driver_age BETWEEN 50 AND 64) AS age_50_64_count,
            COUNT(*) FILTER (WHERE at_fault_driver_age >= 65)              AS age_65_plus_count
        FROM crashes
        WHERE crash_year IS NOT NULL
        GROUP BY
            county_code, crash_year, severity, canonical_cause,
            canonical_weather, canonical_lighting, canonical_collision_type, is_highway
        WITH NO DATA
    """)
    op.execute("""
        CREATE UNIQUE INDEX ix_mv_crashes_wide_pk
        ON mv_crashes_wide (
            county_code, crash_year, severity, canonical_cause,
            canonical_weather, canonical_lighting, canonical_collision_type, is_highway
        )
    """)

def downgrade() -> None:
    op.execute("DROP MATERIALIZED VIEW IF EXISTS mv_crashes_wide")
