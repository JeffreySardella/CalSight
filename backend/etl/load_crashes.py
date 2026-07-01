"""ETL orchestrator: load crash data from SWITRS/CCRS into Postgres.

This is the main script you run to populate the crashes table.
It coordinates everything:
  1. Determines which years use SWITRS vs CCRS based on data source routing
  2. For SWITRS years (≤ 2015): downloads archive once, reads all years
  3. For CCRS years (≥ 2016): fetches year by year from the CKAN API
  4. Upserts (insert-or-update) into the database in batches

"Upsert" means: if a row for this collision_id already exists, update it.
If not, insert a new one. This makes the script safe to re-run — you
won't get duplicate rows.

Source routing:
  - SWITRS covers 2001–2015 (historical archive from Zenodo)
  - CCRS covers 2016–present (live CKAN API from data.ca.gov)

Usage:
    python -m etl.load_crashes
    python -m etl.load_crashes --start 2020 --end 2022
    python -m etl.load_crashes --start 2020 --end 2022 --source ccrs
"""

import argparse
import logging
import sys
import tempfile
from datetime import datetime, timezone

from sqlalchemy import extract, func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.cities_match import normalize_name
from app.database import EtlSessionLocal as SessionLocal  # write/DDL role
from app.models import City, Crash, EtlRun

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

DEFAULT_START_YEAR = 2016
DEFAULT_END_YEAR = datetime.now().year + 1  # auto-advance each year

BATCH_SIZE = 5000


def determine_source(year: int) -> str:
    """Determine which data source to use for a given year.

    The boundary between SWITRS and CCRS is 2016:
      - 2015 and earlier: SWITRS historical archive
      - 2016 and later: CCRS CKAN API (live data from data.ca.gov)

    Why? CCRS (the new system) was introduced in 2016. SWITRS (the old system)
    covers the historical record up through 2015.

    Args:
        year: The crash year to classify.

    Returns:
        "switrs" if year <= 2015, "ccrs" if year >= 2016.
    """
    if year <= 2015:
        return "switrs"
    return "ccrs"


def get_loaded_years(session) -> dict[int, int]:
    """Check which years already have crash data in the database.

    Returns a dict of {year: row_count} so we can skip years that
    are already fully loaded. This prevents re-downloading and
    re-upserting hundreds of thousands of rows we already have.
    """
    rows = session.query(
        extract("year", Crash.crash_datetime).label("yr"),
        func.count(Crash.id),
    ).group_by("yr").all()
    return {int(yr): cnt for yr, cnt in rows}


# Columns to update when a collision_id already exists.
# Excludes 'collision_id' (the conflict key) and 'id' / 'created_at' (auto-generated).
_UPSERT_COLUMNS = [
    "crash_datetime", "day_of_week", "county_code", "city_name", "city_id",
    "latitude", "longitude", "collision_type", "primary_factor",
    "motor_vehicle_involved_with", "number_killed", "number_injured",
    "weather", "road_condition", "lighting", "is_highway", "is_freeway",
    "primary_road", "secondary_road", "hit_run", "pedestrian_involved",
    "data_source",
]


def build_city_lookup(db) -> dict[tuple[int, str], int]:
    """{(county_code, name_normalized) -> city_id} built once per ETL run.

    Used by normalize_city_id() to translate the freeform crashes.city_name
    into a foreign key. ~1600 rows, so memory is negligible and hash lookups
    are O(1) per crash.
    """
    return {
        (c.county_code, c.name_normalized): c.id
        for c in db.query(City.id, City.county_code, City.name_normalized).all()
    }


def normalize_city_id(
    row: dict, lookup: dict[tuple[int, str], int]
) -> None:
    """Resolve row['city_id'] from (county_code, city_name) in-place.

    Sets None when no match is found — that's the documented behavior for
    unincorporated areas and unknown cities. The raw city_name is preserved
    on the row so analysts can still see what was reported.
    """
    county_code = row.get("county_code")
    city_name = row.get("city_name")
    if county_code is None or not city_name:
        row["city_id"] = None
        return
    row["city_id"] = lookup.get((county_code, normalize_name(city_name)))


def upsert_crashes(
    session,
    rows: list[dict],
    city_lookup: dict[tuple[int, str], int] | None = None,
) -> int:
    """Bulk-upsert crash rows using PostgreSQL INSERT ... ON CONFLICT.

    Instead of one SELECT + one INSERT/UPDATE per row (2 round-trips each),
    this sends one statement for the entire batch. PostgreSQL handles the
    conflict resolution natively — far fewer network round-trips to Azure.

    How it works:
    - INSERT all rows in one statement
    - ON CONFLICT (collision_id): update all columns to the new values
    - This is idempotent — rerunning produces the same result

    Args:
        session: SQLAlchemy session.
        rows: List of dicts with keys matching Crash model column names.

    Returns:
        Number of rows processed (inserted + updated — PostgreSQL doesn't
        distinguish in ON CONFLICT, but the count is the same either way).
    """
    if not rows:
        return 0

    # Normalize city_name → city_id before upsert. Done per row so the
    # bulk INSERT below carries the resolved FK.
    if city_lookup is not None:
        for r in rows:
            normalize_city_id(r, city_lookup)

    # Filter out rows missing required fields — a single null county_code
    # or null crash_datetime would fail the entire batch in bulk insert.
    valid_rows = [
        r for r in rows
        if r.get("collision_id") is not None
        and r.get("crash_datetime") is not None
        and r.get("county_code") is not None
    ]
    skipped = len(rows) - len(valid_rows)
    if skipped:
        logger.warning("Filtered %d rows with null required fields", skipped)
    if not valid_rows:
        return 0

    stmt = pg_insert(Crash).values(valid_rows)
    update_set = {col: stmt.excluded[col] for col in _UPSERT_COLUMNS}
    update_set["coord_county_mismatch"] = None
    update_set["coord_validated_at"] = None
    stmt = stmt.on_conflict_do_update(
        constraint="uq_crashes_collision_source",
        set_=update_set,
    )
    session.execute(stmt)
    return len(rows)


def select_years_to_load(
    start_year: int,
    end_year: int,
    loaded: dict[int, int],
    source_filter: str | None = None,
    force: bool = False,
    today_year: int | None = None,
) -> tuple[list[int], list[int], list[int]]:
    """Partition the requested year range into SWITRS/CCRS years to load.

    Years that already have rows are skipped — except the current and
    previous year, which keep receiving new CHP records nightly and are
    always reloaded (the ON CONFLICT upsert makes re-loading them safe).
    Without that exception, the daily job would no-op as soon as a year
    had a single batch loaded.

    Returns (switrs_years, ccrs_years, skipped_years).
    """
    if today_year is None:
        today_year = datetime.now(timezone.utc).year

    switrs_years = [
        y for y in range(start_year, end_year + 1)
        if determine_source(y) == "switrs"
        and (source_filter is None or source_filter == "switrs")
    ]
    ccrs_years = [
        y for y in range(start_year, end_year + 1)
        if determine_source(y) == "ccrs"
        and (source_filter is None or source_filter == "ccrs")
    ]

    skipped: list[int] = []
    if not force:
        refresh_years = {today_year, today_year - 1}
        skipped = sorted(
            [y for y in switrs_years if y in loaded]
            + [y for y in ccrs_years if y in loaded and y not in refresh_years]
        )
        switrs_years = [y for y in switrs_years if y not in loaded]
        ccrs_years = [
            y for y in ccrs_years if y not in loaded or y in refresh_years
        ]

    return switrs_years, ccrs_years, skipped


def run(
    start_year: int = DEFAULT_START_YEAR,
    end_year: int = DEFAULT_END_YEAR,
    source_filter: str | None = None,
    force: bool = False,
):
    """Main ETL entry point for crash data.

    Loads crash records from SWITRS (historical) and/or CCRS (recent)
    into Postgres. The source for each year is determined by determine_source().

    Key improvements over the original:
    - Skips years that already have data (use --force to reload)
    - Uses bulk INSERT ... ON CONFLICT for ~100x fewer DB round-trips
    - Streams CCRS pages directly to DB instead of loading entire year into memory

    The --source flag lets you restrict loading to one source:
    - --source switrs: only load SWITRS years from the range
    - --source ccrs: only load CCRS years from the range
    - (omit): load all years using the appropriate source

    Args:
        start_year: First year to load (inclusive).
        end_year: Last year to load (inclusive).
        source_filter: If set, only load years that use this source ("switrs" or "ccrs").
        force: If True, reload years even if they already have data.
    """
    db = SessionLocal()
    tmp_dir = None

    # Pre-build the (county, normalized name) -> city_id map once per run so
    # the per-batch upserts can resolve city_id without re-querying.
    city_lookup = build_city_lookup(db)
    logger.info("Loaded %d cities for normalization lookup", len(city_lookup))

    # Check which years already have data so we can skip them
    loaded = get_loaded_years(db)
    if loaded:
        logger.info("Years already loaded: %s", {y: f"{c:,}" for y, c in sorted(loaded.items())})

    # Create an EtlRun record to track this run
    etl_run = EtlRun(
        source="ccrs",
        status="running",
        started_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(etl_run)
    db.commit()
    logger.info("Created EtlRun id=%d", etl_run.id)

    total_rows = 0
    error_message = None

    try:
        # Partition years into SWITRS vs CCRS and drop already-loaded years
        # (current + previous year are always reloaded; see the helper).
        switrs_years, ccrs_years, skipped = select_years_to_load(
            start_year, end_year, loaded, source_filter=source_filter, force=force,
        )
        if skipped:
            logger.info(
                "Skipping already-loaded years: %s (use --force to reload)",
                skipped,
            )

        logger.info(
            "Year range %d–%d: %d SWITRS years, %d CCRS years to load",
            start_year, end_year, len(switrs_years), len(ccrs_years),
        )

        failed_batches = 0

        # --- SWITRS years ---
        # Download the archive once, then read all years from the SQLite file.
        # This avoids re-downloading for each year (the archive is ~1 GB).
        if switrs_years:
            from etl.switrs_api import download_switrs_archive, read_crashes_from_sqlite  # noqa: PLC0415

            tmp_dir = tempfile.mkdtemp(prefix="switrs_")
            logger.info("Downloading SWITRS archive to %s", tmp_dir)
            sqlite_path = download_switrs_archive(tmp_dir)

            switrs_start = min(switrs_years)
            switrs_end = max(switrs_years)
            all_switrs_rows = read_crashes_from_sqlite(sqlite_path, switrs_start, switrs_end)

            logger.info(
                "SWITRS: %d records for years %d–%d, upserting in batches of %d",
                len(all_switrs_rows), switrs_start, switrs_end, BATCH_SIZE,
            )

            for batch_start in range(0, len(all_switrs_rows), BATCH_SIZE):
                batch = all_switrs_rows[batch_start: batch_start + BATCH_SIZE]
                try:
                    count = upsert_crashes(db, batch, city_lookup=city_lookup)
                    db.commit()
                    total_rows += count
                    logger.info(
                        "SWITRS batch [%d:%d]: %d rows upserted",
                        batch_start, batch_start + len(batch), count,
                    )
                except Exception as exc:
                    failed_batches += 1
                    logger.error("SWITRS batch [%d:%d] failed: %s", batch_start, batch_start + len(batch), exc)
                    db.rollback()

        # --- CCRS years ---
        # Stream each page from the CKAN API directly into the DB.
        # Each page (~32K records) is fetched, transformed, and upserted
        # before fetching the next — no full-year memory buffer needed.
        if ccrs_years:
            from etl.ckan_api import fetch_crashes_for_year  # noqa: PLC0415

            for year in ccrs_years:
                year_rows = 0
                try:
                    logger.info("Starting CCRS year %d...", year)

                    for batch, offset, total in fetch_crashes_for_year(year):
                        try:
                            count = upsert_crashes(db, batch, city_lookup=city_lookup)
                            db.commit()
                            year_rows += count
                            total_rows += count
                            logger.info(
                                "CCRS year %d: upserted %d rows (%d/%d fetched, %d total for year)",
                                year, count, offset, total, year_rows,
                            )
                        except Exception as exc:
                            failed_batches += 1
                            logger.error(
                                "CCRS year %d batch at offset %d failed: %s",
                                year, offset, exc,
                            )
                            db.rollback()

                    logger.info("CCRS year %d complete: %d rows", year, year_rows)

                except Exception as exc:
                    failed_batches += 1
                    logger.error("CCRS year %d failed entirely: %s", year, exc)
                    db.rollback()

        # Summary
        logger.info("Done. %d total rows upserted, %d batches failed.", total_rows, failed_batches)

        etl_run.status = "partial_success" if failed_batches > 0 else "success"
        etl_run.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
        etl_run.rows_loaded = total_rows
        if failed_batches > 0:
            etl_run.error_message = f"{failed_batches} batch(es) failed during load"
        db.commit()

    except Exception as exc:
        error_message = str(exc)
        logger.error("ETL run failed: %s", exc)
        try:
            etl_run.status = "error"
            etl_run.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
            etl_run.error_message = error_message
            db.commit()
        except Exception:
            db.rollback()
        sys.exit(1)

    finally:
        db.close()
        # Clean up the SWITRS temp directory if we created one
        if tmp_dir is not None:
            import shutil  # noqa: PLC0415
            shutil.rmtree(tmp_dir, ignore_errors=True)
            logger.info("Cleaned up temp dir: %s", tmp_dir)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Load crash data from SWITRS/CCRS into Postgres")
    parser.add_argument("--start", type=int, default=DEFAULT_START_YEAR)
    parser.add_argument("--end", type=int, default=DEFAULT_END_YEAR)
    parser.add_argument("--source", choices=["switrs", "ccrs"], default=None)
    parser.add_argument("--force", action="store_true", help="Reload years even if data already exists")
    args = parser.parse_args()
    run(start_year=args.start, end_year=args.end, source_filter=args.source, force=args.force)
