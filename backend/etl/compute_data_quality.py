"""Pre-compute data quality stats so the frontend can show fill rates
without counting 11 million rows every time.

Tracks fill rates for every field that matters — coordinates, cause,
weather, road conditions, lighting, alcohol flags, distraction flags,
party age/gender/sobriety, and victim injury severity.

Computes at three levels:
  - Per county per year (most specific)
  - Per year only (county_code is null)
  - Per county only (year is null)

Total is about 1,500 rows. Rebuilds from scratch each time — it's
small enough that a full rebuild is simpler than trying to upsert.

Usage:
    python -m etl.compute_data_quality
"""

import logging

from sqlalchemy import text

from app.database import SessionLocal
from app.models import DataQualityStat
from etl._utils import track_etl_run

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


def _safe_pct(numerator, denominator):
    """Calculate percentage, returning None if denominator is 0 or None."""
    if not denominator:
        return None
    return round(numerator / denominator * 100, 1)


# One big query that counts everything at once per group.
# Way more efficient than running separate queries for each field.
# The GROUP BY gets swapped out for county+year, year-only, or county-only.
CRASH_QUERY_TEMPLATE = """
    SELECT
        {group_cols}
        COUNT(*) as total,
        COUNT(latitude) as has_coords,
        COUNT(primary_factor) as has_factor,
        COUNT(weather) as has_weather,
        COUNT(road_condition) as has_road_cond,
        COUNT(lighting) as has_lighting,
        COUNT(is_alcohol_involved) as has_alcohol_flag,
        SUM(CASE WHEN is_alcohol_involved = TRUE THEN 1 ELSE 0 END) as alcohol_true,
        COUNT(is_distraction_involved) as has_distraction_flag,
        SUM(CASE WHEN is_distraction_involved = TRUE THEN 1 ELSE 0 END) as distraction_true
    FROM crashes
    {group_by}
"""

PARTY_QUERY_TEMPLATE = """
    SELECT
        {group_cols}
        COUNT(p.id) as total_parties,
        COUNT(p.age) as has_age,
        COUNT(p.gender) as has_gender,
        COUNT(p.sobriety) as has_sobriety
    FROM crash_parties p
    JOIN crashes c ON p.collision_id = c.collision_id AND c.data_source = 'ccrs'
    {group_by}
"""

VICTIM_QUERY_TEMPLATE = """
    SELECT
        {group_cols}
        COUNT(v.id) as total_victims,
        COUNT(v.injury_severity) as has_severity
    FROM crash_victims v
    JOIN crashes c ON v.collision_id = c.collision_id AND c.data_source = 'ccrs'
    {group_by}
"""


def _build_row(crash, party, victim):
    """Take the raw query results and build a DataQualityStat dict."""
    total = crash["total"]

    row = {
        "total_crashes": total,
        "crashes_with_coords": crash["has_coords"],
        "coords_pct": _safe_pct(crash["has_coords"], total),
        "crashes_with_primary_factor": crash["has_factor"],
        "primary_factor_pct": _safe_pct(crash["has_factor"], total),
        "crashes_with_weather": crash["has_weather"],
        "weather_pct": _safe_pct(crash["has_weather"], total),
        "crashes_with_road_cond": crash["has_road_cond"],
        "road_cond_pct": _safe_pct(crash["has_road_cond"], total),
        "crashes_with_lighting": crash["has_lighting"],
        "lighting_pct": _safe_pct(crash["has_lighting"], total),
        "crashes_with_alcohol_flag": crash["has_alcohol_flag"],
        "alcohol_flag_pct": _safe_pct(crash["has_alcohol_flag"], total),
        "crashes_alcohol_true": crash["alcohol_true"],
        "alcohol_true_pct": _safe_pct(crash["alcohol_true"], total),
        "crashes_with_distraction_flag": crash["has_distraction_flag"],
        "distraction_flag_pct": _safe_pct(crash["has_distraction_flag"], total),
        "crashes_distraction_true": crash["distraction_true"],
        "distraction_true_pct": _safe_pct(crash["distraction_true"], total),
    }

    if party:
        tp = party["total_parties"]
        row.update({
            "total_parties": tp,
            "parties_with_age": party["has_age"],
            "age_pct": _safe_pct(party["has_age"], tp),
            "parties_with_gender": party["has_gender"],
            "gender_pct": _safe_pct(party["has_gender"], tp),
            "parties_with_sobriety": party["has_sobriety"],
            "sobriety_pct": _safe_pct(party["has_sobriety"], tp),
        })

    if victim:
        tv = victim["total_victims"]
        row.update({
            "total_victims": tv,
            "victims_with_injury_severity": victim["has_severity"],
            "injury_severity_pct": _safe_pct(victim["has_severity"], tv),
        })

    return row


def _run_grouped_queries(db, group_cols, group_by, key_fn):
    """Run crash, party, and victim queries with the same grouping.

    Returns a dict keyed by whatever key_fn extracts from each row.
    """
    logger.info("Running crash query...")
    crash_rows = db.execute(text(
        CRASH_QUERY_TEMPLATE.format(group_cols=group_cols, group_by=group_by)
    )).mappings().all()

    logger.info("Running party query...")
    party_rows = db.execute(text(
        PARTY_QUERY_TEMPLATE.format(group_cols=group_cols, group_by=group_by)
    )).mappings().all()

    logger.info("Running victim query...")
    victim_rows = db.execute(text(
        VICTIM_QUERY_TEMPLATE.format(group_cols=group_cols, group_by=group_by)
    )).mappings().all()

    # Index party and victim results by key for fast lookup
    party_by_key = {key_fn(r): r for r in party_rows}
    victim_by_key = {key_fn(r): r for r in victim_rows}

    results = []
    for crash in crash_rows:
        key = key_fn(crash)
        row = _build_row(crash, party_by_key.get(key), victim_by_key.get(key))
        results.append((key, row))

    return results


def compute_stats(db):
    """Rebuild the whole data_quality_stats table from scratch."""
    db.execute(text("DELETE FROM data_quality_stats"))
    db.commit()
    logger.info("Cleared data_quality_stats table")

    # --- Per county per year ---
    logger.info("=== Per county per year ===")
    results = _run_grouped_queries(
        db,
        group_cols="county_code, EXTRACT(YEAR FROM crash_datetime)::int as yr,",
        group_by="GROUP BY county_code, yr",
        key_fn=lambda r: (r["county_code"], r["yr"]),
    )
    for (county, yr), row in results:
        db.add(DataQualityStat(county_code=county, year=yr, **row))
    db.commit()
    logger.info("Inserted %d per-county per-year rows", len(results))

    # --- Per year only ---
    logger.info("=== Per year only ===")
    results = _run_grouped_queries(
        db,
        group_cols="EXTRACT(YEAR FROM crash_datetime)::int as yr,",
        group_by="GROUP BY yr",
        key_fn=lambda r: r["yr"],
    )
    for yr, row in results:
        db.add(DataQualityStat(county_code=None, year=yr, **row))
    db.commit()
    logger.info("Inserted %d per-year rows", len(results))

    # --- Per county only ---
    logger.info("=== Per county only ===")
    results = _run_grouped_queries(
        db,
        group_cols="county_code,",
        group_by="GROUP BY county_code",
        key_fn=lambda r: r["county_code"],
    )
    for county, row in results:
        db.add(DataQualityStat(county_code=county, year=None, **row))
    db.commit()
    logger.info("Inserted %d per-county rows", len(results))


@track_etl_run("data_quality")
def run():
    db = SessionLocal()
    try:
        compute_stats(db)
        total = db.query(DataQualityStat).count()
        logger.info("Done. %d total rows in data_quality_stats", total)
    finally:
        db.close()


if __name__ == "__main__":
    run()
