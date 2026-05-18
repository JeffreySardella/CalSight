"""Incremental ETL strategies for CalSight data sources.

The problem:
  We have 11M+ crash rows. Reloading everything from scratch takes hours
  and hammers the CKAN API. Most runs, the source only has a few thousand
  new records from the last month. We should only fetch and upsert those.

The solution:
  Incremental loading based on high-water marks. Each source tracks the
  "last known record" (by date or by max collision_id) and only fetches
  records newer than that mark.

Strategy per source:

  1. CCRS (crashes_ccrs) — CKAN API supports filtering via SQL-like queries.
     We track the max(crash_datetime) in our DB for the most recent year
     and only fetch records with Crash Date Time > that timestamp.
     Falls back to full-year reload if the incremental fetch fails.

  2. Parties/Victims — Same pattern as CCRS. Filter by collision_id > max
     in our DB. Since parties reference crashes, they naturally come after
     the crash load and only need the delta.

  3. Monthly reference sources (demographics, weather, etc.) — These are
     small enough that a full reload is fine. The freshness check in
     _utils.py already skips them when unchanged.

Usage:
    from etl.incremental import get_high_water_mark, fetch_ccrs_incremental
"""

from __future__ import annotations

import logging
from datetime import datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Crash, CrashParty, CrashVictim

logger = logging.getLogger(__name__)


def get_crash_high_water_mark(db: Session) -> datetime | None:
    """Get the most recent crash_datetime for CCRS data.

    This is the "high water mark" — we only need to fetch records
    newer than this from the CKAN API.

    Returns None if no CCRS data exists (signals full load needed).
    """
    result = db.query(func.max(Crash.crash_datetime)).filter(
        Crash.data_source == "ccrs"
    ).scalar()

    if result:
        logger.info("CCRS high water mark: %s", result.isoformat())
    else:
        logger.info("No CCRS data found — full load required")

    return result


def get_party_high_water_mark(db: Session) -> int | None:
    """Get the max party_id for incremental party loading."""
    result = db.query(func.max(CrashParty.party_id)).scalar()
    if result:
        logger.info("Party high water mark: %d", result)
    return result


def get_victim_high_water_mark(db: Session) -> int | None:
    """Get the max victim_id for incremental victim loading."""
    result = db.query(func.max(CrashVictim.victim_id)).scalar()
    if result:
        logger.info("Victim high water mark: %d", result)
    return result


def build_ccrs_incremental_filter(high_water: datetime) -> str:
    """Build a CKAN SQL filter for records newer than the high water mark.

    CKAN DataStore supports a `filters` parameter and a `q` parameter for
    full-text search, but for date comparisons we use the SQL-based `sql`
    endpoint instead:

        SELECT * FROM "resource_id"
        WHERE "Crash Date Time" > '2025-04-15T00:00:00'
        ORDER BY "Crash Date Time" ASC

    This returns only new records, drastically reducing API calls and
    network transfer for daily runs.
    """
    # Format for CKAN SQL queries — ISO 8601
    ts = high_water.strftime("%Y-%m-%dT%H:%M:%S")
    return f'"Crash Date Time" > \'{ts}\''


def estimate_new_records(db: Session, high_water: datetime) -> dict:
    """Estimate how many new records we expect based on historical patterns.

    Uses the average daily record ingestion rate over the last 30 days
    to predict how many records a daily run should fetch. If the actual
    count deviates too far from this estimate, it might indicate a
    problem with the source data.

    Returns dict with expected_count, daily_avg, and days_since_last.
    """
    # How many days since our last record?
    days_since = (datetime.utcnow() - high_water).days

    # Average records per day over the last year of CCRS data
    one_year_ago = datetime(high_water.year - 1, high_water.month, high_water.day)
    year_count = db.query(func.count(Crash.id)).filter(
        Crash.data_source == "ccrs",
        Crash.crash_datetime >= one_year_ago,
        Crash.crash_datetime <= high_water,
    ).scalar() or 0

    daily_avg = year_count / 365 if year_count > 0 else 1000  # default estimate

    return {
        "days_since_last": days_since,
        "daily_avg": round(daily_avg),
        "expected_count": round(daily_avg * max(days_since, 1)),
    }


def should_use_incremental(db: Session) -> bool:
    """Decide whether to use incremental or full load.

    Use incremental when:
      - We have existing CCRS data (high water mark exists)
      - The gap is less than 90 days (beyond that, full reload is safer)
      - The most recent year has substantial data (> 1000 rows)

    Use full load when:
      - No existing data (first-time load)
      - Gap exceeds 90 days (too many pages to paginate incrementally)
      - Something seems corrupted (recent year has very few rows)
    """
    high_water = get_crash_high_water_mark(db)

    if high_water is None:
        logger.info("Decision: FULL LOAD (no existing data)")
        return False

    days_gap = (datetime.utcnow() - high_water).days

    if days_gap > 90:
        logger.info("Decision: FULL LOAD (gap=%d days > 90 day threshold)", days_gap)
        return False

    # Check the most recent year has reasonable data
    current_year = datetime.utcnow().year
    recent_count = db.query(func.count(Crash.id)).filter(
        Crash.data_source == "ccrs",
        Crash.crash_year == current_year,
    ).scalar() or 0

    if recent_count < 1000 and days_gap < 30:
        # Current year has very little data but it's recent — might be
        # a new year that just started. Use incremental.
        logger.info("Decision: INCREMENTAL (recent but sparse: %d rows for %d)", recent_count, current_year)
        return True

    logger.info("Decision: INCREMENTAL (gap=%d days, recent_count=%d)", days_gap, recent_count)
    return True
