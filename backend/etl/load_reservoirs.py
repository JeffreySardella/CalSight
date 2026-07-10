"""Reservoir storage ETL — daily storage for major California reservoirs.

Upserts reservoir metadata from the static MAJOR_RESERVOIRS map, then
fetches daily storage (CDEC sensor 15) from the CDEC JSON servlet and
upserts into reservoir_daily.

Default run fetches the trailing 45 days — enough to self-heal the
gaps CDEC backfills when stations report late, cheap enough to run
daily. Use --backfill for the initial multi-decade load; it walks
year-sized windows with a courtesy delay so a single request never
asks for 25 years of data.

Source: DWR California Data Exchange Center (cdec.water.ca.gov).

Usage:
    python -m etl.load_reservoirs                     # trailing 45 days
    python -m etl.load_reservoirs --start 2026-01-01 --end 2026-07-01
    python -m etl.load_reservoirs --backfill          # from 2000-01-01
"""

import argparse
import logging
import sys
import time
from datetime import date, timedelta

from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.database import EtlSessionLocal as SessionLocal  # write/DDL role
from app.models import County, Reservoir, ReservoirDaily
from etl._utils import track_etl_run
from etl.cdec_api import (
    MAJOR_RESERVOIRS,
    REQUEST_DELAY,
    Observation,
    fetch_reservoir_storage,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

DEFAULT_TRAILING_DAYS = 45
BACKFILL_START = date(2000, 1, 1)
BATCH_SIZE = 1000


def date_windows(start: date, end: date, days: int = 365) -> list[tuple[date, date]]:
    """Split [start, end] into inclusive windows of at most `days` days.

    Keeps each CDEC request bounded — a full backfill asks for one year
    at a time instead of 25 years of 15 stations in one response.
    """
    if start > end:
        return []
    windows = []
    cursor = start
    while cursor <= end:
        window_end = min(cursor + timedelta(days=days - 1), end)
        windows.append((cursor, window_end))
        cursor = window_end + timedelta(days=1)
    return windows


def upsert_reservoirs(db) -> int:
    """Sync the reservoirs table from the static MAJOR_RESERVOIRS map."""
    name_to_code = {
        name.upper(): code for name, code in db.query(County.name, County.code)
    }

    rows = []
    for station_id, meta in sorted(MAJOR_RESERVOIRS.items()):
        county_code = name_to_code.get(meta["county"].upper())
        if county_code is None:
            logger.warning(
                "Reservoir %s: county %r not found in counties table — "
                "storing with county_code=NULL",
                station_id,
                meta["county"],
            )
        rows.append(
            {
                "station_id": station_id,
                "name": meta["name"],
                "capacity_af": meta["capacity_af"],
                "county_code": county_code,
            }
        )

    stmt = pg_insert(Reservoir).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=["station_id"],
        set_={
            "name": stmt.excluded.name,
            "capacity_af": stmt.excluded.capacity_af,
            "county_code": stmt.excluded.county_code,
        },
    )
    db.execute(stmt)
    db.commit()
    logger.info("Upserted %d reservoirs", len(rows))
    return len(rows)


def upsert_observations(db, observations: list[Observation]) -> int:
    """Bulk-upsert daily storage rows keyed on (station_id, date).

    Observations for stations missing from MAJOR_RESERVOIRS are dropped
    (they would violate the FK) — CDEC batch responses should only ever
    contain requested stations, so any drop here is logged loudly.
    """
    known = set(MAJOR_RESERVOIRS)
    rows = []
    skipped = 0
    for obs in observations:
        if obs.station_id not in known:
            skipped += 1
            continue
        rows.append(
            {
                "station_id": obs.station_id,
                "date": obs.date,
                "storage_af": obs.value,
            }
        )
    if skipped:
        logger.warning(
            "Dropped %d observations for stations not in MAJOR_RESERVOIRS", skipped
        )

    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        stmt = pg_insert(ReservoirDaily).values(batch)
        stmt = stmt.on_conflict_do_update(
            constraint="uq_reservoir_daily_station_date",
            set_={"storage_af": stmt.excluded.storage_af},
        )
        db.execute(stmt)
        db.commit()

    return len(rows)


@track_etl_run("reservoirs")
def run(start: date, end: date) -> int:
    """Fetch and upsert storage for [start, end]. Returns rows loaded."""
    db = SessionLocal()
    try:
        upsert_reservoirs(db)

        total = 0
        windows = date_windows(start, end)
        for i, (win_start, win_end) in enumerate(windows):
            logger.info(
                "Window %d/%d: %s → %s", i + 1, len(windows), win_start, win_end
            )
            observations = fetch_reservoir_storage(win_start, win_end)
            total += upsert_observations(db, observations)
            if i + 1 < len(windows):
                time.sleep(REQUEST_DELAY)

        logger.info("Done. %d daily storage rows upserted.", total)
        return total
    finally:
        db.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Load CDEC reservoir storage")
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
        start = args.start or end - timedelta(days=DEFAULT_TRAILING_DAYS)

    if start > end:
        parser.error(f"--start {start} is after --end {end}")

    run(start, end)
    return 0


if __name__ == "__main__":
    sys.exit(main())
