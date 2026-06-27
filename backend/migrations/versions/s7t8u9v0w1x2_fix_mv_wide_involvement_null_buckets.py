"""Fix mv_crashes_wide: involvement flags must keep NULL as its own bucket

HIGH-1 data-correctness bug. The involvement flags (f_alcohol, f_distracted,
f_pedestrian, f_cyclist, f_drug) were encoded 2-valued:

    CASE WHEN pedestrian_involved THEN 1 ELSE 0 END

In SQL, a NULL boolean falls through to ELSE, so the ~6.8M SWITRS rows where
involvement is genuinely *unknown* were stamped 0 ("false"). A `=false` filter
on /api/stats (which reads this MV) therefore counted those unknowns, while
/api/crashes (raw table, `column IS FALSE`) excluded them — the two endpoints
disagreed by ~2.7x.

Fix: encode the involvement flags 3-valued, exactly like is_highway directly
above them (NULL -> -1). A `f_* = 0` (false) or `f_* = 1` (true) filter then
excludes unknowns, matching the `.is_(False)` / `.is_(True)` semantics on the
raw table. No router/filters.py change is needed — the == 0 / == 1 comparisons
in stats.py already do the right thing once -1 means "unknown".

This is a structural redefinition only (the GROUP BY now buckets unknowns into
their own group). The MV is recreated WITH NO DATA; the deploy/ETL refresh step
repopulates it. On prod, follow with:
    REFRESH MATERIALIZED VIEW mv_crashes_wide;

Revision ID: s7t8u9v0w1x2
Revises: r6s7t8u9v0w1
Create Date: 2026-06-26 00:00:00.000000
"""
from typing import Sequence, Union
from alembic import op

revision: str = "s7t8u9v0w1x2"
down_revision: Union[str, None] = "r6s7t8u9v0w1"
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
            CASE WHEN is_alcohol_involved     IS NULL THEN -1 WHEN is_alcohol_involved     THEN 1 ELSE 0 END AS f_alcohol,
            CASE WHEN is_distraction_involved IS NULL THEN -1 WHEN is_distraction_involved THEN 1 ELSE 0 END AS f_distracted,
            CASE WHEN pedestrian_involved     IS NULL THEN -1 WHEN pedestrian_involved     THEN 1 ELSE 0 END AS f_pedestrian,
            CASE WHEN cyclist_involved        IS NULL THEN -1 WHEN cyclist_involved        THEN 1 ELSE 0 END AS f_cyclist,
            CASE WHEN is_drug_involved        IS NULL THEN -1 WHEN is_drug_involved        THEN 1 ELSE 0 END AS f_drug,
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
    # Restore the prior 2-valued involvement encoding (NULL collapses to 0).
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
