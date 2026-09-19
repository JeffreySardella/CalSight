"""add mv_victims_by_mode — road-user mode (Vision Zero) as a chart dimension

Powers /api/stats?group_by=mode. Counts PEOPLE, not crashes: a crash that
hurts a pedestrian and two car occupants contributes 1 to pedestrian and 2
to occupant. Crash-level flags (crashes.pedestrian_involved /
cyclist_involved, mirrored as f_pedestrian / f_cyclist in mv_crashes_wide)
cannot answer this — 100 crashes in 2023 alone had both flags set, so a
crash-level "mode" group_by would double-count them, and there is no
crash-level flag for motorcyclists or occupants at all.

Mode is derived per victim from crash_victims.person_type, falling through
to the victim's own party row for the motorcyclist test:

  person_type = 'Pedestrian'                     -> pedestrian
  person_type = 'Bicyclist'                      -> cyclist
  person_type IN ('Driver','Passenger')
      AND that party's vehicle_type is a
      motorcycle/moped code (see below)          -> motorcyclist
  person_type IN ('Driver','Passenger')          -> occupant
  anything else (blank, 'Other',
      'AutonomousVehicle')                       -> excluded

MOTORCYCLE/MOPED vehicle_type codes (CCRS Vehicle1TypeDesc), measured
against the live parties table. Owner decision: mopeds and moped-class
scooters count as motorcyclists.
  'Motorcycle'                          142,827 parties
  'MotorDrivenCycleScooter15HpOrLess'     9,795   (CA "motor-driven cycle")
  'PoliceMotorcycle'                      1,948
  'MotorizedBicycle'                      1,440   (moped, CVC 406)
Deliberately NOT included: 'GoPedZipElectricScooterAndMotorboard' and
'ElectricallyMotorizedBoards' — stand-up micromobility (CVC 21220 / 21281),
a different road user from a moped rider. Their riders land in `occupant`,
which is imperfect but is ~0.1% of the people counted here.

COVERAGE: crash_victims / crash_parties are CCRS-only, so this view starts
at 2016. The UI carries a "Mode data starts in 2016 (CCRS)" footnote. No
explicit year predicate is needed — pre-2016 SWITRS crashes simply have no
victim rows, and any that appeared would have no person_type and be
excluded by `mode IS NOT NULL`.

WHAT victim_count MEANS: person_type is only recorded for people with an
injury outcome (every one of the 2.17M victim rows with a blank person_type
also has a blank injury_severity). So victim_count here is people injured or
killed, not everyone present. That is the Vision Zero framing and it is why
the uninjured cannot be classified at all.

severity is the CRASH's severity, carried at the same grain and with the same
COALESCE(..., 'Unknown') as b5e9d3f1c8a4 uses, so the dashboard's severity
filter applies to group_by=mode exactly as it does to gender/age_bracket.
"Pedestrian deaths by year" is the question this dimension exists for, and it
is asked with a severity filter on — the view has to be able to answer it.
Note the two casualty columns come from the VICTIM's own injury_severity, so
a fatal crash's non-fatal victims still count as injured people within it.

The LEFT JOIN LATERAL ... LIMIT 1 is not decoration: 32 (collision_id,
data_source, party_number) keys are duplicated in crash_parties, and a plain
JOIN would fan those victims out and inflate the counts.

Modeled on b5e9d3f1c8a4 (mv_crash_victims_by_demographics): WITH NO DATA,
populated by etl/refresh_materialized_views.py, unique index for
REFRESH ... CONCURRENTLY. Size is tiny — 58 counties x ~11 years x 4 modes.

Revision ID: bdc07f3141d1
Revises: 50bbb1251cb7
Create Date: 2026-09-18 21:41:00.000000
"""
from typing import Sequence, Union

from alembic import op


revision: str = "bdc07f3141d1"
down_revision: Union[str, None] = "50bbb1251cb7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Keep in step with etl/backfill_derived.py SERIOUS_INJURY_CODES.
CREATE_VIEW = """
CREATE MATERIALIZED VIEW mv_victims_by_mode AS
WITH classified AS (
    SELECT
        c.county_code,
        c.crash_year,
        COALESCE(c.severity, 'Unknown') AS severity,
        v.injury_severity,
        CASE
            WHEN v.person_type = 'Pedestrian' THEN 'pedestrian'
            WHEN v.person_type = 'Bicyclist'  THEN 'cyclist'
            WHEN v.person_type IN ('Driver', 'Passenger')
                 AND pv.vehicle_type IN (
                     'Motorcycle',
                     'PoliceMotorcycle',
                     'MotorDrivenCycleScooter15HpOrLess',
                     'MotorizedBicycle'
                 ) THEN 'motorcyclist'
            WHEN v.person_type IN ('Driver', 'Passenger') THEN 'occupant'
        END AS mode
    FROM crash_victims v
    JOIN crashes c
      ON c.collision_id = v.collision_id
     AND c.data_source  = v.data_source
    LEFT JOIN LATERAL (
        SELECT p.vehicle_type
        FROM crash_parties p
        WHERE p.collision_id = v.collision_id
          AND p.data_source  = v.data_source
          AND p.party_number = v.party_number
        LIMIT 1
    ) pv ON TRUE
    WHERE c.crash_year IS NOT NULL
)
SELECT
    county_code,
    crash_year,
    severity,
    mode,
    COUNT(*)::integer AS victim_count,
    COUNT(*) FILTER (WHERE injury_severity = 'Fatal')::integer
        AS fatal_victim_count,
    COUNT(*) FILTER (
        WHERE injury_severity IN ('SuspectSerious', 'SevereInactive')
    )::integer AS severe_injured_count
FROM classified
WHERE mode IS NOT NULL
GROUP BY county_code, crash_year, severity, mode
WITH NO DATA
"""

# Required for REFRESH ... CONCURRENTLY, and it is also the read path:
# every query is a county/year filter plus a GROUP BY mode.
CREATE_UNIQUE_INDEX = """
CREATE UNIQUE INDEX ux_mv_victims_by_mode_key
    ON mv_victims_by_mode (county_code, crash_year, severity, mode)
"""


def upgrade() -> None:
    op.execute(CREATE_VIEW)
    op.execute(CREATE_UNIQUE_INDEX)
    # Guarded: the API role doesn't exist in CI/test databases.
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'calsight_api_ro') THEN
                GRANT SELECT ON mv_victims_by_mode TO calsight_api_ro;
            END IF;
        END
        $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP MATERIALIZED VIEW IF EXISTS mv_victims_by_mode")
