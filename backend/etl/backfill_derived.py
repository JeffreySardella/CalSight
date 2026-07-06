"""Backfill fields we can figure out from data we already have.

Sets up five things:
1. County land area (sq miles) — so we can calculate population density
2. Population density — just population divided by land area
3. Crash hour — extract the hour (0-23) from crash_datetime into its
   own column so time-of-day charts don't have to call EXTRACT() on
   11M rows
4. Severity — pre-compute 'Fatal' / 'Injury' / 'Property Damage Only'
   from number_killed and number_injured so the filter panel can just
   do WHERE severity = 'Fatal' instead of math
5. Crash-level alcohol and distraction flags — looks at the crash_parties
   table to see if anyone was drunk or on their phone, then tags the
   crash itself so you don't have to join every time you want that info

This is a one-time backfill. After it runs, new crashes should get
these fields set during the regular ETL load.

Usage:
    python -m etl.backfill_derived
"""

import logging
import re
from datetime import datetime, timezone

from sqlalchemy import text

from app.database import EtlSessionLocal as SessionLocal  # write/DDL role
from app.models import County
from etl._utils import track_etl_run


# CCRS coverage starts in 2016 — earlier years are SWITRS which doesn't
# have party data, so alcohol/distraction flags are nonsensical there.
_CCRS_START_YEAR = 2016


def _ccrs_year_range(db) -> range:
    """Year range covering all CCRS (2016+) crash data currently in the DB.

    Reads the actual max year from the crashes table (not a hardcoded
    constant) so the backfill automatically extends as new data arrives.
    Falls back to the current calendar year + 1 if the table is empty.
    """
    row = db.execute(text("""
        SELECT MAX(EXTRACT(YEAR FROM crash_datetime)::int)
        FROM crashes
        WHERE data_source = 'ccrs'
    """)).scalar()
    max_year = int(row) if row is not None else datetime.now(timezone.utc).replace(tzinfo=None).year
    # +1 because range's end is exclusive and we want max_year included
    return range(_CCRS_START_YEAR, max_year + 1)


def _all_crash_year_range(db) -> range:
    """Year range covering every crash in the DB (SWITRS + CCRS combined).

    Used by backfills that operate on the full crashes table like crash_hour
    and severity. Like _ccrs_year_range, the boundaries come from the data
    itself so re-running this script after a load automatically picks up
    any new years without a code change.
    """
    row = db.execute(text("""
        SELECT
            MIN(EXTRACT(YEAR FROM crash_datetime)::int),
            MAX(EXTRACT(YEAR FROM crash_datetime)::int)
        FROM crashes
    """)).one_or_none()

    if row is None or row[0] is None:
        # Empty table — nothing to do. Return an empty range.
        return range(0)

    min_year, max_year = int(row[0]), int(row[1])
    return range(min_year, max_year + 1)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# Land area in square miles for all 58 CA counties.
# These come from the US Census Bureau 2020 Census. It's land area only —
# water is excluded. We hardcode these because they basically never change
# and there's no good API for it.
#
# The county codes (1-58) match our counties table primary key.
# San Bernardino (36) is the biggest at 20,057 sq mi — it's literally
# the largest county in the entire US. San Francisco (38) is the smallest
# at 47 sq mi.
COUNTY_LAND_AREAS = {
    1: 738.0,      # Alameda
    2: 738.0,      # Alpine
    3: 593.0,      # Amador
    4: 1636.0,     # Butte
    5: 1020.0,     # Calaveras
    6: 1151.0,     # Colusa
    7: 716.0,      # Contra Costa
    8: 1006.0,     # Del Norte
    9: 1708.0,     # El Dorado
    10: 5958.0,    # Fresno
    11: 1315.0,    # Glenn
    12: 3568.0,    # Humboldt
    13: 4175.0,    # Imperial
    14: 10181.0,   # Inyo
    15: 8132.0,    # Kern
    16: 1390.0,    # Kings
    17: 1256.0,    # Lake
    18: 4541.0,    # Lassen
    19: 4058.0,    # Los Angeles
    20: 2132.0,    # Madera
    21: 520.0,     # Marin
    22: 1449.0,    # Mariposa
    23: 3506.0,    # Mendocino
    24: 1928.0,    # Merced
    25: 3918.0,    # Modoc
    26: 3044.0,    # Mono
    27: 3281.0,    # Monterey
    28: 748.0,     # Napa
    29: 958.0,     # Nevada
    30: 790.0,     # Orange
    31: 1404.0,    # Placer
    32: 2553.0,    # Plumas
    33: 7206.0,    # Riverside
    34: 965.0,     # Sacramento
    35: 1389.0,    # San Benito
    36: 20057.0,   # San Bernardino
    37: 4200.0,    # San Diego
    38: 47.0,      # San Francisco
    39: 1391.0,    # San Joaquin
    40: 3299.0,    # San Luis Obispo
    41: 449.0,     # San Mateo
    42: 2735.0,    # Santa Barbara
    43: 1290.0,    # Santa Clara
    44: 445.0,     # Santa Cruz
    45: 3775.0,    # Shasta
    46: 953.0,     # Sierra
    47: 6278.0,    # Siskiyou
    48: 822.0,     # Solano
    49: 1576.0,    # Sonoma
    50: 1494.0,    # Stanislaus
    51: 602.0,     # Sutter
    52: 2950.0,    # Tehama
    53: 3179.0,    # Trinity
    54: 4824.0,    # Tulare
    55: 2221.0,    # Tuolumne
    56: 1843.0,    # Ventura
    57: 1012.0,    # Yolo
    58: 630.0,     # Yuba
}


def backfill_land_areas(db):
    """Write land area into the counties table.

    Just loops through all 58 counties and sets the land_area_sq_miles
    column. If it's already set to the right value, we skip it. This
    is idempotent — run it as many times as you want.
    """
    updated = 0
    for code, area in COUNTY_LAND_AREAS.items():
        county = db.query(County).filter_by(code=code).first()
        if county and county.land_area_sq_miles != area:
            county.land_area_sq_miles = area
            updated += 1
    db.commit()
    logger.info("Updated land area for %d counties", updated)


def backfill_population_density(db):
    """Calculate population density for every row in the demographics table.

    It's just population / land_area. We do it as one big SQL UPDATE
    that joins demographics to counties (to get the land area). The
    CAST to NUMERIC is because Postgres doesn't let you use ROUND()
    on a double precision — it's picky about that.

    After this runs, you can do stuff like:
    - SF: 18,107 people per sq mile (super dense)
    - Inyo: 1.9 people per sq mile (basically empty)
    """
    result = db.execute(text("""
        UPDATE demographics d
        SET population_density = ROUND(
            (CAST(d.population AS NUMERIC) / c.land_area_sq_miles)::NUMERIC, 2
        )
        FROM counties c
        WHERE d.county_code = c.code
          AND c.land_area_sq_miles IS NOT NULL
          AND c.land_area_sq_miles > 0
          AND d.population IS NOT NULL
    """))
    db.commit()
    logger.info("Computed population density for %d demographic rows", result.rowcount)


def backfill_alcohol_flags(db):
    """Tag each CCRS crash with whether alcohol or drugs were involved.

    The crash_parties table has a sobriety field for each driver/pedestrian.
    We want a simple boolean on the crash itself so the frontend doesn't
    have to join to parties every time.

    How it works:
    1. First we grab all the collision_ids where ANY party had sobriety
       of 'HBD-UNDER INFLUENCE' or 'UNDER_DRUG_INFLUENCE'. That's a
       single scan of crash_parties using the collision_id index.

    2. Then we batch-update crashes 1,000 at a time using ANY(:ids).
       We tried doing this as one big UPDATE with a JOIN but it took
       over 2 hours and timed out. Batching is way faster.

    3. Finally we set everything else to FALSE — but only for CCRS
       crashes (2016+) since SWITRS doesn't have party data at all.
       We do this year by year so each UPDATE is manageable.

    Why we only count those two sobriety values:
    The sobriety field has a bunch of values like 'IMPAIRMENT_NOT_KNOWN',
    'SLEEPY/FATIGUED', 'HBD-NOT UNDER INFLUENCE', etc. If you count
    everything that isn't 'HAD NOT BEEN DRINKING' you get 4.4M crashes
    flagged which is basically all of them — obviously wrong. The two
    values we use give us 8.9% which matches NHTSA national averages.
    """
    # Step 1: find which crashes had an impaired party
    logger.info("Finding alcohol/drug-involved collision IDs...")
    result = db.execute(text("""
        SELECT DISTINCT collision_id
        FROM crash_parties
        WHERE sobriety IN ('HBD-UNDER INFLUENCE', 'UNDER_DRUG_INFLUENCE')
    """))
    alcohol_ids = [row[0] for row in result]
    logger.info("Found %d alcohol-involved collision IDs", len(alcohol_ids))

    # Step 2: mark those crashes as TRUE, 1000 at a time
    # We use ANY(:ids) which is Postgres's way of doing "WHERE x IN (list)"
    # but it works with parameterized arrays instead of string interpolation
    total_positive = 0
    for i in range(0, len(alcohol_ids), 1000):
        batch = alcohol_ids[i:i + 1000]
        r = db.execute(text("""
            UPDATE crashes
            SET is_alcohol_involved = TRUE
            WHERE collision_id = ANY(:ids)
              AND data_source = 'ccrs'
              AND is_alcohol_involved IS NULL
        """), {"ids": batch})
        db.commit()
        total_positive += r.rowcount

    logger.info("Marked %d crashes as alcohol-involved", total_positive)

    # Step 3: everything else in CCRS gets FALSE
    # We do this by year so each UPDATE only touches ~400K rows
    # instead of 4M at once (which would be super slow).
    # Year range is pulled from the data itself so we don't have to
    # remember to bump a hardcoded number each January.
    total_negative = 0
    for year in _ccrs_year_range(db):
        r = db.execute(text("""
            UPDATE crashes
            SET is_alcohol_involved = FALSE
            WHERE is_alcohol_involved IS NULL
              AND data_source = 'ccrs'
              AND crash_datetime >= :start AND crash_datetime < :end
        """), {"start": f"{year}-01-01", "end": f"{year + 1}-01-01"})
        db.commit()
        total_negative += r.rowcount

    logger.info("Marked %d crashes as NOT alcohol-involved", total_negative)


def backfill_distraction_flags(db):
    """Tag each CCRS crash with whether a driver was using their phone.

    Same approach as the alcohol flags. The cell_phone_use field in
    crash_parties has values like 'CELL PHONE HANDHELD IN USE',
    'CELL PHONE HANDSFREE IN USE', 'CELL PHONE NOT IN USE',
    'CELL PHONE USE UNKNOWN', etc.

    We only count HANDHELD and HANDSFREE as actual distraction.
    'UNKNOWN' doesn't count — we're being conservative. This gives
    us about 2.5% of crashes flagged which is in line with national
    estimates from NHTSA.

    We use LIKE '%HANDHELD IN USE%' because some records have combo
    values like 'CELL PHONE HANDHELD IN USE / SCHOOL BUS RELATED'.
    """
    logger.info("Finding distraction-involved collision IDs...")
    result = db.execute(text("""
        SELECT DISTINCT collision_id
        FROM crash_parties
        WHERE cell_phone_use LIKE '%HANDHELD IN USE%'
           OR cell_phone_use LIKE '%HANDSFREE IN USE%'
    """))
    distraction_ids = [row[0] for row in result]
    logger.info("Found %d distraction-involved collision IDs", len(distraction_ids))

    # Batch update — same pattern as alcohol flags
    total_positive = 0
    for i in range(0, len(distraction_ids), 1000):
        batch = distraction_ids[i:i + 1000]
        r = db.execute(text("""
            UPDATE crashes
            SET is_distraction_involved = TRUE
            WHERE collision_id = ANY(:ids)
              AND data_source = 'ccrs'
              AND is_distraction_involved IS NULL
        """), {"ids": batch})
        db.commit()
        total_positive += r.rowcount

    logger.info("Marked %d crashes as distraction-involved", total_positive)

    # Set the rest to FALSE, year by year.
    # Dynamic range — see _ccrs_year_range for why.
    total_negative = 0
    for year in _ccrs_year_range(db):
        r = db.execute(text("""
            UPDATE crashes
            SET is_distraction_involved = FALSE
            WHERE is_distraction_involved IS NULL
              AND data_source = 'ccrs'
              AND crash_datetime >= :start AND crash_datetime < :end
        """), {"start": f"{year}-01-01", "end": f"{year + 1}-01-01"})
        db.commit()
        total_negative += r.rowcount

    logger.info("Marked %d crashes as NOT distraction-involved", total_negative)


def backfill_pedestrian_flags(db):
    """Fix pedestrian_involved using crash_parties as ground truth.

    The original ETL set this from PedestrianActionCode, but code "A"
    (No Pedestrian Involved) was incorrectly treated as True, flagging
    99.5% of crashes. This resets the column using party_type = 'Pedestrian'
    from crash_parties, which gives the correct ~3.3% rate.

    SWITRS (pre-2016) gets set to NULL since we have no party data
    to verify against.
    """
    logger.info("Fixing pedestrian_involved flags...")

    # Step 1: NULL out SWITRS rows (no party data to verify)
    r = db.execute(text("""
        UPDATE crashes
        SET pedestrian_involved = NULL
        WHERE data_source = 'switrs'
          AND pedestrian_involved IS NOT NULL
    """))
    db.commit()
    logger.info("Set %d SWITRS rows to NULL", r.rowcount)

    # Step 2: find CCRS crashes with a pedestrian party
    result = db.execute(text("""
        SELECT DISTINCT collision_id
        FROM crash_parties
        WHERE party_type = 'Pedestrian'
    """))
    ped_ids = [row[0] for row in result]
    logger.info("Found %d pedestrian-involved collision IDs", len(ped_ids))

    # Step 3: reset all CCRS to FALSE first
    total_reset = 0
    for year in _ccrs_year_range(db):
        r = db.execute(text("""
            UPDATE crashes
            SET pedestrian_involved = FALSE
            WHERE data_source = 'ccrs'
              AND crash_datetime >= :start AND crash_datetime < :end
        """), {"start": f"{year}-01-01", "end": f"{year + 1}-01-01"})
        db.commit()
        total_reset += r.rowcount
    logger.info("Reset %d CCRS crashes to FALSE", total_reset)

    # Step 4: set TRUE for crashes with pedestrian parties
    total_positive = 0
    for i in range(0, len(ped_ids), 1000):
        batch = ped_ids[i:i + 1000]
        r = db.execute(text("""
            UPDATE crashes
            SET pedestrian_involved = TRUE
            WHERE collision_id = ANY(:ids)
              AND data_source = 'ccrs'
        """), {"ids": batch})
        db.commit()
        total_positive += r.rowcount
    logger.info("Marked %d crashes as pedestrian-involved", total_positive)


def backfill_cyclist_flags(db):
    """Tag each CCRS crash with whether a bicyclist was involved.

    Same batch pattern as alcohol flags. Checks crash_parties.party_type
    for 'Bicyclist'. pedestrian_involved already exists on the crashes
    table from the original ETL, so we only need cyclist here.
    """
    logger.info("Finding cyclist-involved collision IDs...")
    result = db.execute(text("""
        SELECT DISTINCT collision_id
        FROM crash_parties
        WHERE party_type = 'Bicyclist'
    """))
    cyclist_ids = [row[0] for row in result]
    logger.info("Found %d cyclist-involved collision IDs", len(cyclist_ids))

    total_positive = 0
    for i in range(0, len(cyclist_ids), 1000):
        batch = cyclist_ids[i:i + 1000]
        r = db.execute(text("""
            UPDATE crashes
            SET cyclist_involved = TRUE
            WHERE collision_id = ANY(:ids)
              AND data_source = 'ccrs'
              AND cyclist_involved IS NULL
        """), {"ids": batch})
        db.commit()
        total_positive += r.rowcount

    logger.info("Marked %d crashes as cyclist-involved", total_positive)

    total_negative = 0
    for year in _ccrs_year_range(db):
        r = db.execute(text("""
            UPDATE crashes
            SET cyclist_involved = FALSE
            WHERE cyclist_involved IS NULL
              AND data_source = 'ccrs'
              AND crash_datetime >= :start AND crash_datetime < :end
        """), {"start": f"{year}-01-01", "end": f"{year + 1}-01-01"})
        db.commit()
        total_negative += r.rowcount

    logger.info("Marked %d crashes as NOT cyclist-involved", total_negative)


def backfill_drug_flags(db):
    """Tag each CCRS crash with whether drugs (not alcohol) were involved.

    Distinct from is_alcohol_involved -- this only matches
    'UNDER_DRUG_INFLUENCE' in the sobriety field. A crash can be both
    alcohol-involved AND drug-involved if different parties had each.
    """
    logger.info("Finding drug-involved collision IDs...")
    result = db.execute(text("""
        SELECT DISTINCT collision_id
        FROM crash_parties
        WHERE sobriety = 'UNDER_DRUG_INFLUENCE'
    """))
    drug_ids = [row[0] for row in result]
    logger.info("Found %d drug-involved collision IDs", len(drug_ids))

    total_positive = 0
    for i in range(0, len(drug_ids), 1000):
        batch = drug_ids[i:i + 1000]
        r = db.execute(text("""
            UPDATE crashes
            SET is_drug_involved = TRUE
            WHERE collision_id = ANY(:ids)
              AND data_source = 'ccrs'
              AND is_drug_involved IS NULL
        """), {"ids": batch})
        db.commit()
        total_positive += r.rowcount

    logger.info("Marked %d crashes as drug-involved", total_positive)

    total_negative = 0
    for year in _ccrs_year_range(db):
        r = db.execute(text("""
            UPDATE crashes
            SET is_drug_involved = FALSE
            WHERE is_drug_involved IS NULL
              AND data_source = 'ccrs'
              AND crash_datetime >= :start AND crash_datetime < :end
        """), {"start": f"{year}-01-01", "end": f"{year + 1}-01-01"})
        db.commit()
        total_negative += r.rowcount

    logger.info("Marked %d crashes as NOT drug-involved", total_negative)


def backfill_at_fault_driver_age(db):
    """Copy the at-fault driver's age onto the crash row.

    Finds the party where at_fault = TRUE and party_type = 'Driver',
    takes their age. If multiple at-fault drivers exist (rare -- multi-vehicle
    collisions with shared fault), takes the youngest since young-driver
    analysis is the primary use case.

    Only CCRS (2016+) has party data.
    """
    logger.info("Backfilling at-fault driver age...")
    total = 0
    for year in _ccrs_year_range(db):
        r = db.execute(text("""
            UPDATE crashes c
            SET at_fault_driver_age = sub.age
            FROM (
                SELECT DISTINCT ON (p.collision_id)
                    p.collision_id, p.age
                FROM crash_parties p
                JOIN crashes cr ON cr.collision_id = p.collision_id
                    AND cr.data_source = p.data_source
                WHERE p.at_fault = TRUE
                  AND p.party_type = 'Driver'
                  AND p.age IS NOT NULL
                  AND p.age BETWEEN 1 AND 120
                  AND cr.data_source = 'ccrs'
                  AND cr.crash_datetime >= :start AND cr.crash_datetime < :end
                ORDER BY p.collision_id, p.age
            ) sub
            WHERE c.collision_id = sub.collision_id
              AND c.data_source = 'ccrs'
              AND c.at_fault_driver_age IS NULL
        """), {"start": f"{year}-01-01", "end": f"{year + 1}-01-01"})
        db.commit()
        if r.rowcount > 0:
            logger.info("At-fault driver age %d: %d rows", year, r.rowcount)
            total += r.rowcount

    logger.info("At-fault driver age backfill done: %d rows", total)


def backfill_crash_hour(db):
    """Extract the hour (0-23) from crash_datetime into its own column.

    This way "crashes by time of day" charts can use a simple GROUP BY
    on an indexed integer column instead of doing EXTRACT() on 11M
    datetime values every time.
    """
    for year in _all_crash_year_range(db):
        r = db.execute(text("""
            UPDATE crashes
            SET crash_hour = EXTRACT(HOUR FROM crash_datetime)::smallint
            WHERE crash_hour IS NULL
              AND crash_datetime >= :start AND crash_datetime < :end
        """), {"start": f"{year}-01-01", "end": f"{year + 1}-01-01"})
        db.commit()
        if r.rowcount > 0:
            logger.info("Crash hour %d: %d rows", year, r.rowcount)

    logger.info("Crash hour backfill done")


def backfill_crash_year(db):
    """Extract year (integer) from crash_datetime into its own column.

    Same rationale as backfill_crash_hour — lets the API filter on an
    indexed integer instead of calling EXTRACT() on 11M rows per query.
    Year-by-year chunking keeps the UPDATE lock windows small.
    """
    total = 0
    for year in _all_crash_year_range(db):
        r = db.execute(text("""
            UPDATE crashes
            SET crash_year = :year
            WHERE crash_year IS NULL
              AND crash_datetime >= :start
              AND crash_datetime < :end
        """), {"year": year, "start": f"{year}-01-01", "end": f"{year + 1}-01-01"})
        db.commit()
        if r.rowcount > 0:
            logger.info("Crash year %d: %d rows", year, r.rowcount)
            total += r.rowcount

    logger.info("Crash year backfill done: %d rows", total)


def backfill_crash_month(db):
    """Extract month (1-12) from crash_datetime into its own column."""
    total = 0
    for year in _all_crash_year_range(db):
        r = db.execute(text("""
            UPDATE crashes
            SET crash_month = EXTRACT(MONTH FROM crash_datetime)::smallint
            WHERE crash_month IS NULL
              AND crash_datetime >= :start
              AND crash_datetime < :end
        """), {"start": f"{year}-01-01", "end": f"{year + 1}-01-01"})
        db.commit()
        if r.rowcount > 0:
            logger.info("Crash month %d: %d rows", year, r.rowcount)
            total += r.rowcount

    logger.info("Crash month backfill done: %d rows", total)


def backfill_day_of_week(db):
    """Extract ISO day of week (0=Mon, 6=Sun) from crash_datetime."""
    total = 0
    for year in _all_crash_year_range(db):
        r = db.execute(text("""
            UPDATE crashes
            SET day_of_week_num = (EXTRACT(ISODOW FROM crash_datetime)::smallint - 1)
            WHERE day_of_week_num IS NULL
              AND crash_datetime >= :start
              AND crash_datetime < :end
        """), {"start": f"{year}-01-01", "end": f"{year + 1}-01-01"})
        db.commit()
        if r.rowcount > 0:
            logger.info("Day of week %d: %d rows", year, r.rowcount)
            total += r.rowcount

    logger.info("Day of week backfill done: %d rows", total)


def backfill_county_name(db):
    """Denormalize counties.name into the crashes table.

    Single UPDATE ... FROM counties on the whole table. County names
    are short (<50 chars) and stable, so this is a one-shot fill —
    subsequent runs are no-ops because of the WHERE county_name IS NULL
    guard. If a county name ever changes, drop that guard (or add a
    `WHERE county_name <> c.name` clause) and re-run.
    """
    r = db.execute(text("""
        UPDATE crashes
        SET county_name = c.name
        FROM counties c
        WHERE crashes.county_code = c.code
          AND crashes.county_name IS NULL
    """))
    db.commit()
    logger.info("County name backfill: %d rows", r.rowcount)


# Regex rules that collapse the ~12K distinct primary_factor values into
# 10 canonical buckets. First match wins — order matters (dui before speeding
# since the DUI signal is stronger; right_of_way before pedestrian so
# "pedestrian right of way" goes to ROW).
#
# Pattern notes:
#   - dui: CA Vehicle Code section 23152 in any format + English "dui"
#     as a whole word (so "fluid" doesn't match).
#   - speeding: VC 22350 (Basic Speed Law) + any value containing "speed".
#   - signal_violation: VC 21453/21460/21461 (traffic signals), VC 22450
#     (stop signs), plus English "traffic signal", "red light", "stop sign".
#   - right_of_way: VC 21800-21806 + English "right of way" preceded by "auto".
#   - turning: VC 22107 + VC 22100-22105 + English "improper turn".
#     Excludes 22106 (that's backing, not turning).
#   - following_too_close: VC 21703 + English "follow...clos".
#   - pedestrian_violation: VC 21950-21956 + English "pedestrian".
#     Checked AFTER right_of_way so "pedestrian right of way" → ROW.
#   - unsafe_backing: VC 22106 + English "unsafe start/back".
#   - lane_change: VC 21658 (lane usage), VC 21650 (wrong side), plus
#     English lane-change / improper-passing / wrong-side phrases.
#   - other: everything else, including "unknown".
#
# "distracted" and "weather" are NOT populated here — they come from
# is_distraction_involved and the weather column respectively. The API
# layer combines canonical_cause with those columns for the full filter.
_DUI_RE = re.compile(r"(?:^|[^a-z])dui(?:[^a-z]|$)|23152", re.IGNORECASE)
_SPEED_RE = re.compile(r"speed|22350", re.IGNORECASE)
_LANE_RE = re.compile(r"lane.?change|improper.?passing|21658|21650|wrong.?side", re.IGNORECASE)
_SIGNAL_RE = re.compile(
    r"traffic.?signal|red.?light|stop.?sign"
    r"|2145[0-9]|21460|21461|22450",
    re.IGNORECASE,
)
_ROW_RE = re.compile(
    r"right.?of.?way|2180[0-6]",
    re.IGNORECASE,
)
_TURNING_RE = re.compile(
    r"improper.?turn|22107|2210[0-5]",
    re.IGNORECASE,
)
_FOLLOWING_RE = re.compile(r"follow.*clos|21703", re.IGNORECASE)
_PEDESTRIAN_RE = re.compile(
    r"pedestrian|2195[0-6]",
    re.IGNORECASE,
)
_BACKING_RE = re.compile(r"unsafe.?(start|back)|22106", re.IGNORECASE)


def _categorize_primary_factor(pf: str) -> str:
    """Return the canonical_cause for a primary_factor string.

    Pure function — used by the backfill and can be unit-tested without
    touching the database.
    """
    if _DUI_RE.search(pf):
        return "dui"
    if _SPEED_RE.search(pf):
        return "speeding"
    if _SIGNAL_RE.search(pf):
        return "signal_violation"
    if _ROW_RE.search(pf):
        return "right_of_way"
    if _TURNING_RE.search(pf):
        return "turning"
    if _FOLLOWING_RE.search(pf):
        return "following_too_close"
    if _PEDESTRIAN_RE.search(pf):
        return "pedestrian_violation"
    if _BACKING_RE.search(pf):
        return "unsafe_backing"
    if _LANE_RE.search(pf):
        return "lane_change"
    return "other"


def backfill_canonical_cause(db):
    """Populate canonical_cause from primary_factor.

    Two-step approach, ~100x faster than regex-per-row on B1ms:

      1. SELECT DISTINCT primary_factor (hits ix_crashes_primary_factor,
         returns ~12K rows instead of 11M).
      2. Build a Python dict {raw_value → category} in memory — regex
         runs 12K times, not 11M.
      3. Load that dict into a temp table and UPDATE crashes via hash
         join, one year at a time to keep lock windows small.

    Rows where primary_factor IS NULL stay NULL — "no data recorded"
    is meaningfully different from "some cause we couldn't categorize".
    """
    logger.info("Building primary_factor → canonical_cause mapping...")

    rows = db.execute(text("""
        SELECT DISTINCT primary_factor
        FROM crashes
        WHERE primary_factor IS NOT NULL
    """)).scalars().all()

    logger.info("Found %d distinct primary_factor values", len(rows))

    mapping = {pf: _categorize_primary_factor(pf) for pf in rows}

    # Drop the temp table if it exists from a prior aborted run, then
    # rebuild and load the mapping.
    db.execute(text("DROP TABLE IF EXISTS _cause_map_tmp"))
    db.execute(text("""
        CREATE TEMP TABLE _cause_map_tmp (
            primary_factor TEXT PRIMARY KEY,
            canonical_cause TEXT NOT NULL
        )
    """))
    db.execute(
        text("INSERT INTO _cause_map_tmp VALUES (:pf, :cc)"),
        [{"pf": pf, "cc": cc} for pf, cc in mapping.items()],
    )
    db.commit()
    logger.info("Loaded %d mappings into temp table", len(mapping))

    total = 0
    for year in _all_crash_year_range(db):
        r = db.execute(text("""
            UPDATE crashes c
            SET canonical_cause = m.canonical_cause
            FROM _cause_map_tmp m
            WHERE c.primary_factor = m.primary_factor
              AND (c.canonical_cause IS NULL OR c.canonical_cause <> m.canonical_cause)
              AND c.crash_datetime >= :start
              AND c.crash_datetime < :end
        """), {"start": f"{year}-01-01", "end": f"{year + 1}-01-01"})
        db.commit()
        if r.rowcount > 0:
            logger.info("Canonical cause %d: %d rows", year, r.rowcount)
            total += r.rowcount

    logger.info("Canonical cause backfill done: %d rows categorized", total)


def backfill_severity(db):
    """Compute a human-readable severity category from killed/injured counts.

    The filter panel needs 'Fatal', 'Severe Injury', 'Minor Injury', and
    'Property Damage Only'. Right now you'd have to check number_killed > 0
    and number_injured > 0 on every query. This pre-computes it.

    We don't know the difference between 'Severe' and 'Minor' from the
    crash table alone — that's in crash_victims.injury_severity. So we
    just split into Fatal / Injury / Property Damage Only from the crash
    level. If we need the fine-grained severity, that comes from the
    victims table.
    """
    # Fatal: anyone died
    r = db.execute(text("""
        UPDATE crashes SET severity = 'Fatal'
        WHERE severity IS NULL AND number_killed > 0
    """))
    db.commit()
    logger.info("Severity: %d fatal", r.rowcount)

    # Injury: nobody died but someone got hurt
    r = db.execute(text("""
        UPDATE crashes SET severity = 'Injury'
        WHERE severity IS NULL AND number_injured > 0
    """))
    db.commit()
    logger.info("Severity: %d injury", r.rowcount)

    # Property Damage Only: no deaths, no injuries
    r = db.execute(text("""
        UPDATE crashes SET severity = 'Property Damage Only'
        WHERE severity IS NULL
          AND (number_killed = 0 OR number_killed IS NULL)
          AND (number_injured = 0 OR number_injured IS NULL)
    """))
    db.commit()
    logger.info("Severity: %d property damage only", r.rowcount)


def repair_drifted_derived(db) -> int:
    """Fix derived columns that disagree with the raw values they derive from.

    Before 2026-07 the upsert didn't recompute derived columns, so a CHP
    amendment (a victim dying within 30 days, a corrected crash_datetime)
    left severity and the datetime extract columns stale — and the
    NULL-guarded backfills above never touch a populated row. This repairs
    the drift already sitting in prod and keeps acting as a nightly
    invariant check.

    The IS DISTINCT FROM guard means only genuinely inconsistent rows get
    new tuple versions: after the first pass this is a read-mostly scan per
    year with ~zero writes (no daily WAL churn — the M7 lesson). Rows whose
    severity is still NULL are left for backfill_severity to fill first.
    """
    total = 0
    for year in _all_crash_year_range(db):
        r = db.execute(text("""
            UPDATE crashes SET
                severity = CASE
                    WHEN number_killed > 0 THEN 'Fatal'
                    WHEN number_injured > 0 THEN 'Injury'
                    ELSE 'Property Damage Only'
                END,
                crash_year = EXTRACT(YEAR FROM crash_datetime)::smallint,
                crash_month = EXTRACT(MONTH FROM crash_datetime)::smallint,
                crash_hour = EXTRACT(HOUR FROM crash_datetime)::smallint,
                day_of_week_num = (EXTRACT(ISODOW FROM crash_datetime)::smallint - 1)
            WHERE crash_datetime >= :start AND crash_datetime < :end
              AND severity IS NOT NULL
              AND (
                severity IS DISTINCT FROM CASE
                    WHEN number_killed > 0 THEN 'Fatal'
                    WHEN number_injured > 0 THEN 'Injury'
                    ELSE 'Property Damage Only'
                END
                OR crash_year IS DISTINCT FROM EXTRACT(YEAR FROM crash_datetime)::smallint
                OR crash_month IS DISTINCT FROM EXTRACT(MONTH FROM crash_datetime)::smallint
                OR crash_hour IS DISTINCT FROM EXTRACT(HOUR FROM crash_datetime)::smallint
                OR day_of_week_num IS DISTINCT FROM (EXTRACT(ISODOW FROM crash_datetime)::smallint - 1)
              )
        """), {"start": f"{year}-01-01", "end": f"{year + 1}-01-01"})
        db.commit()
        if r.rowcount > 0:
            logger.info("Derived-drift repair %d: %d rows", year, r.rowcount)
            total += r.rowcount

    logger.info("Derived-drift repair done: %d rows", total)
    return total


@track_etl_run("backfill")
def run():
    """Run all the backfills in order. Land area first since density needs it."""
    db = SessionLocal()
    try:
        logger.info("=== Backfilling derived fields ===")
        backfill_land_areas(db)
        backfill_population_density(db)
        backfill_crash_hour(db)
        backfill_crash_year(db)
        backfill_crash_month(db)
        backfill_day_of_week(db)
        backfill_county_name(db)
        backfill_severity(db)
        repair_drifted_derived(db)
        backfill_pedestrian_flags(db)
        backfill_alcohol_flags(db)
        backfill_distraction_flags(db)
        backfill_cyclist_flags(db)
        backfill_drug_flags(db)
        backfill_at_fault_driver_age(db)
        backfill_canonical_cause(db)
        logger.info("=== Done ===")
    finally:
        db.close()


if __name__ == "__main__":
    run()
