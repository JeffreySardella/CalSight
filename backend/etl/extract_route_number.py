"""Backfill the crashes.route_number column from primary_road.

One-time backfill that pre-extracts the canonical California highway ID
("I-5", "US-101", "SR-99") so /api/stats/highways can rank routes without
running 14 different regex branches across 11M rows at query time.

Idempotent: only touches rows where route_number IS NULL. Year-by-year
chunking keeps the UPDATE lock windows small, matching the pattern in
backfill_derived.py.

Usage:
    python -m etl.extract_route_number
"""

from __future__ import annotations

import logging

from sqlalchemy import text

from app.database import EtlSessionLocal as SessionLocal  # write/DDL role
from app.route_extraction import extract_route_number
from etl._utils import track_etl_run


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


def _all_crash_year_range(db) -> range:
    """Year range covering every crash in the DB.

    Boundaries come from the data itself so re-running this script after a
    fresh load automatically picks up new years without a code change.
    """
    row = db.execute(text("""
        SELECT
            MIN(EXTRACT(YEAR FROM crash_datetime)::int),
            MAX(EXTRACT(YEAR FROM crash_datetime)::int)
        FROM crashes
    """)).one_or_none()
    if row is None or row[0] is None:
        return range(0)
    return range(int(row[0]), int(row[1]) + 1)


# Number of rows to update per round-trip. Larger = fewer round-trips, but
# the UPDATE locks rows for that batch's duration. 2k is comfortable.
_BATCH_SIZE = 2000


def _flush(db, ids: list[int], values: list[str]) -> None:
    if not ids:
        return
    db.execute(
        text("""
            UPDATE crashes c
            SET route_number = u.rn
            FROM unnest(CAST(:ids AS BIGINT[]), CAST(:rns AS TEXT[])) AS u(id, rn)
            WHERE c.id = u.id
        """),
        {"ids": ids, "rns": values},
    )


def backfill_route_number(db) -> int:
    """Extract route_number for every crash with a primary_road but no route.

    Returns the total number of rows updated.
    """
    total_updated = 0
    for year in _all_crash_year_range(db):
        result = db.execute(
            text("""
                SELECT id, primary_road
                FROM crashes
                WHERE crash_year = :y
                  AND primary_road IS NOT NULL
                  AND route_number IS NULL
            """),
            {"y": year},
        )

        ids: list[int] = []
        rns: list[str] = []
        matched = 0
        scanned = 0
        while True:
            rows = result.fetchmany(_BATCH_SIZE)
            if not rows:
                break
            scanned += len(rows)
            for r in rows:
                rn = extract_route_number(r.primary_road)
                if rn is None:
                    continue
                ids.append(r.id)
                rns.append(rn)
                matched += 1
                if len(ids) >= _BATCH_SIZE:
                    _flush(db, ids, rns)
                    db.commit()
                    ids, rns = [], []

        if scanned == 0:
            continue

        _flush(db, ids, rns)
        db.commit()
        total_updated += matched
        logger.info(
            "Route number %d: scanned %d, updated %d", year, scanned, matched,
        )

    logger.info("Route number backfill done: %d rows updated", total_updated)
    return total_updated


@track_etl_run("extract_route_number")
def run() -> int:
    db = SessionLocal()
    try:
        return backfill_route_number(db)
    finally:
        db.close()


if __name__ == "__main__":
    run()
