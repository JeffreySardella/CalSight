"""add mv_street_aggregates for street-level crash aggregation

/api/intersections and /api/corridors group the full crashes table by
normalized road name. Two regexp_replace calls over 11.3M rows plus the
GROUP BY outgrew the statement timeout: statewide intersections 503'd and
statewide corridors took ~30s on every request (the in-process result cache
never helped, because each uvicorn worker holds its own copy and a given
request lands on whichever worker is free).

This view precomputes the expensive part — the name normalization and the
per-(county, road-pair, year) rollup — so the endpoints aggregate a narrow,
already-grouped table instead of scanning the wide raw one.

Design notes:
  - Created WITH NO DATA so the migration is instant. `alembic upgrade head`
    runs during deploy before traffic is served; populating 11.3M rows there
    would stall the deploy. The nightly refresh populates it, and the
    endpoints fall back to the live query until then.
  - Every unique-index column is mapped to a non-NULL sentinel because
    REFRESH MATERIALIZED VIEW CONCURRENTLY requires a usable unique index.
    crash_year, secondary_road, pedestrian_involved and cyclist_involved are
    all nullable on crashes.
  - The involvement flags become a THREE-valued smallint (0 false / 1 true /
    2 unknown), not a COALESCE to false. The endpoints filter with
    `pedestrian_involved IS TRUE` / `IS FALSE`, both of which exclude NULL —
    so folding NULL into false would silently pull "unknown" crashes into
    every `?cyclist=false` result. The equivalence tests caught exactly this.
  - crash_year unknown is stored as 0, never a real year. With no year filter
    those rows are included; with `crash_year >= year_start` they drop out —
    which is exactly what the live query does, since NULL >= 2020 is NULL.
  - Latitude/longitude are stored as sum + count rather than AVG. The
    endpoints re-aggregate across years and road pairs, and averaging
    averages would silently weight a road-year with 3 crashes the same as one
    with 3,000.

Revision ID: c4f1a9b2d3e7
Revises: 9ded93edd291
Create Date: 2026-08-07 09:00:00.000000
"""
from typing import Sequence, Union

from alembic import op


revision: str = "c4f1a9b2d3e7"
down_revision: Union[str, None] = "9ded93edd291"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


CREATE_VIEW = """
CREATE MATERIALIZED VIEW mv_street_aggregates AS
SELECT
    c.county_code AS county_code,
    upper(regexp_replace(btrim(c.primary_road), '\\s+', ' ', 'g')) AS primary_road,
    COALESCE(
        upper(regexp_replace(btrim(c.secondary_road), '\\s+', ' ', 'g')),
        ''
    ) AS secondary_road,
    COALESCE(c.crash_year, 0) AS crash_year,
    CASE WHEN c.pedestrian_involved IS NULL THEN 2
         WHEN c.pedestrian_involved THEN 1
         ELSE 0 END AS pedestrian_state,
    CASE WHEN c.cyclist_involved IS NULL THEN 2
         WHEN c.cyclist_involved THEN 1
         ELSE 0 END AS cyclist_state,
    count(*) AS crash_count,
    count(*) FILTER (WHERE c.severity = 'Fatal') AS fatal_count,
    count(*) FILTER (WHERE c.severity = 'Injury') AS injury_count,
    count(*) FILTER (WHERE c.severity = 'Property Damage Only') AS pdo_count,
    COALESCE(sum(c.number_killed), 0) AS killed,
    COALESCE(sum(c.number_injured), 0) AS injured,
    sum(c.latitude) AS lat_sum,
    count(c.latitude) AS lat_n,
    sum(c.longitude) AS lon_sum,
    count(c.longitude) AS lon_n
FROM crashes c
WHERE c.primary_road IS NOT NULL
  AND btrim(c.primary_road) <> ''
GROUP BY 1, 2, 3, 4, 5, 6
WITH NO DATA
"""

# Required for REFRESH ... CONCURRENTLY, which keeps the view readable while
# the nightly refresh runs.
CREATE_UNIQUE_INDEX = """
CREATE UNIQUE INDEX ux_mv_street_aggregates_key
    ON mv_street_aggregates (
        county_code, primary_road, secondary_road,
        crash_year, pedestrian_state, cyclist_state
    )
"""

# County-scoped lookups are the common case; statewide falls back to a scan of
# this (much smaller, already-normalized) view.
CREATE_COUNTY_INDEX = """
CREATE INDEX ix_mv_street_aggregates_county_primary
    ON mv_street_aggregates (county_code, primary_road)
"""

# Intersections filter to rows that actually have a secondary road.
CREATE_SECONDARY_INDEX = """
CREATE INDEX ix_mv_street_aggregates_secondary
    ON mv_street_aggregates (county_code, primary_road, secondary_road)
    WHERE secondary_road <> ''
"""


def upgrade() -> None:
    op.execute(CREATE_VIEW)
    op.execute(CREATE_UNIQUE_INDEX)
    op.execute(CREATE_COUNTY_INDEX)
    op.execute(CREATE_SECONDARY_INDEX)
    # The API role reads this view like any other table. Guarded because the
    # role doesn't exist in CI/test databases (same pattern as the
    # chat_feedback grant migration).
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'calsight_api_ro') THEN
                GRANT SELECT ON mv_street_aggregates TO calsight_api_ro;
            END IF;
        END
        $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP MATERIALIZED VIEW IF EXISTS mv_street_aggregates")
