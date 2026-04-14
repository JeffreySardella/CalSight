"""Census Bureau ACS API client.

Fetches demographic data for all California counties for a given year.
Uses ACS 5-year estimates (2009+) or 1-year estimates (2005-2008).

The Census API returns JSON like:
    [
        ["B01003_001E", "B01002_001E", ..., "state", "county"],
        ["1000000",     "35.2",        ..., "06",    "001"],
        ...
    ]

First row = headers (variable codes), remaining rows = one per county.
Values are strings (or null for missing data).
"""

import time
import logging

import httpx

logger = logging.getLogger(__name__)

# Census variable codes mapped to readable names.
# "E" suffix = Estimate (as opposed to "M" = Margin of Error).
VARIABLES = {
    "B01003_001E": "population",       # Total population
    "B01002_001E": "median_age",       # Median age
    "B19013_001E": "median_income",    # Median household income ($)
    "B08006_003E": "commute_drive_alone",  # Workers who drove alone
    "B08006_004E": "commute_carpool",      # Workers who carpooled
    "B08006_008E": "commute_transit",      # Public transit riders
    "B08006_005E": "commute_walk",         # Walked to work
    "B08006_014E": "commute_bike",         # Bicycle commuters
    "B08006_017E": "commute_wfh",          # Worked from home
    "B08006_001E": "commute_total",        # Total workers (denominator)
}

VARIABLE_CODES = ",".join(VARIABLES.keys())

MAX_RETRIES = 3
BACKOFF_BASE = 2  # seconds


def _safe_int(value):
    """Convert a Census string value to int. Returns None for nulls.

    The Census API returns numbers as strings ("1000000") or null.
    """
    if value is None or value == "":
        return None
    return int(value)


def _safe_float(value):
    """Convert a Census string value to float. Returns None for nulls."""
    if value is None or value == "":
        return None
    return float(value)


def _commute_pct(count, total):
    """Calculate commute mode percentage from raw count and total.

    Example: 500,000 drove alone out of 800,000 total workers = 62.5%
    """
    if count is None or total is None or total == 0:
        return None
    return round(count / total * 100, 2)


def fetch_county_demographics(year: int, api_key: str) -> list[dict]:
    """Fetch demographic data for all CA counties for a given year.

    Picks the right ACS dataset:
    - 2010+: ACS 5-year (covers all counties, most reliable)
    - 2005-2009: ACS 1-year (only covers counties with 65k+ population)

    Returns a list of dicts with keys matching the Demographic model,
    plus 'county_fips' (3-digit FIPS code like "001" for Alameda).
    """
    dataset = "acs5" if year >= 2010 else "acs1"
    url = (
        f"https://api.census.gov/data/{year}/acs/{dataset}"
        f"?get={VARIABLE_CODES}"
        f"&for=county:*&in=state:06"
        f"&key={api_key}"
    )

    logger.info("Fetching ACS %s data for %d", dataset, year)

    # Retry with exponential backoff.
    # Government APIs can be flaky — this handles transient failures.
    last_error = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = httpx.get(url, timeout=30.0)
            resp.raise_for_status()
            break
        except (httpx.HTTPStatusError, httpx.RequestError) as exc:
            last_error = exc
            if attempt < MAX_RETRIES - 1:
                wait = BACKOFF_BASE ** (attempt + 1)
                logger.warning(
                    "Attempt %d failed for year %d: %s. Retrying in %ds...",
                    attempt + 1, year, exc, wait,
                )
                time.sleep(wait)
    else:
        # This runs if the for-loop finished without "break" —
        # meaning all retries failed.
        logger.error("All %d attempts failed for year %d", MAX_RETRIES, year)
        raise last_error

    # Parse the JSON response.
    # Row 0 = headers, rows 1+ = county data.
    data = resp.json()
    header = data[0]
    rows = data[1:]

    results = []
    for row in rows:
        # zip(header, row) pairs each header with its value:
        # {"B01003_001E": "1000000", "county": "001", ...}
        record = dict(zip(header, row))

        # Convert string values to proper Python types
        population = _safe_int(record.get("B01003_001E"))
        median_age = _safe_float(record.get("B01002_001E"))
        median_income = _safe_int(record.get("B19013_001E"))

        # Commute: Census gives raw counts, we convert to percentages
        commute_total = _safe_int(record.get("B08006_001E"))
        drive_alone = _safe_int(record.get("B08006_003E"))
        carpool = _safe_int(record.get("B08006_004E"))
        transit = _safe_int(record.get("B08006_008E"))
        walk = _safe_int(record.get("B08006_005E"))
        bike = _safe_int(record.get("B08006_014E"))
        wfh = _safe_int(record.get("B08006_017E"))

        results.append({
            "county_fips": record["county"],
            "population": population,
            "median_age": median_age,
            "median_income": median_income,
            "commute_drive_alone_pct": _commute_pct(drive_alone, commute_total),
            "commute_carpool_pct": _commute_pct(carpool, commute_total),
            "commute_transit_pct": _commute_pct(transit, commute_total),
            "commute_walk_pct": _commute_pct(walk, commute_total),
            "commute_bike_pct": _commute_pct(bike, commute_total),
            "commute_wfh_pct": _commute_pct(wfh, commute_total),
        })

    logger.info("Fetched %d county rows for %d", len(results), year)
    return results
