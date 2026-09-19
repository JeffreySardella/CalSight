"""Assign crashes with coordinates to census tracts, aggregated per year.

There is no PostGIS on this server, so the point-in-polygon join happens in
Python: geopandas `sjoin` of the crash lat/lng against the Census
cartographic tract boundaries (2020 vintage, which is what CalEnviroScreen
5.0 is scored on). Only the ~9,100 x N-year aggregate is stored, in
`tract_crash_year` — no per-crash column, no 11.6M-row backfill.

IMPORTANT: only about 37% of crashes carry coordinates, so this table covers
only that subset. Every surface built on it has to say so.

The boundary file is downloaded to a temp directory and deleted afterwards
(~4.5 MB zipped); it is not committed. The frontend's tract TopoJSON comes
from the same file via etl.build_tract_topojson.

Source: https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_06_tract_500k.zip

Usage:
    python -m etl.compute_tract_crashes                  # trailing 2 years
    python -m etl.compute_tract_crashes --start 2001     # full first load
"""

from __future__ import annotations

import argparse
import logging
import tempfile
from contextlib import contextmanager
from datetime import date
from pathlib import Path

import pandas as pd
from sqlalchemy import text

from app.database import EtlSessionLocal as SessionLocal, etl_engine
from app.models import TractCrashYear
from etl._utils import get_with_retry, track_etl_run

logger = logging.getLogger(__name__)

TRACT_SHAPEFILE_URL = (
    "https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_06_tract_500k.zip"
)

# Trailing window for the scheduled run. Crash years only gain rows for a
# while after the year ends (CCRS keeps trickling), so re-do the last two.
DEFAULT_TRAILING_YEARS = 2
EARLIEST_YEAR = 2001


@contextmanager
def tract_boundaries():
    """Yield the CA tract polygons as a GeoDataFrame [geoid, geometry].

    Downloads the Census boundary zip into a temp directory that is removed
    on exit. geopandas is imported lazily so the rest of the ETL (and the
    API) doesn't pay for it at import time.
    """
    import geopandas as gpd

    with tempfile.TemporaryDirectory(prefix="calsight-tracts-") as tmp:
        zip_path = Path(tmp) / "cb_2020_06_tract_500k.zip"
        logger.info("Downloading %s", TRACT_SHAPEFILE_URL)
        resp = get_with_retry(TRACT_SHAPEFILE_URL, timeout=180.0, follow_redirects=True)
        zip_path.write_bytes(resp.content)
        logger.info("Boundary zip: %.1f MB", len(resp.content) / 1e6)

        # /vsizip/ is GDAL's zip reader — no need to unpack the shapefile's
        # five sidecar files ourselves.
        gdf = gpd.read_file(f"/vsizip/{zip_path}")
        gdf = gdf[["GEOID", "geometry"]].rename(columns={"GEOID": "geoid"})
        # Census cartographic files are NAD83; crash lat/lng is WGS84. The
        # two differ by ~1m in CA, but reprojecting is one line and keeps
        # sjoin from warning about mismatched CRS.
        gdf = gdf.to_crs("EPSG:4326")
        logger.info("Loaded %d tract polygons", len(gdf))
        yield gdf


def aggregate_crashes_to_tracts(crashes: pd.DataFrame, tracts) -> pd.DataFrame:
    """Point-in-polygon join, then sum per (geoid, year).

    `crashes` needs columns: latitude, longitude, crash_year, number_killed,
    number_injured. `tracts` is a GeoDataFrame with [geoid, geometry].

    Returns a DataFrame [geoid, year, crash_count, killed, injured]. Crashes
    that fall outside every CA tract (bad coordinates, or out of state) are
    dropped — that is the point of the join, not an error.
    """
    import geopandas as gpd

    empty = pd.DataFrame(
        columns=["geoid", "year", "crash_count", "killed", "injured"]
    )
    if crashes.empty:
        return empty

    points = gpd.GeoDataFrame(
        crashes,
        geometry=gpd.points_from_xy(crashes["longitude"], crashes["latitude"]),
        crs="EPSG:4326",
    )
    joined = points.sjoin(tracts, how="inner", predicate="within")
    if joined.empty:
        return empty

    out = (
        joined.groupby(["geoid", "crash_year"])
        .agg(
            crash_count=("crash_year", "size"),
            killed=("number_killed", "sum"),
            injured=("number_injured", "sum"),
        )
        .reset_index()
        .rename(columns={"crash_year": "year"})
    )
    for col in ("crash_count", "killed", "injured"):
        out[col] = out[col].fillna(0).astype(int)
    out["year"] = out["year"].astype(int)
    return out[["geoid", "year", "crash_count", "killed", "injured"]]


def fetch_crash_points(year: int) -> pd.DataFrame:
    """Coordinate-bearing crashes for one year, as a DataFrame."""
    sql = text(
        "SELECT latitude, longitude, crash_year, "
        "       COALESCE(number_killed, 0) AS number_killed, "
        "       COALESCE(number_injured, 0) AS number_injured "
        "FROM crashes "
        "WHERE crash_year = :year "
        "  AND latitude IS NOT NULL AND longitude IS NOT NULL"
    )
    with etl_engine.connect() as conn:
        return pd.read_sql(sql, conn, params={"year": year})


@track_etl_run("tract_crashes")
def run(start_year: int | None = None, end_year: int | None = None) -> int:
    """Rebuild `tract_crash_year` for [start_year, end_year]."""
    end_year = end_year or date.today().year
    start_year = start_year or (end_year - DEFAULT_TRAILING_YEARS + 1)
    if start_year > end_year:
        raise ValueError(f"--start {start_year} is after --end {end_year}")

    db = SessionLocal()
    total = 0
    try:
        with tract_boundaries() as tracts:
            for year in range(max(start_year, EARLIEST_YEAR), end_year + 1):
                crashes = fetch_crash_points(year)
                logger.info("Year %d: %d crashes with coordinates", year, len(crashes))
                rows = aggregate_crashes_to_tracts(crashes, tracts)

                # Delete-then-insert rather than upsert: a re-run of the
                # window has to be able to LOWER a tract's count (a crash
                # re-geocoded into its neighbour), and an upsert can only
                # raise it. One transaction per year, so a reader never sees
                # the year missing.
                db.execute(
                    text("DELETE FROM tract_crash_year WHERE year = :year"),
                    {"year": year},
                )
                if not rows.empty:
                    db.bulk_insert_mappings(
                        TractCrashYear, rows.to_dict(orient="records")
                    )
                db.commit()
                total += len(rows)
                logger.info("Year %d: %d tract rows written", year, len(rows))

        logger.info("Done. %d tract-year rows across %d-%d",
                    total, start_year, end_year)
        return total
    finally:
        db.close()


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
        datefmt="%H:%M:%S",
    )
    parser = argparse.ArgumentParser(
        description="Aggregate coordinate-bearing crashes into census tracts"
    )
    parser.add_argument("--start", type=int, default=None)
    parser.add_argument("--end", type=int, default=None)
    args = parser.parse_args()
    run(start_year=args.start, end_year=args.end)
