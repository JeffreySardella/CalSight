"""Add day_of_week_num, crash_month, crash_hour to mv_crashes_wide

These three temporal columns were missing from the MV, forcing
hour/month/day_of_week queries to scan the raw 11M-row crashes table
even when involvement filters were active. Adding them to the GROUP BY
lets stats.py use the pre-aggregated MV for all temporal facets.

Revision ID: p4q5r6s7t8u9
Revises: l0m1n2o3p4q5
Create Date: 2026-05-20 00:00:00.000000
"""
from typing import Sequence, Union
from alembic import op

revision: str = "p4q5r6s7t8u9"
down_revision: Union[str, None] = "o3p4q5r6s7t8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.execute("DROP MATERIALIZED VIEW IF EXISTS mv_crashes_wide")
    op.execute("""
        CREATE MATERIALIZED VIEW mv_crashes_wide AS
        SELECT
            county_code,
            crash_year,
            severity,
            COALESCE(canonical_cause, 'uncategorized')    AS canonical_cause,
            COALESCE(canonical_weather, 'unknown')        AS canonical_weather,
            COALESCE(canonical_lighting, 'unknown')       AS canonical_lighting,
            COALESCE(canonical_collision_type, 'unknown')  AS canonical_collision_type,
            CASE WHEN is_highway IS NULL THEN -1 WHEN is_highway THEN 1 ELSE 0 END AS is_highway,
            CASE WHEN is_alcohol_involved     THEN 1 ELSE 0 END AS f_alcohol,
            CASE WHEN is_distraction_involved THEN 1 ELSE 0 END AS f_distracted,
            CASE WHEN pedestrian_involved     THEN 1 ELSE 0 END AS f_pedestrian,
            CASE WHEN cyclist_involved        THEN 1 ELSE 0 END AS f_cyclist,
            CASE WHEN is_drug_involved        THEN 1 ELSE 0 END AS f_drug,
            CASE WHEN hit_run IS NOT NULL     THEN 1 ELSE 0 END AS f_hit_run,
            CASE
                WHEN at_fault_driver_age BETWEEN 16 AND 21 THEN 1
                WHEN at_fault_driver_age BETWEEN 22 AND 34 THEN 2
                WHEN at_fault_driver_age BETWEEN 35 AND 49 THEN 3
                WHEN at_fault_driver_age BETWEEN 50 AND 64 THEN 4
                WHEN at_fault_driver_age >= 65 THEN 5
                ELSE 0
            END                                           AS age_bracket,
            day_of_week_num,
            crash_month,
            crash_hour,
            COUNT(*)                                      AS crash_count,
            COALESCE(SUM(number_killed), 0)               AS total_killed,
            COALESCE(SUM(number_injured), 0)              AS total_injured
        FROM crashes
        WHERE crash_year IS NOT NULL
        GROUP BY
            county_code, crash_year, severity, canonical_cause,
            canonical_weather, canonical_lighting, canonical_collision_type,
            is_highway, f_alcohol, f_distracted, f_pedestrian, f_cyclist, f_drug,
            f_hit_run, age_bracket,
            day_of_week_num, crash_month, crash_hour
        WITH NO DATA
    """)
    op.execute("""
        CREATE UNIQUE INDEX ix_mv_crashes_wide_pk
        ON mv_crashes_wide (
            county_code, crash_year, severity, canonical_cause,
            canonical_weather, canonical_lighting, canonical_collision_type,
            is_highway, f_alcohol, f_distracted, f_pedestrian, f_cyclist, f_drug,
            f_hit_run, age_bracket,
            day_of_week_num, crash_month, crash_hour
        )
    """)

def downgrade() -> None:
    op.execute("DROP MATERIALIZED VIEW IF EXISTS mv_crashes_wide")
    op.execute("""
        CREATE MATERIALIZED VIEW mv_crashes_wide AS
        SELECT
            county_code,
            crash_year,
            severity,
            COALESCE(canonical_cause, 'uncategorized')    AS canonical_cause,
            COALESCE(canonical_weather, 'unknown')        AS canonical_weather,
            COALESCE(canonical_lighting, 'unknown')       AS canonical_lighting,
            COALESCE(canonical_collision_type, 'unknown')  AS canonical_collision_type,
            CASE WHEN is_highway IS NULL THEN -1 WHEN is_highway THEN 1 ELSE 0 END AS is_highway,
            CASE WHEN is_alcohol_involved     THEN 1 ELSE 0 END AS f_alcohol,
            CASE WHEN is_distraction_involved THEN 1 ELSE 0 END AS f_distracted,
            CASE WHEN pedestrian_involved     THEN 1 ELSE 0 END AS f_pedestrian,
            CASE WHEN cyclist_involved        THEN 1 ELSE 0 END AS f_cyclist,
            CASE WHEN is_drug_involved        THEN 1 ELSE 0 END AS f_drug,
            CASE WHEN hit_run IS NOT NULL     THEN 1 ELSE 0 END AS f_hit_run,
            CASE
                WHEN at_fault_driver_age BETWEEN 16 AND 21 THEN 1
                WHEN at_fault_driver_age BETWEEN 22 AND 34 THEN 2
                WHEN at_fault_driver_age BETWEEN 35 AND 49 THEN 3
                WHEN at_fault_driver_age BETWEEN 50 AND 64 THEN 4
                WHEN at_fault_driver_age >= 65 THEN 5
                ELSE 0
            END                                           AS age_bracket,
            COUNT(*)                                      AS crash_count,
            COALESCE(SUM(number_killed), 0)               AS total_killed,
            COALESCE(SUM(number_injured), 0)              AS total_injured
        FROM crashes
        WHERE crash_year IS NOT NULL
        GROUP BY
            county_code, crash_year, severity, canonical_cause,
            canonical_weather, canonical_lighting, canonical_collision_type,
            is_highway, f_alcohol, f_distracted, f_pedestrian, f_cyclist, f_drug,
            f_hit_run, age_bracket
        WITH NO DATA
    """)
    op.execute("""
        CREATE UNIQUE INDEX ix_mv_crashes_wide_pk
        ON mv_crashes_wide (
            county_code, crash_year, severity, canonical_cause,
            canonical_weather, canonical_lighting, canonical_collision_type,
            is_highway, f_alcohol, f_distracted, f_pedestrian, f_cyclist, f_drug,
            f_hit_run, age_bracket
        )
    """)
