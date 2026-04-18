"""NOAA Weather ETL — monthly temperature and precipitation per county.

Fetches monthly weather summaries from the NOAA Climate Data Online API
(GSOM dataset), averages across all stations per county, and upserts
into the weather table.

NOAA API rate limits: 5 requests/second, 10,000 requests/day.
We query one county per request, one year at a time, with a delay
between requests to stay well within limits.

Source: NOAA NCEI Climate Data Online
API docs: https://www.ncdc.noaa.gov/cdo-web/webservices/v2

Usage:
    python -m etl.noaa_weather
    python -m etl.noaa_weather --start 2020 --end 2023
"""

import argparse
import logging
import time
from collections import defaultdict

import httpx
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.database import SessionLocal
from app.models import County, Weather
from app.settings import settings
from etl._utils import track_etl_run

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

NOAA_BASE_URL = "https://www.ncei.noaa.gov/cdo-web/api/v2/data"
MAX_RETRIES = 3
BACKOFF_BASE = 2
REQUEST_DELAY = 0.3  # seconds between requests (stay under 5/sec)

DEFAULT_START_YEAR = 2001
DEFAULT_END_YEAR = 2025


def fetch_county_weather(
    fips: str, year: int, token: str
) -> list[dict]:
    """Fetch monthly weather data for one county and one year.

    Queries NOAA GSOM dataset for TAVG, TMAX, TMIN, PRCP.
    Returns raw result records from the API.

    Args:
        fips: 5-digit county FIPS code (e.g. "06001" for Alameda).
        year: Year to fetch.
        token: NOAA CDO API token.
    """
    headers = {"token": token}
    all_results = []
    offset = 1  # NOAA uses 1-based offset

    while True:
        params = {
            "datasetid": "GSOM",
            "locationid": f"FIPS:{fips}",
            "startdate": f"{year}-01-01",
            "enddate": f"{year}-12-31",
            "datatypeid": "TAVG,TMAX,TMIN,PRCP",
            "units": "standard",
            "limit": 1000,
            "offset": offset,
        }

        last_error = None
        for attempt in range(MAX_RETRIES):
            try:
                resp = httpx.get(
                    NOAA_BASE_URL, headers=headers, params=params, timeout=30
                )
                resp.raise_for_status()
                break
            except (httpx.HTTPStatusError, httpx.RequestError) as exc:
                last_error = exc
                if attempt < MAX_RETRIES - 1:
                    wait = BACKOFF_BASE ** (attempt + 1)
                    logger.warning(
                        "Attempt %d failed for %s/%d: %s. Retrying in %ds...",
                        attempt + 1, fips, year, exc, wait,
                    )
                    time.sleep(wait)
        else:
            logger.error("All retries failed for %s/%d", fips, year)
            raise last_error

        data = resp.json()
        results = data.get("results", [])
        if not results:
            break

        all_results.extend(results)

        metadata = data.get("metadata", {}).get("resultset", {})
        total = metadata.get("count", 0)
        if offset + len(results) - 1 >= total:
            break
        offset += len(results)

        time.sleep(REQUEST_DELAY)

    return all_results


def aggregate_to_monthly(records: list[dict]) -> list[dict]:
    """Aggregate station-level records to county monthly averages.

    Multiple stations report per county per month. We average across
    stations for temperature fields and sum (then average) for precipitation.

    Returns list of dicts with keys: month, avg_temp_f, max_temp_f,
    min_temp_f, precipitation_in.
    """
    # Group by month and datatype
    monthly: dict[int, dict[str, list[float]]] = defaultdict(
        lambda: defaultdict(list)
    )

    for r in records:
        month = int(r["date"][5:7])
        datatype = r["datatype"]
        value = r.get("value")
        if value is not None:
            monthly[month][datatype].append(float(value))

    results = []
    for month in sorted(monthly.keys()):
        data = monthly[month]
        tavg = data.get("TAVG", [])
        tmax = data.get("TMAX", [])
        tmin = data.get("TMIN", [])
        prcp = data.get("PRCP", [])

        results.append({
            "month": month,
            "avg_temp_f": round(sum(tavg) / len(tavg), 1) if tavg else None,
            "max_temp_f": round(sum(tmax) / len(tmax), 1) if tmax else None,
            "min_temp_f": round(sum(tmin) / len(tmin), 1) if tmin else None,
            "precipitation_in": round(sum(prcp) / len(prcp), 2) if prcp else None,
        })

    return results


@track_etl_run("weather")
def run(start_year: int = DEFAULT_START_YEAR, end_year: int = DEFAULT_END_YEAR):
    """Main entry point: fetch weather for all counties and years."""
    token = settings.noaa_api_token
    if not token:
        logger.error("NOAA_API_TOKEN is not set. Add it to backend/.env")
        return

    db = SessionLocal()

    try:
        # Load counties with FIPS codes
        counties = db.query(County.code, County.fips, County.name).all()
        logger.info("Loaded %d counties", len(counties))

        total_rows = 0

        for year in range(start_year, end_year + 1):
            year_rows = 0

            for county_code, fips, county_name in counties:
                if not fips:
                    continue

                try:
                    records = fetch_county_weather(fips, year, token)
                    time.sleep(REQUEST_DELAY)

                    if not records:
                        continue

                    monthly = aggregate_to_monthly(records)

                    rows = [
                        {
                            "county_code": county_code,
                            "year": year,
                            **m,
                        }
                        for m in monthly
                    ]

                    if rows:
                        stmt = pg_insert(Weather).values(rows)
                        stmt = stmt.on_conflict_do_update(
                            constraint="weather_county_code_year_month_key",
                            set_={
                                "avg_temp_f": stmt.excluded.avg_temp_f,
                                "max_temp_f": stmt.excluded.max_temp_f,
                                "min_temp_f": stmt.excluded.min_temp_f,
                                "precipitation_in": stmt.excluded.precipitation_in,
                            },
                        )
                        db.execute(stmt)
                        db.commit()
                        year_rows += len(rows)

                except Exception as exc:
                    logger.warning(
                        "Failed for %s (%s) year %d: %s",
                        county_name, fips, year, exc,
                    )
                    db.rollback()

            total_rows += year_rows
            logger.info("Year %d: %d monthly records upserted", year, year_rows)

        logger.info("Done. %d total weather records upserted.", total_rows)

    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Load NOAA monthly weather data into Postgres"
    )
    parser.add_argument("--start", type=int, default=DEFAULT_START_YEAR)
    parser.add_argument("--end", type=int, default=DEFAULT_END_YEAR)
    args = parser.parse_args()
    run(start_year=args.start, end_year=args.end)
