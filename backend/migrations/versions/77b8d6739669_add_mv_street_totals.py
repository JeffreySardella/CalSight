"""add mv_street_totals — coarse street rollups for the statewide default state

mv_street_aggregates (c4f1a9b2d3e7) fixed the *county-scoped* street queries,
but statewide it is still a ~7M-row GROUP BY: it keeps (year, pedestrian,
cyclist) so the filters can be answered, and the unfiltered default page
state has to fold all of that back down on every cache miss. Measured live
2026-09-12: /api/intersections 15.3s, /api/corridors 7.2s,
/api/street-concentration 9.2s — each pinning a pool connection.

This view holds the *already folded* rollups the default state actually
reads, one row per street unit, so the top-N queries become an index walk
(`WHERE grain = ? ORDER BY crash_count DESC LIMIT 25`) and the concentration
curve reads ~0.5–2.7M narrow rows instead of grouping 11.6M.

Four grains, in one view via GROUPING SETS, tagged by GROUPING(county_code,
secondary_road) — the bit for the first argument is the most significant:
  0 = (county, primary, secondary)   /api/intersections, county concentration
  1 = (county, primary)              /api/corridors
  2 = (primary, secondary)           statewide intersection concentration
  3 = (primary)                      statewide corridor concentration
Grains 2/3 exist because _concentration deliberately groups statewide
streets by name only, not by (county, name) — "MAIN ST" is one unit across
the state there, matching the live query it replaces.

Design notes carried over from c4f1a9b2d3e7: WITH NO DATA (populated by the
nightly refresh; the endpoints fall back until then), '' / 0 sentinels so
the unique index REFRESH CONCURRENTLY needs is usable, and the same
name normalization so both views group identically.

severity_score is stored (fatal*100 + injury*10 + pdo) so `?sort=severity`
can walk an index too. The weights duplicate _W_FATAL/_W_INJURY/_W_PDO in
app/routers/intersections.py; keep them in step.

Revision ID: 77b8d6739669
Revises: fa863b601b57
Create Date: 2026-09-12 23:00:00.000000
"""
from typing import Sequence, Union

from alembic import op


revision: str = "77b8d6739669"
down_revision: Union[str, None] = "fa863b601b57"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


CREATE_VIEW = """
CREATE MATERIALIZED VIEW mv_street_totals AS
WITH roads AS (
    SELECT
        c.county_code,
        upper(regexp_replace(btrim(c.primary_road), '\\s+', ' ', 'g')) AS primary_road,
        COALESCE(
            upper(regexp_replace(btrim(c.secondary_road), '\\s+', ' ', 'g')),
            ''
        ) AS secondary_road,
        c.severity,
        c.number_killed,
        c.number_injured,
        c.latitude,
        c.longitude
    FROM crashes c
    WHERE c.primary_road IS NOT NULL
      AND btrim(c.primary_road) <> ''
)
SELECT
    GROUPING(county_code, secondary_road) AS grain,
    COALESCE(county_code, 0) AS county_code,
    primary_road,
    COALESCE(secondary_road, '') AS secondary_road,
    count(*) AS crash_count,
    count(*) FILTER (WHERE severity = 'Fatal') AS fatal_count,
    count(*) FILTER (WHERE severity = 'Injury') AS injury_count,
    count(*) FILTER (WHERE severity = 'Property Damage Only') AS pdo_count,
    count(*) FILTER (WHERE severity = 'Fatal') * 100
        + count(*) FILTER (WHERE severity = 'Injury') * 10
        + count(*) FILTER (WHERE severity = 'Property Damage Only') AS severity_score,
    COALESCE(sum(number_killed), 0) AS killed,
    COALESCE(sum(number_injured), 0) AS injured,
    avg(latitude) AS latitude,
    avg(longitude) AS longitude
FROM roads
GROUP BY GROUPING SETS (
    (county_code, primary_road, secondary_road),
    (county_code, primary_road),
    (primary_road, secondary_road),
    (primary_road)
)
WITH NO DATA
"""

# Required for REFRESH ... CONCURRENTLY. Also serves county-scoped reads.
CREATE_UNIQUE_INDEX = """
CREATE UNIQUE INDEX ux_mv_street_totals_key
    ON mv_street_totals (grain, county_code, primary_road, secondary_road)
"""

# The two top-N orderings the endpoints use, each behind the grain so a
# statewide `ORDER BY ... LIMIT n` is a short index walk, not a sort.
CREATE_COUNT_INDEX = """
CREATE INDEX ix_mv_street_totals_by_count
    ON mv_street_totals (grain, crash_count DESC, fatal_count DESC)
"""

CREATE_SEVERITY_INDEX = """
CREATE INDEX ix_mv_street_totals_by_severity
    ON mv_street_totals (grain, severity_score DESC, fatal_count DESC)
"""


def upgrade() -> None:
    op.execute(CREATE_VIEW)
    op.execute(CREATE_UNIQUE_INDEX)
    op.execute(CREATE_COUNT_INDEX)
    op.execute(CREATE_SEVERITY_INDEX)
    # Guarded: the API role doesn't exist in CI/test databases.
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'calsight_api_ro') THEN
                GRANT SELECT ON mv_street_totals TO calsight_api_ro;
            END IF;
        END
        $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP MATERIALIZED VIEW IF EXISTS mv_street_totals")
