"""NHTSA FARS ETL — fatal-crash aggregates per California county per year.

Downloads the yearly FARS National CSV bundle, reads accident/person tables,
filters to California (STATE=6), and upserts per-county fatality + restraint
counts into fars_county_year. The frontend derives pct_unrestrained.

Source: NHTSA FARS  https://static.nhtsa.gov/nhtsa/downloads/FARS/

Usage:
    python -m etl.nhtsa_fars
    python -m etl.nhtsa_fars --start 2018 --end 2022
"""

import argparse
import csv
import io
import logging
import zipfile
from collections import defaultdict

import httpx
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.database import EtlSessionLocal as SessionLocal
from app.models import County, FarsCountyYear
from etl._utils import track_etl_run

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

DEFAULT_START_YEAR = 2001
DEFAULT_END_YEAR = 2025
CA_STATE_FIPS = "6"

# REST_USE classification (best-effort, FARS codes drift across years).
UNRESTRAINED_CODES = {"0"}
UNKNOWN_RESTRAINT_CODES = {"8", "9", "96", "97", "98", "99", ""}

FARS_ZIP_URL = (
    "https://static.nhtsa.gov/nhtsa/downloads/FARS/"
    "{year}/National/FARS{year}NationalCSV.zip"
)
MAX_RETRIES = 3
BACKOFF_BASE = 2


def build_county_lookup(counties: list[tuple[int, str | None]]) -> dict[int, int]:
    """Map 3-digit within-state FIPS -> county_code from (code, fips) pairs."""
    lookup: dict[int, int] = {}
    for code, fips in counties:
        if not fips or len(fips) < 3:
            continue
        lookup[int(fips[-3:])] = code
    return lookup


def aggregate_fars(
    person_rows: list[dict], county_lookup: dict[int, int], year: int
) -> list[dict]:
    """Aggregate FARS person rows to per-county fatality + restraint counts."""
    tally: dict[int, dict[str, int]] = defaultdict(
        lambda: {"fatalities": 0, "unrestrained_killed": 0, "restraint_known_killed": 0}
    )
    for r in person_rows:
        if str(r.get("STATE")) != CA_STATE_FIPS:
            continue
        if str(r.get("INJ_SEV")) != "4":  # 4 == Fatal Injury (killed)
            continue
        try:
            county = int(r.get("COUNTY"))
        except (TypeError, ValueError):
            continue
        code = county_lookup.get(county)
        if code is None:
            continue
        rest = str(r.get("REST_USE", "")).strip()
        t = tally[code]
        t["fatalities"] += 1
        if rest not in UNKNOWN_RESTRAINT_CODES:
            t["restraint_known_killed"] += 1
        if rest in UNRESTRAINED_CODES:
            t["unrestrained_killed"] += 1

    return [
        {"county_code": code, "year": year, **counts}
        for code, counts in sorted(tally.items())
    ]
