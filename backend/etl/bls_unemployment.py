"""Pull monthly unemployment rates per county from the BLS.

The Bureau of Labor Statistics has a free API that gives you unemployment
for every US county going back to the 90s. We grab all 58 California
counties. The series ID format is kind of weird — it's a 20-character
code with the county FIPS baked in.

You need a free API key from https://www.bls.gov/developers/ — lets you
pull 50 counties at once and up to 20 years per request. Without a key
you're limited to 25 requests a day which isn't enough.

Usage:
    python -m etl.bls_unemployment
    python -m etl.bls_unemployment --start 2020 --end 2025
"""

import argparse
import logging
import sys
import time

from sqlalchemy import select

from app.database import SessionLocal
from app.models import County, UnemploymentRate
from app.settings import settings
from etl._utils import post_with_retry, track_etl_run

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

BLS_API_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/"
BATCH_SIZE = 50  # BLS allows up to 50 series per request
MAX_YEARS_PER_REQUEST = 20  # with API key
DEFAULT_START_YEAR = 2005
DEFAULT_END_YEAR = 2025


def build_series_id(fips: str) -> str:
    """Turn a 5-digit county FIPS code into a BLS series ID.

    The format is LAUCN{FIPS}0000000003 — always 20 characters.
    The "03" at the end means "unemployment rate" specifically.
    Other codes like 04 give you the raw count of unemployed people,
    but we just want the percentage.

    Example: Alameda County (FIPS 06001) -> LAUCN060010000000003
    """
    return f"LAUCN{fips}0000000003"


def fetch_batch(series_ids: list[str], start_year: int, end_year: int, api_key: str) -> dict:
    """Hit the BLS API for a batch of county series and parse the response.

    The BLS API is a POST endpoint that takes a JSON body with the series
    IDs and year range. It returns monthly data points for each series.

    One quirk: the response includes "M13" which is the annual average.
    We skip that and only keep M01-M12 (the actual months).

    Returns a dict like:
        {"LAUCN060010000000003": [
            {"year": 2022, "month": 12, "unemployment_rate": 3.5},
            {"year": 2022, "month": 11, "unemployment_rate": 3.8},
        ]}
    """
    payload = {
        "seriesid": series_ids,
        "startyear": str(start_year),
        "endyear": str(end_year),
        "registrationkey": api_key,
    }

    resp = post_with_retry(BLS_API_URL, json=payload, timeout=60.0)
    data = resp.json()

    if data.get("status") != "REQUEST_SUCCEEDED":
        messages = data.get("message", [])
        logger.error("BLS API error: %s", messages)
        return {}

    results = {}
    for series in data.get("Results", {}).get("series", []):
        sid = series["seriesID"]
        rows = []
        for point in series.get("data", []):
            period = point.get("period", "")
            # Skip annual averages (M13) — we only want monthly
            if not period.startswith("M") or period == "M13":
                continue
            month = int(period[1:])
            value = point.get("value")
            try:
                rate = float(value)
            except (TypeError, ValueError):
                continue
            rows.append({
                "year": int(point["year"]),
                "month": month,
                "unemployment_rate": rate,
            })
        results[sid] = rows

    return results


@track_etl_run("unemployment")
def run(start_year: int = DEFAULT_START_YEAR, end_year: int = DEFAULT_END_YEAR):
    """Pull unemployment for all 58 counties and load into Postgres.

    We have 58 counties but the BLS only lets you request 50 series at
    a time, so we split into 2 batches (50 + 8). Also capped at 20 years
    per request, so 2005-2025 takes two rounds (2005-2024, then 2025).

    Each batch comes back with monthly data points that we upsert into
    the unemployment_rates table. Safe to re-run — existing rows get
    updated, new ones get inserted.
    """
    api_key = settings.bls_api_key
    if not api_key:
        logger.error("BLS_API_KEY is not set. Register free at https://www.bls.gov/developers/")
        sys.exit(1)

    db = SessionLocal()
    try:
        # Load county FIPS codes
        counties = db.execute(select(County.code, County.fips)).all()
        fips_to_code = {}
        series_to_code = {}
        series_ids = []

        for code, fips in counties:
            if fips is None:
                continue
            sid = build_series_id(fips)
            series_ids.append(sid)
            series_to_code[sid] = code
            fips_to_code[fips] = code

        logger.info("Built %d series IDs for CA counties", len(series_ids))

        # Split into batches of 50 (BLS limit)
        total_inserted = 0
        total_updated = 0

        # Also split by year ranges if needed (max 20 years per request)
        for yr_start in range(start_year, end_year + 1, MAX_YEARS_PER_REQUEST):
            yr_end = min(yr_start + MAX_YEARS_PER_REQUEST - 1, end_year)

            for i in range(0, len(series_ids), BATCH_SIZE):
                batch = series_ids[i:i + BATCH_SIZE]
                logger.info(
                    "Fetching %d series for %d-%d (batch %d/%d)",
                    len(batch), yr_start, yr_end,
                    i // BATCH_SIZE + 1,
                    (len(series_ids) + BATCH_SIZE - 1) // BATCH_SIZE,
                )

                try:
                    results = fetch_batch(batch, yr_start, yr_end, api_key)
                except Exception as exc:
                    logger.error("Batch failed: %s", exc)
                    continue

                for sid, rows in results.items():
                    county_code = series_to_code.get(sid)
                    if county_code is None:
                        continue

                    for row in rows:
                        existing = db.query(UnemploymentRate).filter_by(
                            county_code=county_code,
                            year=row["year"],
                            month=row["month"],
                        ).first()

                        if existing:
                            existing.unemployment_rate = row["unemployment_rate"]
                            total_updated += 1
                        else:
                            db.add(UnemploymentRate(
                                county_code=county_code,
                                year=row["year"],
                                month=row["month"],
                                unemployment_rate=row["unemployment_rate"],
                            ))
                            total_inserted += 1

                db.commit()

                # Be nice to BLS API
                time.sleep(0.5)

        logger.info(
            "Done. %d inserted, %d updated",
            total_inserted, total_updated,
        )
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Load unemployment rates from BLS LAUS API"
    )
    parser.add_argument(
        "--start", type=int, default=DEFAULT_START_YEAR,
        help=f"Start year (default: {DEFAULT_START_YEAR})",
    )
    parser.add_argument(
        "--end", type=int, default=DEFAULT_END_YEAR,
        help=f"End year (default: {DEFAULT_END_YEAR})",
    )
    args = parser.parse_args()
    run(start_year=args.start, end_year=args.end)
