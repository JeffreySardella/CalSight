"""US Drought Monitor ETL — weekly drought severity per county.

Fetches county-level drought area percentages for California and upserts
into drought_county_weekly, mapping USDM county FIPS codes onto the
counties table.

Default run fetches the trailing 8 weeks — USDM occasionally revises
recent maps, and the fetch is tiny (58 counties × 8 weeks). Use
--backfill for the initial load; weekly maps go back to 2000.

Source: US Drought Monitor (usdmdataservices.unl.edu). The Drought
Monitor is jointly produced by the National Drought Mitigation Center,
USDA, and NOAA. Map courtesy of NDMC.

Usage:
    python -m etl.load_drought                      # trailing 8 weeks
    python -m etl.load_drought --start 2024-01-01 --end 2026-07-01
    python -m etl.load_drought --backfill           # from 2000-01-04
"""

import argparse
import logging
import sys
import time
from datetime import date, timedelta

from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.database import EtlSessionLocal as SessionLocal  # write/DDL role
from app.models import County, DroughtCountyWeekly
from etl._utils import date_windows, dedupe_rows, track_etl_run
from etl.usdm_api import DroughtWeek, fetch_county_drought, parse_drought_weeks

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

DEFAULT_TRAILING_WEEKS = 8
BACKFILL_START = date(2000, 1, 4)  # first USDM map of 2000
WINDOW_DAYS = 730  # ~2 years per request keeps responses modest
REQUEST_DELAY = 1.0  # courtesy delay between backfill windows
BATCH_SIZE = 1000


def build_fips_lookup(db) -> dict[str, int]:
    """FIPS → county_code from the counties table (one query per run)."""
    return {
        fips: code
        for fips, code in db.query(County.fips, County.code)
        if fips is not None
    }


def upsert_drought_weeks(
    db, weeks: list[DroughtWeek], fips_to_code: dict[str, int] | None = None
) -> int:
    """Bulk-upsert county-weeks keyed on (county_code, week_start).

    Rows whose FIPS doesn't match a California county are dropped and
    counted (USDM's CA query should only return the 58, so drops are
    logged loudly).
    """
    if fips_to_code is None:
        fips_to_code = build_fips_lookup(db)

    rows = []
    skipped = 0
    for week in weeks:
        county_code = fips_to_code.get(week.fips)
        if county_code is None:
            skipped += 1
            continue
        rows.append(
            {
                "county_code": county_code,
                "week_start": week.week_start,
                "none_pct": week.none_pct,
                "d0_pct": week.d0_pct,
                "d1_pct": week.d1_pct,
                "d2_pct": week.d2_pct,
                "d3_pct": week.d3_pct,
                "d4_pct": week.d4_pct,
            }
        )
    if skipped:
        logger.warning("Dropped %d rows with FIPS not in counties table", skipped)

    # USDM occasionally revises a week; duplicate conflict keys in a single
    # statement are a Postgres error.
    rows = dedupe_rows(rows, key=("county_code", "week_start"))

    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        stmt = pg_insert(DroughtCountyWeekly).values(batch)
        stmt = stmt.on_conflict_do_update(
            constraint="uq_drought_county_week",
            set_={
                "none_pct": stmt.excluded.none_pct,
                "d0_pct": stmt.excluded.d0_pct,
                "d1_pct": stmt.excluded.d1_pct,
                "d2_pct": stmt.excluded.d2_pct,
                "d3_pct": stmt.excluded.d3_pct,
                "d4_pct": stmt.excluded.d4_pct,
            },
        )
        db.execute(stmt)
        db.commit()

    return len(rows)


@track_etl_run("drought")
def run(start: date, end: date) -> int:
    """Fetch and upsert drought weeks for [start, end]. Returns rows loaded."""
    db = SessionLocal()
    try:
        fips_to_code = build_fips_lookup(db)
        total = 0
        windows = date_windows(start, end, days=WINDOW_DAYS)
        for i, (win_start, win_end) in enumerate(windows):
            if i:
                time.sleep(REQUEST_DELAY)
            logger.info(
                "Window %d/%d: %s → %s", i + 1, len(windows), win_start, win_end
            )
            raw = fetch_county_drought(win_start, win_end)
            total += upsert_drought_weeks(db, parse_drought_weeks(raw), fips_to_code)

        logger.info("Done. %d county-week rows upserted.", total)
        return total
    finally:
        db.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Load US Drought Monitor data")
    parser.add_argument("--start", type=date.fromisoformat)
    parser.add_argument("--end", type=date.fromisoformat)
    parser.add_argument(
        "--backfill",
        action="store_true",
        help=f"load everything from {BACKFILL_START} (overrides --start)",
    )
    args = parser.parse_args()

    end = args.end or date.today()
    if args.backfill:
        start = BACKFILL_START
    else:
        start = args.start or end - timedelta(weeks=DEFAULT_TRAILING_WEEKS)

    if start > end:
        parser.error(f"--start {start} is after --end {end}")

    run(start, end)
    return 0


if __name__ == "__main__":
    sys.exit(main())
