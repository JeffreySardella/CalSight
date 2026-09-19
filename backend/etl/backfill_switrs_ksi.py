"""One-off: copy SWITRS seriously-injured counts onto crashes (KSI, 2001-2015).

The SWITRS archive's collisions.severe_injury_count (raw COUNT_SEVERE_INJ) was
never loaded, so crashes.number_severe_injured is 0 on every SWITRS row after
its migration. This reads only the non-zero counts, one year at a time, and
writes just those rows. The column's DEFAULT 0 already covers the rest.

Rows are matched on the loader's folded ids (switrs_api._fold_case_id). 211,120
of 2001's case ids overflow bigint and are stored folded, so unfolded they
would silently match nothing.

Idempotent: the UPDATE skips rows already holding the value, so a re-run
writes 0 rows. Exits non-zero when a year has no seriously injured people or
fewer than 99% of its source rows matched a crash (unmatched rows are expected
only where the loader skipped a null datetime).

Not registered in etl/jobs.py because the archive is static. Deliberately not
@track_etl_run either: an etl_runs row for a one-off source would sit in
/api/freshness and read stale a week later. The workflow run log is the record.

Usage:
    gh workflow run "Run ETL Job" -f job=backfill_switrs_ksi -f refresh_matviews=true
    python -m etl.backfill_switrs_ksi --sqlite /path/to/switrs.sqlite   # local, archive already downloaded
"""

from __future__ import annotations

import argparse
import logging
import shutil
import sqlite3
import tempfile
from contextlib import closing

from sqlalchemy import text

from app.database import EtlSessionLocal as SessionLocal  # write/DDL role
from etl.switrs_api import _fold_case_id, _safe_count, _safe_int, download_switrs_archive

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

START_YEAR = 2001
END_YEAR = 2015
BATCH_SIZE = 5000
MIN_MATCH_RATE = 0.99

# uq_crashes_collision_source makes this an index lookup per id.
_UPDATE = text("""
    UPDATE crashes c
    SET number_severe_injured = v.n
    FROM unnest(CAST(:ids AS BIGINT[]), CAST(:ns AS SMALLINT[])) AS v(id, n)
    WHERE c.collision_id = v.id
      AND c.data_source = 'switrs'
      AND c.number_severe_injured IS DISTINCT FROM v.n
""")

_MATCHED = text("""
    SELECT count(*), COALESCE(sum(number_severe_injured), 0)
    FROM crashes
    WHERE collision_id = ANY(CAST(:ids AS BIGINT[]))
      AND data_source = 'switrs'
""")


def assert_severe_column(conn: sqlite3.Connection) -> None:
    """Fail loudly if the archive lacks the column this job depends on."""
    cols = {row[1] for row in conn.execute("PRAGMA table_info(collisions)")}
    if "severe_injury_count" not in cols:
        raise RuntimeError(
            "SWITRS archive has no collisions.severe_injury_count column; "
            f"columns found: {sorted(cols)}"
        )


def read_severe_counts(conn: sqlite3.Connection, year: int) -> dict[int, int]:
    """{folded collision_id: seriously injured people} for one year, non-zero only."""
    cursor = conn.execute(
        "SELECT case_id, severe_injury_count FROM collisions "
        "WHERE collision_date LIKE ? AND severe_injury_count > 0",
        (f"{year}-%",),
    )
    counts: dict[int, int] = {}
    for case_id, raw in cursor:
        collision_id = _fold_case_id(_safe_int(case_id))
        n = _safe_count(raw)
        if collision_id is None or not n:
            continue
        counts[collision_id] = n  # duplicate case_id: last wins, like the loader's upsert
    return counts


def apply_year(db, counts: dict[int, int]) -> tuple[int, int, int]:
    """Write one year's counts in batches, committing each batch.

    Returns (rows written, source rows that matched a SWITRS crash, the summed
    number_severe_injured on those matched crashes).
    """
    items = list(counts.items())
    written = matched = severe_sum = 0
    for i in range(0, len(items), BATCH_SIZE):
        chunk = items[i:i + BATCH_SIZE]
        ids = [cid for cid, _ in chunk]
        r = db.execute(_UPDATE, {"ids": ids, "ns": [n for _, n in chunk]})
        found, total = db.execute(_MATCHED, {"ids": ids}).one()
        db.commit()
        written += r.rowcount
        matched += found
        severe_sum += total
    return written, matched, int(severe_sum)


def year_failure(year: int, counts: dict[int, int], matched: int) -> str | None:
    """Why this year fails verification, or None when it passes."""
    if not counts:
        return f"{year}: no seriously injured people in the archive"
    rate = matched / len(counts)
    if rate < MIN_MATCH_RATE:
        return f"{year}: only {rate:.1%} of {len(counts):,} source rows matched a crash"
    return None


def run(start_year: int = START_YEAR, end_year: int = END_YEAR, sqlite_path: str | None = None) -> int:
    tmp_dir = None
    db = SessionLocal()
    try:
        if sqlite_path is None:
            tmp_dir = tempfile.mkdtemp(prefix="switrs_ksi_")
            logger.info("Downloading SWITRS archive to %s", tmp_dir)
            sqlite_path = download_switrs_archive(tmp_dir)

        failures: list[str] = []
        total_written = 0
        with closing(sqlite3.connect(sqlite_path)) as conn:
            assert_severe_column(conn)
            for year in range(start_year, end_year + 1):
                counts = read_severe_counts(conn, year)
                written, matched, severe_sum = apply_year(db, counts)
                total_written += written
                logger.info(
                    "%d: source %d crashes / %d people; matched %d crashes holding %d people; wrote %d rows",
                    year, len(counts), sum(counts.values()), matched, severe_sum, written,
                )
                reason = year_failure(year, counts, matched)
                if reason:
                    failures.append(reason)

        if failures:
            raise RuntimeError("SWITRS KSI backfill verification failed: " + "; ".join(failures))
        logger.info("SWITRS KSI backfill done: %d rows written", total_written)
        return total_written
    finally:
        db.close()
        if tmp_dir is not None:
            shutil.rmtree(tmp_dir, ignore_errors=True)
            logger.info("Cleaned up temp dir: %s", tmp_dir)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="One-off SWITRS seriously-injured backfill (KSI)")
    parser.add_argument("--start", type=int, default=START_YEAR)
    parser.add_argument("--end", type=int, default=END_YEAR)
    parser.add_argument("--sqlite", default=None, help="Use an already-extracted switrs.sqlite instead of downloading")
    args = parser.parse_args(argv)
    run(start_year=args.start, end_year=args.end, sqlite_path=args.sqlite)


if __name__ == "__main__":
    main()
