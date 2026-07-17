"""Precipitation-index ETL — daily accumulated water-year precip for the
three DWR regional indices (CDEC 8SI/5SI/6SI, sensor 2).

Fetches daily accumulated precipitation (inches, cumulative from Oct 1) from
the CDEC JSON servlet and upserts into precip_index_daily. Each index is
itself a CDEC station, so there is no per-gauge aggregation and no station
table — metadata lives in the static PRECIP_INDEX_STATIONS map.

Like reservoirs and snowpack, the value resets each water year and the trailing
window keeps the current year fresh; --backfill loads the multi-decade history
for the day-of-year percent-of-average baseline.

Source: DWR California Data Exchange Center (cdec.water.ca.gov).

Usage:
    python -m etl.load_precip_indices                    # trailing 120 days
    python -m etl.load_precip_indices --start 2025-10-01 --end 2026-07-01
    python -m etl.load_precip_indices --backfill         # from 2000-01-01
"""

import argparse
import logging
import sys
import time
from datetime import date, timedelta

from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.database import EtlSessionLocal as SessionLocal  # write/DDL role
from app.models import PrecipIndexDaily
from etl._utils import date_windows, dedupe_rows, track_etl_run
from etl.cdec_api import (
    PRECIP_INDEX_STATIONS,
    REQUEST_DELAY,
    Observation,
    fetch_precip_indices,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

DEFAULT_TRAILING_DAYS = 120
BACKFILL_START = date(2000, 1, 1)
BATCH_SIZE = 1000


def upsert_observations(db, observations: list[Observation]) -> int:
    """Bulk-upsert daily accumulated-precip rows keyed on (station_id, date)."""
    known = set(PRECIP_INDEX_STATIONS)
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
                # Accumulated precip is monotonic and non-negative; clamp any
                # small negative telemetry drift to zero (mirrors snowpack).
                "accum_in": max(obs.value, 0.0),
            }
        )
    if skipped:
        logger.warning(
            "Dropped %d observations for stations not in PRECIP_INDEX_STATIONS",
            skipped,
        )

    # CDEC can return an original plus a revised reading for one station-day;
    # duplicate conflict keys in a single statement are a Postgres error.
    rows = dedupe_rows(rows, key=("station_id", "date"))

    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        stmt = pg_insert(PrecipIndexDaily).values(batch)
        stmt = stmt.on_conflict_do_update(
            constraint="uq_precip_index_daily_station_date",
            set_={"accum_in": stmt.excluded.accum_in},
        )
        db.execute(stmt)
        db.commit()

    return len(rows)


@track_etl_run("precip_indices")
def run(start: date, end: date) -> int:
    """Fetch and upsert accumulated precip for [start, end]. Returns rows loaded."""
    db = SessionLocal()
    try:
        total = 0
        windows = date_windows(start, end)
        for i, (win_start, win_end) in enumerate(windows):
            if i:
                time.sleep(REQUEST_DELAY)
            logger.info(
                "Window %d/%d: %s → %s", i + 1, len(windows), win_start, win_end
            )
            observations = fetch_precip_indices(win_start, win_end)
            total += upsert_observations(db, observations)

        logger.info("Done. %d daily precip-index rows upserted.", total)
        return total
    finally:
        db.close()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Load CDEC Sierra precipitation indices (8SI/5SI/6SI)"
    )
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
