"""Snowpack ETL — daily snow water equivalent for CDEC snow stations.

Upserts snow-station metadata from the static MAJOR_SNOW_STATIONS map,
then fetches daily SWE (CDEC sensor 3) from the JSON servlet and upserts
into snow_daily.

Snow is seasonal — SWE is ~0 all summer and builds through winter — so
the trailing-window default is wider than reservoirs' (120 days) to keep
the current accumulation season fully fresh. Use --backfill for the
initial multi-decade load; it walks year-sized windows with a courtesy
delay.

Source: DWR California Data Exchange Center (cdec.water.ca.gov).

Usage:
    python -m etl.load_snowpack                     # trailing 120 days
    python -m etl.load_snowpack --start 2026-01-01 --end 2026-07-01
    python -m etl.load_snowpack --backfill          # from 2000-01-01
"""

import argparse
import logging
import sys
import time
from datetime import date, timedelta

from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.database import EtlSessionLocal as SessionLocal  # write/DDL role
from app.models import SnowDaily, SnowStation
from etl._utils import date_windows, dedupe_rows, track_etl_run
from etl.cdec_api import MAJOR_SNOW_STATIONS, REQUEST_DELAY, Observation, fetch_snow_water_content

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

DEFAULT_TRAILING_DAYS = 120
BACKFILL_START = date(2000, 1, 1)
BATCH_SIZE = 1000


def upsert_stations(db) -> int:
    """Sync the snow_stations table from the static MAJOR_SNOW_STATIONS map.

    The static map is authoritative: every run overwrites name, elevation,
    and region. Correct bad metadata in etl/cdec_api.py, not in the
    database — a direct DB edit is silently clobbered on the next run.
    """
    rows = [
        {
            "station_id": station_id,
            "name": meta["name"],
            "elevation_ft": meta["elevation_ft"],
            "region": meta["region"],
        }
        for station_id, meta in sorted(MAJOR_SNOW_STATIONS.items())
    ]
    stmt = pg_insert(SnowStation).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=["station_id"],
        set_={
            "name": stmt.excluded.name,
            "elevation_ft": stmt.excluded.elevation_ft,
            "region": stmt.excluded.region,
        },
    )
    db.execute(stmt)
    db.commit()
    logger.info("Upserted %d snow stations", len(rows))
    return len(rows)


def upsert_observations(db, observations: list[Observation]) -> int:
    """Bulk-upsert daily SWE rows keyed on (station_id, date)."""
    known = set(MAJOR_SNOW_STATIONS)
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
                "swe_in": obs.value,
            }
        )
    if skipped:
        logger.warning(
            "Dropped %d observations for stations not in MAJOR_SNOW_STATIONS", skipped
        )

    # CDEC can return an original plus a revised reading for one station-day;
    # duplicate conflict keys in a single statement are a Postgres error.
    rows = dedupe_rows(rows, key=("station_id", "date"))

    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        stmt = pg_insert(SnowDaily).values(batch)
        stmt = stmt.on_conflict_do_update(
            constraint="uq_snow_daily_station_date",
            set_={"swe_in": stmt.excluded.swe_in},
        )
        db.execute(stmt)
        db.commit()

    return len(rows)


@track_etl_run("snowpack")
def run(start: date, end: date) -> int:
    """Fetch and upsert SWE for [start, end]. Returns rows loaded."""
    db = SessionLocal()
    try:
        upsert_stations(db)

        total = 0
        windows = date_windows(start, end)
        for i, (win_start, win_end) in enumerate(windows):
            if i:
                time.sleep(REQUEST_DELAY)
            logger.info(
                "Window %d/%d: %s → %s", i + 1, len(windows), win_start, win_end
            )
            observations = fetch_snow_water_content(win_start, win_end)
            total += upsert_observations(db, observations)

        logger.info("Done. %d daily SWE rows upserted.", total)
        return total
    finally:
        db.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Load CDEC snow water equivalent")
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
