"""SWITRS SQLite archive client.

Downloads the SWITRS (Statewide Integrated Traffic Records System) collision
database from Zenodo, extracts the SQLite archive, and transforms raw rows
into the Crash model format.

SWITRS data is published as a gzip-compressed SQLite file inside a zip archive
at: https://zenodo.org/api/records/4284843/files-archive

The SQLite database has a `collisions` table with one row per collision.
Column names are ALL_CAPS (e.g. CASE_ID, COLLISION_DATE).
"""

import gzip
import logging
import shutil
import sqlite3
import time
import zipfile
from datetime import datetime
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

ZENODO_URL = "https://zenodo.org/api/records/4284843/files-archive"
MAX_RETRIES = 3
BACKOFF_BASE = 2  # seconds

DAY_OF_WEEK_MAP = {
    1: "Monday",
    2: "Tuesday",
    3: "Wednesday",
    4: "Thursday",
    5: "Friday",
    6: "Saturday",
    7: "Sunday",
}


def _safe_int(value):
    """Convert a SWITRS value to int. Returns None for nulls/empty/non-numeric.

    SWITRS SQLite columns can contain empty strings or NULL for missing data.
    Using try/except handles all edge cases (non-numeric strings, None, etc.)
    rather than explicit type checks.
    """
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def _safe_float(value):
    """Convert a SWITRS value to float. Returns None for nulls/empty/non-numeric."""
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


def _parse_switrs_datetime(date_str, time_str):
    """Parse a SWITRS collision date + time pair into a Python datetime.

    SWITRS stores:
    - collision_date as ISO format: "2012-07-15"
    - collision_time as HH:MM:SS string: "07:45:00" or "14:30:00"

    If time_str is None or empty, we default to midnight (00:00).

    Returns None if date_str is missing (can't build a datetime without a date).
    """
    if not date_str:
        return None

    if time_str is None or time_str == "":
        hour, minute = 0, 0
    else:
        # Format is "HH:MM:SS" — split on colons
        parts = str(time_str).split(":")
        hour = int(parts[0]) if len(parts) >= 1 else 0
        minute = int(parts[1]) if len(parts) >= 2 else 0

    try:
        date = datetime.fromisoformat(date_str)
        return datetime(date.year, date.month, date.day, hour, minute)
    except (ValueError, TypeError):
        return None


def transform_switrs(row: dict) -> dict:
    """Map a raw SWITRS SQLite row to the Crash model's column names.

    SWITRS SQLite columns are lowercase_with_underscores (e.g. case_id,
    collision_date, county_city_location). We map every field explicitly.

    County code is derived from the first 2 digits of county_city_location:
    "0100" means county 1, "1900" means county 19.

    Hit-and-run in SWITRS is already single-character ("M" or "F"),
    unlike CCRS which uses full words. We pass through valid codes and
    None-ify anything else.

    Pedestrian involvement is inferred from pedestrian_action: any non-empty,
    non-dash value indicates a pedestrian was involved.

    Returns a dict ready to be inserted into the crashes table.
    """
    # Extract county code from first 2 digits of county_city_location
    # e.g. "0100" -> "01" -> 1, "1900" -> "19" -> 19
    cnty_city_loc = row.get("county_city_location")
    if cnty_city_loc is not None and str(cnty_city_loc).strip():
        county_code = _safe_int(str(cnty_city_loc).zfill(4)[:2])
    else:
        county_code = None

    # Map hit-and-run: SWITRS already uses "M" / "F" single-char codes.
    # Anything else (None, empty, other codes) → None.
    hit_run_raw = row.get("hit_and_run")
    if hit_run_raw == "M":
        hit_run = "M"
    elif hit_run_raw == "F":
        hit_run = "F"
    else:
        hit_run = None

    # Pedestrian involved: True if pedestrian_action is present and not a dash/empty
    ped_action = row.get("pedestrian_action")
    pedestrian_involved = (
        ped_action is not None
        and ped_action != ""
        and ped_action != "-"
    )

    return {
        "collision_id": _safe_int(row.get("case_id")),
        "crash_datetime": _parse_switrs_datetime(
            row.get("collision_date"), row.get("collision_time")
        ),
        "day_of_week": None,  # SWITRS has no day_of_week column; derived from crash_datetime if needed
        "county_code": county_code,
        "city_name": None,  # SWITRS has only a numeric city code, no name field
        "latitude": _safe_float(row.get("latitude")),
        "longitude": _safe_float(row.get("longitude")),
        "collision_type": row.get("type_of_collision"),
        "primary_factor": row.get("pcf_violation_category"),
        "motor_vehicle_involved_with": row.get("motor_vehicle_involved_with"),
        "number_killed": _safe_int(row.get("killed_victims")),
        "number_injured": _safe_int(row.get("injured_victims")),
        "weather": row.get("weather_1"),
        "road_condition": row.get("road_surface"),
        "lighting": row.get("lighting"),
        "is_highway": row.get("state_highway_indicator") == 1,
        "is_freeway": False,  # SWITRS has no direct freeway flag
        "primary_road": row.get("primary_road"),
        "secondary_road": row.get("secondary_road"),
        "hit_run": hit_run,
        "pedestrian_involved": pedestrian_involved,
        "data_source": "switrs",
    }


def download_switrs_archive(dest_dir: str) -> str:
    """Download, extract, and decompress the SWITRS SQLite archive from Zenodo.

    The Zenodo archive is a zip file containing a gzip-compressed SQLite file
    (*.sqlite.gz). We:
    1. Stream-download the zip with retry/backoff
    2. Extract the zip
    3. Find the *.sqlite.gz file inside
    4. Decompress it with gzip
    5. Return the path to the final .sqlite file

    Args:
        dest_dir: Directory where the archive and database will be stored.

    Returns:
        Absolute path to the extracted .sqlite file.

    Raises:
        httpx.HTTPStatusError / httpx.RequestError: If all download retries fail.
        FileNotFoundError: If no .sqlite.gz file is found in the archive.
    """
    dest_path = Path(dest_dir)
    dest_path.mkdir(parents=True, exist_ok=True)
    zip_path = dest_path / "switrs_archive.zip"

    logger.info("Downloading SWITRS archive from Zenodo...")

    # Retry with exponential backoff — Zenodo can be slow on large files.
    last_error = None
    for attempt in range(MAX_RETRIES):
        try:
            with httpx.stream(
                "GET",
                ZENODO_URL,
                follow_redirects=True,
                timeout=600.0,
            ) as resp:
                resp.raise_for_status()
                with open(zip_path, "wb") as f:
                    for chunk in resp.iter_bytes():
                        f.write(chunk)
            logger.info("Download complete: %s", zip_path)
            break
        except (httpx.HTTPStatusError, httpx.RequestError) as exc:
            last_error = exc
            if attempt < MAX_RETRIES - 1:
                wait = BACKOFF_BASE ** (attempt + 1)
                logger.warning(
                    "Download attempt %d failed: %s. Retrying in %ds...",
                    attempt + 1, exc, wait,
                )
                time.sleep(wait)
    else:
        logger.error("All %d download attempts failed", MAX_RETRIES)
        raise last_error

    # Extract the zip archive
    logger.info("Extracting zip archive...")
    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(dest_path)

    # Find the .sqlite.gz file inside the extracted contents
    gz_files = list(dest_path.glob("*.sqlite.gz"))
    if not gz_files:
        raise FileNotFoundError(
            f"No .sqlite.gz file found in {dest_path}. "
            "The Zenodo archive structure may have changed."
        )
    gz_path = gz_files[0]
    sqlite_path = dest_path / gz_path.stem  # removes .gz → keeps .sqlite

    # Decompress the gzip file
    logger.info("Decompressing %s -> %s", gz_path.name, sqlite_path.name)
    with gzip.open(gz_path, "rb") as f_in:
        with open(sqlite_path, "wb") as f_out:
            shutil.copyfileobj(f_in, f_out)

    logger.info("SWITRS SQLite database ready: %s", sqlite_path)
    return str(sqlite_path)


def read_crashes_from_sqlite(
    sqlite_path: str, start_year: int, end_year: int
) -> list[dict]:
    """Read and transform collision records from the SWITRS SQLite database.

    Queries the `collisions` table one year at a time using COLLISION_DATE
    prefix matching, transforms each row via transform_switrs(), and skips
    records that don't have both a collision_id and a crash_datetime.

    We use sqlite3.Row as the row_factory so rows can be accessed like dicts
    (column name access rather than positional index).

    Args:
        sqlite_path: Path to the extracted SWITRS .sqlite file.
        start_year: First year to load (inclusive).
        end_year: Last year to load (inclusive).

    Returns:
        List of dicts with keys matching the Crash model column names.
    """
    results = []

    with sqlite3.connect(sqlite_path) as conn:
        conn.row_factory = sqlite3.Row  # enables dict-style column access

        for year in range(start_year, end_year + 1):
            logger.info("Reading SWITRS collisions for %d...", year)

            cursor = conn.execute(
                f"SELECT * FROM collisions WHERE collision_date LIKE '{year}-%'"
            )

            year_count = 0
            for raw_row in cursor:
                # Convert sqlite3.Row to plain dict for consistent handling
                row = dict(raw_row)
                transformed = transform_switrs(row)

                # Skip records we can't uniquely identify or timestamp
                if transformed["collision_id"] is None:
                    logger.debug("Skipping row with null collision_id (year %d)", year)
                    continue
                if transformed["crash_datetime"] is None:
                    logger.debug(
                        "Skipping collision_id %s with null crash_datetime",
                        transformed["collision_id"],
                    )
                    continue

                results.append(transformed)
                year_count += 1

            logger.info("Year %d: loaded %d records", year, year_count)

    logger.info(
        "Total SWITRS records loaded (%d–%d): %d",
        start_year, end_year, len(results),
    )
    return results
