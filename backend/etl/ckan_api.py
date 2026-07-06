"""CCRS CKAN API client.

Fetches California crash records from the CKAN DataStore Search API
(https://data.ca.gov). Data is split into yearly resource IDs.

The CKAN DataStore Search API returns JSON like:
    {
        "result": {
            "total": 150000,
            "records": [
                {"Collision Id": "12345", "Crash Date Time": "2022-01-01T00:00:00", ...},
                ...
            ]
        }
    }

We paginate using limit/offset until all records are fetched.
"""

import re
import time
import logging
from datetime import datetime

import httpx

logger = logging.getLogger(__name__)

CKAN_BASE_URL = "https://data.ca.gov/api/3/action/datastore_search"
CKAN_PACKAGE_SHOW_URL = "https://data.ca.gov/api/3/action/package_show"
# The CCRS dataset ("package") on data.ca.gov that contains every yearly
# Crashes_/Parties_/InjuredWitnessPassengers_ resource.
CCRS_PACKAGE_ID = "80c6a49d-c6b3-40ba-86d8-379c9741b4be"
PAGE_SIZE = 32000
MAX_RETRIES = 3
BACKOFF_BASE = 2  # seconds

# Each year of CCRS data has a separate CKAN resource ID.
# These IDs were sourced from data.ca.gov's CCRS dataset listing.
# They are the offline fallback — discover_resource_ids() below finds new
# calendar years automatically, so this map no longer needs a manual edit
# every January (the cause of the 2026-07-05 staleness incident's sequel:
# a 2027 that would never load while freshness reported green).
RESOURCE_IDS = {
    2016: "3d5f2586-cf68-4213-aa1c-60df37399d10",
    2017: "4784664d-b7cf-4427-af25-7c7307bad56c",
    2018: "a4b57216-5110-43d3-884c-d95366b19158",
    2019: "2b4c7d03-e684-435e-80da-17935de9499f",
    2020: "a2e0605d-0695-4bce-806d-4d0dda7ace68",
    2021: "d08692e2-6d36-487e-bca0-28cd127a626f",
    2022: "7828780b-117b-455e-9275-986ad3ffde50",
    2023: "436642c0-cd04-4a4c-b45e-564b66437476",
    2024: "f775df59-b89b-4f82-bd3d-8807fa3a22a0",
    2025: "9f4fc839-122d-4595-a146-43bc4ed16f46",
    2026: "b8ce0ca4-b4e9-490d-b4d1-1f4ec48cbefb",
}

# Successful discoveries, keyed by resource-name prefix. One package_show per
# prefix per process is plenty — the orchestrator and each loader run in their
# own process, and resources don't appear mid-run. Failures are NOT cached so
# a transient outage doesn't pin an empty result for the whole process.
_DISCOVERY_CACHE: dict[str, dict[int, str]] = {}


def discover_resource_ids(prefix: str) -> dict[int, str]:
    """Discover per-year CKAN resource ids by listing the CCRS package.

    CHP publishes one resource per calendar year named ``<prefix>_<year>``
    (e.g. ``Crashes_2026``, ``Parties_2026``). Listing the package finds new
    years the moment they're published, instead of waiting for someone to
    hand-edit RESOURCE_IDS each January.

    Returns {} on any failure — callers merge over the static maps, so a
    discovery outage degrades to exactly the old hardcoded behavior.
    """
    if prefix in _DISCOVERY_CACHE:
        return _DISCOVERY_CACHE[prefix]

    try:
        resp = httpx.get(
            CKAN_PACKAGE_SHOW_URL, params={"id": CCRS_PACKAGE_ID}, timeout=30.0
        )
        resp.raise_for_status()
        resources = resp.json()["result"]["resources"]
    except Exception as exc:
        logger.warning(
            "CCRS resource discovery failed (%s); falling back to static ids", exc
        )
        return {}

    pattern = re.compile(rf"{re.escape(prefix)}_(20\d\d)")
    found: dict[int, str] = {}
    for res in resources:
        match = pattern.fullmatch(str(res.get("name", "")).strip())
        # datastore_active=False means the resource exists but its DataStore
        # isn't loaded — datastore_search would 404, so don't offer it.
        if match and res.get("datastore_active") and res.get("id"):
            found[int(match.group(1))] = res["id"]

    logger.info("Discovered %d %s_* resources: %s", len(found), prefix, sorted(found))
    _DISCOVERY_CACHE[prefix] = found
    return found


def merged_resource_ids(prefix: str, static_ids: dict[int, str]) -> dict[int, str]:
    """The static year->resource map with freshly discovered years merged over it.

    Discovery wins on conflict (CHP occasionally re-creates a resource under a
    new id); the static map covers discovery outages and is never mutated.
    """
    return {**static_ids, **discover_resource_ids(prefix)}


def _safe_int(value):
    """Convert a CCRS string value to int. Returns None for nulls/empty/non-numeric.

    CCRS stores some numeric fields as TEXT (e.g. NumberKilled),
    so we must guard against empty strings and non-numeric values.
    """
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def _safe_count(value):
    """Like _safe_int but clamps to >= 0 for fields that are counts (killed, injured).

    Source data occasionally contains negative values (e.g. number_killed = -1)
    which are impossible and survive as-is through _safe_int. Clamp them here
    rather than propagating nonsensical negatives into aggregates.
    """
    n = _safe_int(value)
    if n is None:
        return None
    return max(0, n)


def _safe_float(value):
    """Convert a CCRS string value to float. Returns None for nulls/empty/non-numeric."""
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


def _safe_bool(value):
    """Convert CCRS boolean strings to Python bool. Returns None for empty/null.

    CCRS uses several boolean representations:
    - "True" / "False"  (string booleans)
    - "Y" / "N"         (yes/no codes)
    """
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return value
    normalized = str(value).strip().upper()
    if normalized in ("TRUE", "Y"):
        return True
    if normalized in ("FALSE", "N"):
        return False
    return None


def _map_hit_run(value):
    """Map CCRS HitRun field to a single-character code, or None.

    CCRS stores hit-and-run as full words like "MISDEMEANOR" or "FELONY".
    Our Crash model stores: "M" (misdemeanor), "F" (felony), or None (not hit-and-run).

    We map by first character so partial or variant values are handled gracefully.
    """
    if value is None or value == "":
        return None
    first = str(value).strip().upper()[:1]
    if first == "M":
        return "M"
    if first == "F":
        return "F"
    return None


def transform_ccrs(record: dict) -> dict:
    """Map a raw CCRS JSON record to the Crash model's column names.

    CCRS field names use inconsistent casing and spacing, so we explicitly
    map every field rather than relying on automatic name derivation.

    The "PedestrianActionCode" field is non-empty/non-zero when a pedestrian
    was involved — we convert that to a simple boolean.

    Returns a dict ready to be inserted into the crashes table.
    """
    ped_action = str(record.get("PedestrianActionCode") or "").strip().upper()
    pedestrian_involved = ped_action in ("B", "C", "D", "E", "F", "G")

    crash_datetime_raw = record.get("Crash Date Time")
    crash_datetime = None
    if crash_datetime_raw:
        try:
            # Newer years use ISO format: "2022-01-01T00:00:00"
            crash_datetime = datetime.fromisoformat(crash_datetime_raw)
        except ValueError:
            try:
                # Older years (2016-2017) use US format: "1/18/2017 8:20:00 PM"
                crash_datetime = datetime.strptime(crash_datetime_raw, "%m/%d/%Y %I:%M:%S %p")
            except ValueError:
                logger.debug("Unparseable datetime: %s", crash_datetime_raw)

    return {
        "collision_id": _safe_int(record.get("Collision Id")),
        "crash_datetime": crash_datetime,
        "day_of_week": record.get("DayofWeek"),
        "county_code": _safe_int(record.get("County Code")),
        "city_name": record.get("City Name"),
        "latitude": _safe_float(record.get("Latitude")),
        "longitude": _safe_float(record.get("Longitude")),
        "collision_type": record.get("Collision Type Description"),
        "primary_factor": record.get("Primary Collision Factor Violation"),
        "motor_vehicle_involved_with": record.get("MotorVehicleInvolvedWithDesc"),
        # NumberKilled is stored as TEXT in CCRS — must cast and clamp via _safe_count
        "number_killed": _safe_count(record.get("NumberKilled")),
        "number_injured": _safe_count(record.get("NumberInjured")),
        "weather": record.get("Weather 1"),
        "road_condition": record.get("Road Condition 1"),
        "lighting": record.get("LightingDescription"),
        "is_highway": _safe_bool(record.get("IsHighwayRelated")),
        "is_freeway": _safe_bool(record.get("IsFreeway")),
        "primary_road": record.get("PrimaryRoad"),
        "secondary_road": record.get("SecondaryRoad"),
        "hit_run": _map_hit_run(record.get("HitRun")),
        "pedestrian_involved": pedestrian_involved,
        "data_source": "ccrs",
    }


def fetch_crashes_for_year(year: int, resource_ids: dict[int, str] | None = None):
    """Yield batches of crash records for a given year from the CKAN DataStore API.

    Instead of loading an entire year into memory, this generator yields one
    page of transformed records at a time. Each page is PAGE_SIZE records
    from the CKAN API (~32K rows). The caller can upsert each batch
    immediately, keeping memory low and starting DB writes sooner.

    Each page request is retried up to MAX_RETRIES times with exponential
    backoff on HTTP errors.

    Records where collision_id is None after transform are skipped — these
    represent malformed source rows that can't be uniquely identified.

    Args:
        year: The crash year to fetch (must be in the resource map).
        resource_ids: year -> CKAN resource id map. Defaults to the static
            RESOURCE_IDS; the loader passes the discovery-merged map so newly
            published years work without a code change.

    Yields:
        tuple of (batch: list[dict], offset: int, total: int)
        - batch: list of transformed dicts ready for DB insert
        - offset: how many records fetched so far (for progress logging)
        - total: total records available for this year

    Raises:
        KeyError: If year is not in RESOURCE_IDS.
        httpx.HTTPStatusError / httpx.RequestError: If all retries fail.
    """
    if resource_ids is None:
        resource_ids = RESOURCE_IDS
    resource_id = resource_ids[year]  # KeyError if year not found — intentional

    logger.info("Fetching CCRS data for %d (resource_id=%s)", year, resource_id)

    offset = 0

    while True:
        params = {
            "resource_id": resource_id,
            "limit": PAGE_SIZE,
            "offset": offset,
        }

        # Retry with exponential backoff.
        # Government APIs can be flaky — this handles transient 5xx errors.
        last_error = None
        for attempt in range(MAX_RETRIES):
            try:
                resp = httpx.get(CKAN_BASE_URL, params=params, timeout=60.0)
                resp.raise_for_status()
                break
            except (httpx.HTTPStatusError, httpx.RequestError) as exc:
                last_error = exc
                if attempt < MAX_RETRIES - 1:
                    wait = BACKOFF_BASE ** (attempt + 1)
                    logger.warning(
                        "Attempt %d failed for year %d offset %d: %s. Retrying in %ds...",
                        attempt + 1, year, offset, exc, wait,
                    )
                    time.sleep(wait)
        else:
            # All retries exhausted — re-raise the last error
            logger.error(
                "All %d attempts failed for year %d offset %d",
                MAX_RETRIES, year, offset,
            )
            raise last_error

        data = resp.json()
        result = data["result"]
        total = result["total"]
        records = result["records"]

        batch = []
        for raw in records:
            transformed = transform_ccrs(raw)
            if transformed["collision_id"] is None:
                logger.debug("Skipping record with null collision_id at offset %d", offset)
                continue
            batch.append(transformed)

        offset += len(records)
        logger.info(
            "Year %d: fetched %d/%d records so far", year, offset, total
        )

        yield batch, offset, total

        # Stop when we've fetched all pages
        if offset >= total or len(records) == 0:
            break

    logger.info("Year %d: done fetching.", year)
