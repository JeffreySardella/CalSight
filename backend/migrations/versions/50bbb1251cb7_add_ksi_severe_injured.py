"""add crashes.number_severe_injured and total_severe_injured on the stats matviews

KSI = people killed or seriously injured. This adds the per-crash seriously
injured count and carries it into the three matviews /api/stats reads for
year, county, cause, severity and grand totals.

1. crashes.number_severe_injured SMALLINT NOT NULL DEFAULT 0. A constant
   default is metadata-only on PG11+, so no row is rewritten, and the
   backfills (backfill_derived for CCRS, backfill_switrs_ksi for SWITRS) write
   only the ~3% of crashes that have a seriously injured person.
   It runs in an autocommit block because env.py wraps the whole upgrade in
   one transaction: otherwise ADD COLUMN's ACCESS EXCLUSIVE lock on crashes
   would be held through the matview builds below (minutes), blocking the
   map, /api/crashes and the nightly ETL. lock_timeout 5s stops it queuing
   behind a long read; if it times out the deploy fails cleanly and a re-run
   is safe (ADD COLUMN IF NOT EXISTS).

2. mv_crashes_by_year / mv_crashes_by_cause / mv_crashes_wide gain
   total_severe_injured. Each is built as <name>_new WITH DATA (plus its
   indexes) while the old view keeps serving, then the old one is dropped and
   the new one renamed in, all inside the migration transaction, so /api/stats
   never sees an empty view. Reads block (not fail) for a few seconds at the
   swap. Definitions are pg_get_viewdef output from prod (2026-09-18) with one
   column added. The older migrations have drifted from prod; do not copy them.

3. mv_crash_rates selects from mv_crashes_by_year, so it is dropped first and
   recreated with its live definition unchanged (no KSI there, by decision).

Grants: pg_default_acl already gives calsight_team read on objects calsight
creates. The guarded GRANTs cover a different migration role and
calsight_api_ro, which exists in neither prod nor CI (hence the guard).

Revision ID: 50bbb1251cb7
Revises: 77b8d6739669
Create Date: 2026-09-18 16:16:37.033060
"""
# migration-safety: matview swap. Each old stats view is dropped only after its
#   _new replacement is built, and the replacement is renamed into place with
#   the same columns plus total_severe_injured; crashes only gains a column.
from typing import Callable, Sequence, Union

from alembic import op


revision: str = "50bbb1251cb7"
down_revision: Union[str, None] = "77b8d6739669"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _by_year(name: str, severe: bool) -> str:
    severe_col = (
        ",\n    COALESCE(sum(number_severe_injured), 0::bigint)::integer AS total_severe_injured"
        if severe else ""
    )
    return f"""
CREATE MATERIALIZED VIEW {name} AS
 SELECT county_code,
    crash_year,
    COALESCE(severity, 'Unknown'::character varying) AS severity,
    count(*)::integer AS crash_count,
    COALESCE(sum(number_killed), 0::bigint)::integer AS total_killed,
    COALESCE(sum(number_injured), 0::bigint)::integer AS total_injured{severe_col}
   FROM crashes
  WHERE crash_year IS NOT NULL
  GROUP BY county_code, crash_year, severity
WITH DATA
"""


def _by_cause(name: str, severe: bool) -> str:
    severe_col = (
        ",\n    COALESCE(sum(number_severe_injured), 0::bigint)::integer AS total_severe_injured"
        if severe else ""
    )
    return f"""
CREATE MATERIALIZED VIEW {name} AS
 SELECT county_code,
    crash_year,
    COALESCE(severity, 'Unknown'::character varying) AS severity,
    COALESCE(canonical_cause, 'uncategorized'::character varying) AS canonical_cause,
    count(*)::integer AS crash_count,
    COALESCE(sum(number_killed), 0::bigint)::integer AS total_killed,
    COALESCE(sum(number_injured), 0::bigint)::integer AS total_injured{severe_col}
   FROM crashes
  WHERE crash_year IS NOT NULL
  GROUP BY county_code, crash_year, severity, canonical_cause
WITH DATA
"""


def _wide(name: str, severe: bool) -> str:
    # The wide view's sums are bigint (no ::integer) on prod; keep that style.
    severe_col = (
        ",\n    COALESCE(sum(number_severe_injured), 0::bigint) AS total_severe_injured"
        if severe else ""
    )
    return f"""
CREATE MATERIALIZED VIEW {name} AS
 SELECT county_code,
    crash_year,
    severity,
    COALESCE(canonical_cause, 'uncategorized'::character varying) AS canonical_cause,
    COALESCE(canonical_weather, 'unknown'::character varying) AS canonical_weather,
    COALESCE(canonical_lighting, 'unknown'::character varying) AS canonical_lighting,
    COALESCE(canonical_collision_type, 'unknown'::character varying) AS canonical_collision_type,
        CASE
            WHEN is_highway IS NULL THEN '-1'::integer
            WHEN is_highway THEN 1
            ELSE 0
        END AS is_highway,
        CASE
            WHEN is_alcohol_involved IS NULL THEN '-1'::integer
            WHEN is_alcohol_involved THEN 1
            ELSE 0
        END AS f_alcohol,
        CASE
            WHEN is_distraction_involved IS NULL THEN '-1'::integer
            WHEN is_distraction_involved THEN 1
            ELSE 0
        END AS f_distracted,
        CASE
            WHEN pedestrian_involved IS NULL THEN '-1'::integer
            WHEN pedestrian_involved THEN 1
            ELSE 0
        END AS f_pedestrian,
        CASE
            WHEN cyclist_involved IS NULL THEN '-1'::integer
            WHEN cyclist_involved THEN 1
            ELSE 0
        END AS f_cyclist,
        CASE
            WHEN is_drug_involved IS NULL THEN '-1'::integer
            WHEN is_drug_involved THEN 1
            ELSE 0
        END AS f_drug,
        CASE
            WHEN hit_run IS NOT NULL THEN 1
            ELSE 0
        END AS f_hit_run,
        CASE
            WHEN at_fault_driver_age >= 16 AND at_fault_driver_age <= 21 THEN 1
            WHEN at_fault_driver_age >= 22 AND at_fault_driver_age <= 34 THEN 2
            WHEN at_fault_driver_age >= 35 AND at_fault_driver_age <= 49 THEN 3
            WHEN at_fault_driver_age >= 50 AND at_fault_driver_age <= 64 THEN 4
            WHEN at_fault_driver_age >= 65 THEN 5
            ELSE 0
        END AS age_bracket,
    day_of_week_num,
    crash_month,
    crash_hour,
    count(*) AS crash_count,
    COALESCE(sum(number_killed), 0::bigint) AS total_killed,
    COALESCE(sum(number_injured), 0::bigint) AS total_injured{severe_col}
   FROM crashes
  WHERE crash_year IS NOT NULL
  GROUP BY county_code, crash_year, severity, canonical_cause, canonical_weather, canonical_lighting, canonical_collision_type, is_highway, (
        CASE
            WHEN is_alcohol_involved IS NULL THEN '-1'::integer
            WHEN is_alcohol_involved THEN 1
            ELSE 0
        END), (
        CASE
            WHEN is_distraction_involved IS NULL THEN '-1'::integer
            WHEN is_distraction_involved THEN 1
            ELSE 0
        END), (
        CASE
            WHEN pedestrian_involved IS NULL THEN '-1'::integer
            WHEN pedestrian_involved THEN 1
            ELSE 0
        END), (
        CASE
            WHEN cyclist_involved IS NULL THEN '-1'::integer
            WHEN cyclist_involved THEN 1
            ELSE 0
        END), (
        CASE
            WHEN is_drug_involved IS NULL THEN '-1'::integer
            WHEN is_drug_involved THEN 1
            ELSE 0
        END), (
        CASE
            WHEN hit_run IS NOT NULL THEN 1
            ELSE 0
        END), (
        CASE
            WHEN at_fault_driver_age >= 16 AND at_fault_driver_age <= 21 THEN 1
            WHEN at_fault_driver_age >= 22 AND at_fault_driver_age <= 34 THEN 2
            WHEN at_fault_driver_age >= 35 AND at_fault_driver_age <= 49 THEN 3
            WHEN at_fault_driver_age >= 50 AND at_fault_driver_age <= 64 THEN 4
            WHEN at_fault_driver_age >= 65 THEN 5
            ELSE 0
        END), day_of_week_num, crash_month, crash_hour
WITH DATA
"""


_VIEWS: dict[str, Callable[[str, bool], str]] = {
    "mv_crashes_by_year": _by_year,
    "mv_crashes_by_cause": _by_cause,
    "mv_crashes_wide": _wide,
}

# (index name, "UNIQUE " or "", columns). Names match prod pg_indexes
# (2026-09-18). The unique ones are what REFRESH ... CONCURRENTLY needs.
_INDEXES: dict[str, list[tuple[str, str, str]]] = {
    "mv_crashes_by_year": [
        ("ix_mv_crashes_by_year_pk", "UNIQUE ", "(county_code, crash_year, severity)"),
        ("ix_mv_crashes_by_year_county", "", "(county_code)"),
    ],
    "mv_crashes_by_cause": [
        ("ix_mv_crashes_by_cause_pk", "UNIQUE ", "(county_code, crash_year, severity, canonical_cause)"),
        ("ix_mv_crashes_by_cause_county_year", "", "(county_code, crash_year)"),
    ],
    "mv_crashes_wide": [
        (
            "ix_mv_crashes_wide_pk",
            "UNIQUE ",
            "(county_code, crash_year, severity, canonical_cause, canonical_weather, "
            "canonical_lighting, canonical_collision_type, is_highway, f_alcohol, "
            "f_distracted, f_pedestrian, f_cyclist, f_drug, f_hit_run, age_bracket, "
            "day_of_week_num, crash_month, crash_hour)",
        ),
    ],
    "mv_crash_rates": [
        ("ix_mv_crash_rates_pk", "UNIQUE ", "(county_code, crash_year, severity)"),
        ("ix_mv_crash_rates_year_severity", "", "(crash_year, severity)"),
    ],
}

# Live definition, unchanged. Recreated only because it depends on mv_crashes_by_year.
_CRASH_RATES = """
CREATE MATERIALIZED VIEW mv_crash_rates AS
 SELECT y.county_code,
    y.crash_year,
    y.severity,
    y.crash_count AS total_crashes,
    y.total_killed,
    y.total_injured,
    round(y.crash_count::numeric * 100000.0 / NULLIF(d.population, 0)::numeric, 2) AS per_100k_population,
    round(y.crash_count::numeric * 10000.0 / NULLIF(ld.driver_count, 0)::numeric, 2) AS per_10k_licensed_drivers,
    round(((y.crash_count::numeric * 100.0)::double precision / NULLIF(rm.total_miles, 0::double precision))::numeric, 2) AS per_100_road_miles,
    round(y.crash_count::numeric * 100000.0 / NULLIF(tv.total_aadt, 0)::numeric, 2) AS per_100k_aadt,
    round(y.crash_count::numeric * 10000.0 / NULLIF(vr.total_vehicles, 0)::numeric, 2) AS per_10k_vehicles
   FROM mv_crashes_by_year y
     LEFT JOIN demographics d ON d.county_code = y.county_code AND d.year = y.crash_year
     LEFT JOIN licensed_drivers ld ON ld.county_code = y.county_code AND ld.year = y.crash_year
     LEFT JOIN ( SELECT road_miles.county_code,
            sum(road_miles.total_miles) AS total_miles
           FROM road_miles
          GROUP BY road_miles.county_code) rm ON rm.county_code = y.county_code
     LEFT JOIN traffic_volumes tv ON tv.county_code = y.county_code
     LEFT JOIN vehicle_registrations vr ON vr.county_code = y.county_code AND vr.year = y.crash_year
WITH DATA
"""

_GRANTS = """
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'calsight_team') THEN
        GRANT SELECT ON mv_crashes_by_year, mv_crashes_by_cause, mv_crashes_wide, mv_crash_rates TO calsight_team;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'calsight_api_ro') THEN
        GRANT SELECT ON mv_crashes_by_year, mv_crashes_by_cause, mv_crashes_wide, mv_crash_rates TO calsight_api_ro;
    END IF;
END
$$;
"""


def _rebuild_views(severe: bool) -> None:
    """Build <view>_new beside each live view, then swap them in."""
    for view, build in _VIEWS.items():
        op.execute(build(f"{view}_new", severe))
        for ix, unique, cols in _INDEXES[view]:
            op.execute(f"CREATE {unique}INDEX {ix}_new ON {view}_new {cols}")

    # From the first DROP to commit, the old views are ACCESS EXCLUSIVE locked.
    # 60s covers waiting out an in-flight REFRESH ... CONCURRENTLY; past that
    # the deploy fails cleanly and can be re-run.
    op.execute("SET LOCAL lock_timeout = '60s'")
    op.execute("DROP MATERIALIZED VIEW mv_crash_rates")  # the only dependent of mv_crashes_by_year
    for view in _VIEWS:
        # No CASCADE: an unexpected dependent must fail the migration, not vanish.
        op.execute(f"DROP MATERIALIZED VIEW {view}")
        op.execute(f"ALTER MATERIALIZED VIEW {view}_new RENAME TO {view}")
        for ix, _unique, _cols in _INDEXES[view]:
            op.execute(f"ALTER INDEX {ix}_new RENAME TO {ix}")

    op.execute(_CRASH_RATES)
    for ix, unique, cols in _INDEXES["mv_crash_rates"]:
        op.execute(f"CREATE {unique}INDEX {ix} ON mv_crash_rates {cols}")

    # Planner stats now (not at the next nightly VACUUM ANALYZE); also what
    # /api/pipeline-health reads as the matview age.
    for view in (*_VIEWS, "mv_crash_rates"):
        op.execute(f"ANALYZE {view}")
    op.execute(_GRANTS)


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("SET lock_timeout = '5s'")
        op.execute(
            "ALTER TABLE crashes ADD COLUMN IF NOT EXISTS "
            "number_severe_injured smallint NOT NULL DEFAULT 0"
        )
        # Session-level SET would otherwise leak into the swap transaction.
        op.execute("RESET lock_timeout")
    _rebuild_views(severe=True)


def downgrade() -> None:
    # Views first (they reference the column), then drop the column.
    _rebuild_views(severe=False)
    with op.get_context().autocommit_block():
        op.execute("SET lock_timeout = '5s'")
        op.execute("ALTER TABLE crashes DROP COLUMN IF EXISTS number_severe_injured")
        op.execute("RESET lock_timeout")
