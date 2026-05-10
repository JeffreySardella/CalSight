"""Backfill canonical condition columns on the crashes table.

Canonicalizes four messy free-text fields into fixed vocabularies:

  - weather        -> canonical_weather     (clear, cloudy, rain, fog, snow, wind, other)
  - lighting       -> canonical_lighting    (daylight, dusk_dawn, dark_lit, dark_unlit, other)
  - road_condition -> canonical_road_condition (dry, wet, snow_ice, construction, other)
  - collision_type -> canonical_collision_type (rear_end, broadside, sideswipe, hit_object, head_on, other)

Uses the same two-step temp-table approach as canonical_cause in
backfill_derived.py:

  1. SELECT DISTINCT from the raw column (~hundreds of values, not 11M).
  2. Categorize in Python with regex (fast — runs on the distinct set).
  3. Load into a temp table.
  4. UPDATE crashes year-by-year via JOIN to the temp table.

Idempotent — only updates rows where the canonical value IS NULL or
differs from the computed value.

Usage:
    python -m etl.backfill_conditions
"""

import logging
import re

from sqlalchemy import text

from app.database import SessionLocal
from etl._utils import track_etl_run

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Year range helper (same pattern as backfill_derived._all_crash_year_range)
# ---------------------------------------------------------------------------

def _all_crash_year_range(db) -> range:
    """Year range covering every crash in the DB."""
    row = db.execute(text("""
        SELECT
            MIN(EXTRACT(YEAR FROM crash_datetime)::int),
            MAX(EXTRACT(YEAR FROM crash_datetime)::int)
        FROM crashes
    """)).one_or_none()

    if row is None or row[0] is None:
        return range(0)

    return range(int(row[0]), int(row[1]) + 1)


# ---------------------------------------------------------------------------
# Regex rules for each field
# ---------------------------------------------------------------------------

# Weather: raw -> canonical
_WEATHER_RULES = [
    (re.compile(r"clear|sunny|fine", re.IGNORECASE), "clear"),
    (re.compile(r"cloud|overcast", re.IGNORECASE), "cloudy"),
    (re.compile(r"rain|wet|precip|drizzl", re.IGNORECASE), "rain"),
    (re.compile(r"fog|visibility|haze|smoke|smok", re.IGNORECASE), "fog"),
    (re.compile(r"snow|sleet|ice|freez|hail", re.IGNORECASE), "snow"),
    (re.compile(r"wind|gust", re.IGNORECASE), "wind"),
]

# Lighting: raw -> canonical
# Order matters: dusk_dawn first, then dark_lit (must check before dark_unlit),
# then dark_unlit, then daylight.
_LIGHTING_RULES = [
    (re.compile(r"dusk|dawn", re.IGNORECASE), "dusk_dawn"),
    (re.compile(r"dark.*street|street.*light", re.IGNORECASE), "dark_lit"),
    (re.compile(r"dark", re.IGNORECASE), "dark_unlit"),
    (re.compile(r"day|daylight", re.IGNORECASE), "daylight"),
]

# Road condition: raw -> canonical
_ROAD_CONDITION_RULES = [
    (re.compile(r"^dry$|no.*unusual|normal", re.IGNORECASE), "dry"),
    (re.compile(r"wet|rain|water|puddle|flood", re.IGNORECASE), "wet"),
    (re.compile(r"snow|ice|slippery|slick", re.IGNORECASE), "snow_ice"),
    (re.compile(r"construct|repair|work zone", re.IGNORECASE), "construction"),
]

# Collision type: raw -> canonical
_COLLISION_TYPE_RULES = [
    (re.compile(r"rear", re.IGNORECASE), "rear_end"),
    (re.compile(r"broadside|t.?bone", re.IGNORECASE), "broadside"),
    (re.compile(r"sideswipe|side.*swipe", re.IGNORECASE), "sideswipe"),
    (re.compile(r"hit.*object|fixed.*object|overturn", re.IGNORECASE), "hit_object"),
    (re.compile(r"head.*on", re.IGNORECASE), "head_on"),
]


def _categorize(value: str, rules: list[tuple[re.Pattern, str]]) -> str:
    """Return the first matching canonical value, or 'other'."""
    for pattern, label in rules:
        if pattern.search(value):
            return label
    return "other"


# ---------------------------------------------------------------------------
# Generic backfill for one column
# ---------------------------------------------------------------------------

def _backfill_canonical_column(
    db,
    raw_col: str,
    canonical_col: str,
    rules: list[tuple[re.Pattern, str]],
) -> int:
    """Backfill a single canonical column using the temp-table approach.

    Returns the total number of rows updated.
    """
    logger.info("Building %s -> %s mapping...", raw_col, canonical_col)

    # Step 1: get distinct raw values
    rows = db.execute(text(f"""
        SELECT DISTINCT {raw_col}
        FROM crashes
        WHERE {raw_col} IS NOT NULL
    """)).scalars().all()  # noqa: S608

    logger.info("Found %d distinct %s values", len(rows), raw_col)

    if not rows:
        logger.info("No %s values to categorize — skipping", raw_col)
        return 0

    # Step 2: categorize in Python
    mapping = {val: _categorize(val, rules) for val in rows}

    # Step 3: load into temp table
    tmp_table = f"_canon_{canonical_col}_tmp"
    db.execute(text(f"DROP TABLE IF EXISTS {tmp_table}"))
    db.execute(text(f"""
        CREATE TEMP TABLE {tmp_table} (
            raw_value TEXT PRIMARY KEY,
            canonical_value TEXT NOT NULL
        )
    """))
    db.execute(
        text(f"INSERT INTO {tmp_table} VALUES (:raw, :canon)"),
        [{"raw": raw, "canon": canon} for raw, canon in mapping.items()],
    )
    db.commit()
    logger.info("Loaded %d mappings into temp table %s", len(mapping), tmp_table)

    # Step 4: UPDATE year-by-year
    total = 0
    for year in _all_crash_year_range(db):
        r = db.execute(text(f"""
            UPDATE crashes c
            SET {canonical_col} = m.canonical_value
            FROM {tmp_table} m
            WHERE c.{raw_col} = m.raw_value
              AND (c.{canonical_col} IS NULL OR c.{canonical_col} <> m.canonical_value)
              AND c.crash_datetime >= :start
              AND c.crash_datetime < :end
        """), {"start": f"{year}-01-01", "end": f"{year + 1}-01-01"})
        db.commit()
        if r.rowcount > 0:
            logger.info("%s %d: %d rows", canonical_col, year, r.rowcount)
            total += r.rowcount

    logger.info("%s backfill done: %d rows categorized", canonical_col, total)
    return total


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

@track_etl_run("backfill_conditions")
def run() -> int:
    """Backfill all four canonical condition columns."""
    db = SessionLocal()
    try:
        logger.info("=== Backfilling canonical condition columns ===")
        total = 0

        total += _backfill_canonical_column(
            db, "weather", "canonical_weather", _WEATHER_RULES,
        )
        total += _backfill_canonical_column(
            db, "lighting", "canonical_lighting", _LIGHTING_RULES,
        )
        total += _backfill_canonical_column(
            db, "road_condition", "canonical_road_condition", _ROAD_CONDITION_RULES,
        )
        total += _backfill_canonical_column(
            db, "collision_type", "canonical_collision_type", _COLLISION_TYPE_RULES,
        )

        logger.info("=== Done — %d total rows updated ===", total)
        return total
    finally:
        db.close()


if __name__ == "__main__":
    run()
