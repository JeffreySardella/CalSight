"""Census lived-density ETL — population-weighted density per CA county/year.

Joins ACS 5-year tract populations to Census Gazetteer tract land areas and
computes weighted_density = sum(pop^2/area) / sum(pop) per county. Distinct
from the crude demographics.population_density.

Sources:
  - ACS5 B01003_001E (tract population), Census API (settings.census_api_key)
  - Census Gazetteer national tract file (ALAND_SQMI)

Usage:
    python -m etl.census_tract_density
    python -m etl.census_tract_density --start 2018 --end 2022
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
from app.models import County, TractDensityCountyYear
from app.settings import settings
from etl._utils import track_etl_run
from etl.nhtsa_fars import build_county_lookup

logger = logging.getLogger(__name__)

DEFAULT_START_YEAR = 2010
DEFAULT_END_YEAR = 2023
CA_STATE_FIPS = "06"

GAZETTEER_URL = (
    "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/"
    "{gaz_year}_Gazetteer/{gaz_year}_Gaz_tracts_national.zip"
)
ACS_URL = (
    "https://api.census.gov/data/{year}/acs/acs5"
    "?get=B01003_001E&for=tract:*&in=state:06&in=county:*&key={key}"
)
MAX_RETRIES = 3
BACKOFF_BASE = 2


def gazetteer_year_for(acs_year: int) -> int:
    """Pair an ACS year with a same-tract-vintage Gazetteer year."""
    return 2019 if acs_year <= 2019 else 2023


def compute_weighted_density(tracts: list[dict]) -> tuple[float, int] | None:
    """Population-weighted density = sum(pop^2/area) / sum(pop).

    Excludes tracts with missing/non-positive pop or area. Returns
    (weighted_density, tract_count) or None when nothing contributes.
    """
    sum_pop = 0.0
    sum_term = 0.0
    count = 0
    for t in tracts:
        pop = t.get("pop")
        area = t.get("area_sqmi")
        if pop is None or area is None or pop <= 0 or area <= 0:
            continue
        sum_pop += pop
        sum_term += (pop * pop) / area
        count += 1
    if count == 0 or sum_pop <= 0:
        return None
    return (sum_term / sum_pop, count)


def aggregate_county_density(
    tract_rows: list[dict],
    gaz_land_by_geoid: dict[str, float],
    county_lookup: dict[int, int],
    year: int,
) -> list[dict]:
    """Join tract pop to gazetteer land by GEOID, group by county, compute."""
    by_county: dict[int, list[dict]] = defaultdict(list)
    for r in tract_rows:
        geoid = r.get("geoid", "")
        try:
            county_fips = int(geoid[2:5])
        except (ValueError, IndexError):
            continue
        code = county_lookup.get(county_fips)
        if code is None:
            continue
        area = gaz_land_by_geoid.get(geoid)
        if area is None:
            continue
        by_county[code].append({"pop": r.get("pop"), "area_sqmi": area})

    out: list[dict] = []
    for code, tracts in sorted(by_county.items()):
        res = compute_weighted_density(tracts)
        if res is None:
            continue
        wd, tc = res
        out.append({
            "county_code": code, "year": year,
            "weighted_density": wd, "tract_count": tc,
        })
    return out
