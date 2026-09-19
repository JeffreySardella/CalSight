"""add mv_school_crash_counts — crashes within 500 ft of each school

/api/schools/crash-counts colors the school marker layer by how many crashes
happened next to each school. Computing that live means ~10K schools x a
bounding-box probe into the 11.3M-row crashes table on every request, so it
is precomputed here and refreshed nightly like the other rollups.

Method (no PostGIS in this database):
  - Bounding box first, on the existing partial btree ix_crashes_lat_lng
    (latitude, longitude WHERE both NOT NULL). 500 ft = 0.0947 statute miles
    = 0.00136 degrees of latitude. A degree of longitude is shorter away from
    the equator, so the longitude half-width is divided by cos(lat). CA spans
    32.5-42.0 degrees, where cos(lat) is 0.74-0.84 — never near zero.
  - Then an exact equirectangular distance inside the box, which drops the
    box corners. Haversine would be more correct over long distances; at
    500 ft the flat-earth error is far below the precision of the crash
    coordinates themselves, and this avoids acos() domain clamping.

severe_injured reads crashes.number_severe_injured (migration 50bbb1251cb7)
rather than re-aggregating crash_victims: that column is the KSI count the
rest of the app already uses, and joining victims here would mean a second
pass over a 25M-row table per school.

Design notes (same rules as mv_street_aggregates, c4f1a9b2d3e7):
  - Created WITH NO DATA so `alembic upgrade head` stays instant during
    deploy. etl/refresh_materialized_views.py populates it on its next run;
    until then the endpoint returns an empty list rather than erroring.
  - The unique index on (school_id, year) is what REFRESH ... CONCURRENTLY
    requires. Both columns are non-NULL by construction: school_locations.id
    is the PK and crash_year IS NULL rows are filtered out, so no sentinel
    encoding is needed here.
  - No index on school_id alone — the unique index already leads with it.

Revision ID: 10f264138733
Revises: 50bbb1251cb7
Create Date: 2026-09-18 20:07:43.354188
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '10f264138733'
down_revision: Union[str, None] = '50bbb1251cb7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# 500 ft expressed both ways: as a latitude delta for the index-friendly
# bounding box, and as miles for the exact cutoff.
_HALF_BOX_DEG = "0.00136"
_RADIUS_MILES = "0.0947"
_MILES_PER_DEG_LAT = "69.0"

CREATE_VIEW = f"""
CREATE MATERIALIZED VIEW mv_school_crash_counts AS
SELECT
    s.id                                    AS school_id,
    c.crash_year                            AS year,
    count(*)                                AS crashes,
    COALESCE(sum(c.number_killed), 0)       AS killed,
    COALESCE(sum(c.number_injured), 0)      AS injured,
    COALESCE(sum(c.number_severe_injured), 0) AS severe_injured
FROM school_locations s
JOIN crashes c
  ON c.latitude  BETWEEN s.latitude - {_HALF_BOX_DEG}
                     AND s.latitude + {_HALF_BOX_DEG}
 AND c.longitude BETWEEN s.longitude - ({_HALF_BOX_DEG} / cos(radians(s.latitude)))
                     AND s.longitude + ({_HALF_BOX_DEG} / cos(radians(s.latitude)))
WHERE s.latitude IS NOT NULL
  AND s.longitude IS NOT NULL
  AND c.latitude IS NOT NULL
  AND c.longitude IS NOT NULL
  AND c.crash_year IS NOT NULL
  AND (
        {_MILES_PER_DEG_LAT} * sqrt(
            power(c.latitude - s.latitude, 2)
          + power((c.longitude - s.longitude) * cos(radians(s.latitude)), 2)
        )
      ) <= {_RADIUS_MILES}
GROUP BY s.id, c.crash_year
WITH NO DATA
"""

# Required for REFRESH ... CONCURRENTLY, which keeps the view readable while
# the nightly refresh runs.
CREATE_UNIQUE_INDEX = """
CREATE UNIQUE INDEX ux_mv_school_crash_counts_key
    ON mv_school_crash_counts (school_id, year)
"""

# The endpoint sums a set of years across every school, so year leads here.
CREATE_YEAR_INDEX = """
CREATE INDEX ix_mv_school_crash_counts_year
    ON mv_school_crash_counts (year)
"""


def upgrade() -> None:
    op.execute(CREATE_VIEW)
    op.execute(CREATE_UNIQUE_INDEX)
    op.execute(CREATE_YEAR_INDEX)
    # The API role reads this view like any other table. Guarded because the
    # role doesn't exist in CI/test databases (same pattern as
    # c4f1a9b2d3e7_add_mv_street_aggregates).
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'calsight_api_ro') THEN
                GRANT SELECT ON mv_school_crash_counts TO calsight_api_ro;
            END IF;
        END
        $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP MATERIALIZED VIEW IF EXISTS mv_school_crash_counts")
