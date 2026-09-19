"""Assign crashes with coordinates to census tracts, aggregated per year.

There is no PostGIS on this server, so the point-in-polygon join happens in
Python — but it needs no new dependency: `shapely` is already pinned, and
`shapely.STRtree.query(..., predicate="within")` *is* a vectorised spatial
join. One `tree.query` call handles a whole year of crashes in a couple of
seconds against ~9,100 tract polygons.

Only the ~9,100 x N-year aggregate is stored, in `tract_crash_year` — no
per-crash column, no 11.6M-row backfill.

IMPORTANT: only about 37% of crashes carry coordinates, so this table covers
only that subset. Every surface built on it has to say so.

Boundaries come from the Census TIGERweb REST service as GeoJSON, paged the
same way etl/load_calenviroscreen.py and etl/census_tract_density.py page
their ArcGIS sources. Layer 6 of tigerWMS_Census2020 is "Census Tracts;
2020 Census - January 1, 2020 vintage" — the vintage CalEnviroScreen 5.0 is
scored on, which is what makes the GEOID join valid. `f=geojson` output is
already WGS84, so the crash lat/lng needs no reprojection.

Nothing is written to disk: the boundaries are fetched into memory and
dropped when the run ends. The frontend's tract TopoJSON comes from the same
service via etl.build_tract_topojson.

Usage:
    python -m etl.compute_tract_crashes                  # trailing 2 years
    python -m etl.compute_tract_crashes --start 2001     # full first load
"""

from __future__ import annotations

import argparse
import logging
from dataclasses import dataclass
from datetime import date
from typing import NamedTuple, Sequence

import shapely
from shapely.geometry import shape
from sqlalchemy import text

from app.database import EtlSessionLocal as SessionLocal, etl_engine
from app.models import TractCrashYear
from etl._utils import get_with_retry, track_etl_run

logger = logging.getLogger(__name__)

TIGERWEB_TRACTS_URL = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb"
    "/tigerWMS_Census2020/MapServer/6/query"
)
CA_STATE_FIPS = "06"
PAGE_SIZE = 1000

# Degrees of boundary generalisation asked of the service. ~0.0001 deg is
# ~11 m at California latitudes, which pulls the payload from ~48 MB to ~7 MB
# while staying an order of magnitude finer than anything that could move a
# crash into the wrong tract. Set to 0 for the ungeneralised geometry.
GENERALIZE_DEGREES = 0.0001

# Trailing window for the scheduled run. Crash years keep gaining rows for a
# while after the year ends (CCRS trickles in), so re-do the last two.
DEFAULT_TRAILING_YEARS = 2
EARLIEST_YEAR = 2001


class CrashPoint(NamedTuple):
    """One coordinate-bearing crash, as the join needs it."""

    latitude: float
    longitude: float
    crash_year: int
    number_killed: int
    number_injured: int


@dataclass(frozen=True)
class TractIndex:
    """Tract GEOIDs and an STRtree over their polygons, positionally aligned."""

    geoids: list[str]
    tree: shapely.STRtree


def fetch_tract_features(
    generalize: float = GENERALIZE_DEGREES, page_size: int = PAGE_SIZE
) -> list[dict]:
    """Page the TIGERweb tract layer for California and return GeoJSON features.

    Each feature carries a single `GEOID` property. The service caps a page
    and flags `exceededTransferLimit` when there is more, same contract as
    the CalEnviroScreen loader's resultOffset paging.
    """
    features: list[dict] = []
    offset = 0
    while True:
        params = {
            "where": f"STATE='{CA_STATE_FIPS}'",
            "outFields": "GEOID",
            "returnGeometry": "true",
            "f": "geojson",
            "geometryPrecision": "6",
            "resultOffset": str(offset),
            "resultRecordCount": str(page_size),
        }
        if generalize:
            params["maxAllowableOffset"] = str(generalize)
        logger.info("Fetching CA tract boundaries (offset=%d)", offset)
        resp = get_with_retry(
            TIGERWEB_TRACTS_URL, params=params, timeout=180.0, follow_redirects=True
        )
        body = resp.json()
        page = body.get("features") or []
        if not page:
            break
        features.extend(page)
        offset += len(page)
        if not body.get("exceededTransferLimit"):
            break

    logger.info("Fetched %d tract polygons", len(features))
    if not features:
        # A silent empty result would zero out every tract for the window.
        raise RuntimeError(f"TIGERweb returned no CA tracts ({TIGERWEB_TRACTS_URL})")
    return features


def build_tract_index(features: Sequence[dict]) -> TractIndex:
    """Turn GeoJSON tract features into a queryable STRtree."""
    geoids: list[str] = []
    geoms: list = []
    for feature in features:
        geoid = (feature.get("properties") or {}).get("GEOID")
        geometry = feature.get("geometry")
        if not geoid or not geometry:
            continue
        geoids.append(str(geoid))
        geoms.append(shape(geometry))
    return TractIndex(geoids=geoids, tree=shapely.STRtree(geoms))


def aggregate_crashes_to_tracts(
    crashes: Sequence[CrashPoint], index: TractIndex
) -> list[dict]:
    """Point-in-polygon join, then sum per (geoid, year).

    Returns [{geoid, year, crash_count, killed, injured}], sorted.

    Two kinds of crash are dropped, both deliberately:

    - one whose coordinate falls outside every CA tract (bad coordinates, or
      genuinely out of state) — that is the point of the join;
    - one that lands exactly ON a shared tract boundary. `predicate="within"`
      is interior-only, so a boundary point matches nothing. That is the safe
      direction (an "intersects" join would count it in both neighbours), and
      at the 5-decimal precision crash coordinates carry it is vanishingly
      rare.

    A point matching more than one tract — possible where the service's
    generalised boundaries overlap by a hair — is counted once, against the
    first match.
    """
    if not crashes:
        return []

    points = shapely.points(
        [c.longitude for c in crashes], [c.latitude for c in crashes]
    )
    point_idx, tract_idx = index.tree.query(points, predicate="within")

    totals: dict[tuple[str, int], list[int]] = {}
    claimed: set[int] = set()
    for pi, ti in zip(point_idx.tolist(), tract_idx.tolist()):
        if pi in claimed:
            continue
        claimed.add(pi)
        crash = crashes[pi]
        entry = totals.setdefault((index.geoids[ti], int(crash.crash_year)), [0, 0, 0])
        entry[0] += 1
        entry[1] += int(crash.number_killed or 0)
        entry[2] += int(crash.number_injured or 0)

    return [
        {
            "geoid": geoid,
            "year": year,
            "crash_count": count,
            "killed": killed,
            "injured": injured,
        }
        for (geoid, year), (count, killed, injured) in sorted(totals.items())
    ]


def fetch_crash_points(year: int) -> list[CrashPoint]:
    """Coordinate-bearing crashes for one year."""
    sql = text(
        "SELECT latitude, longitude, crash_year, "
        "       COALESCE(number_killed, 0) AS number_killed, "
        "       COALESCE(number_injured, 0) AS number_injured "
        "FROM crashes "
        "WHERE crash_year = :year "
        "  AND latitude IS NOT NULL AND longitude IS NOT NULL"
    )
    with etl_engine.connect() as conn:
        return [
            CrashPoint(
                float(r.latitude), float(r.longitude), int(r.crash_year),
                int(r.number_killed), int(r.number_injured),
            )
            for r in conn.execute(sql, {"year": year})
        ]


@track_etl_run("tract_crashes")
def run(start_year: int | None = None, end_year: int | None = None) -> int:
    """Rebuild `tract_crash_year` for [start_year, end_year]."""
    end_year = end_year or date.today().year
    start_year = start_year or (end_year - DEFAULT_TRAILING_YEARS + 1)
    if start_year > end_year:
        raise ValueError(f"--start {start_year} is after --end {end_year}")
    if start_year < EARLIEST_YEAR:
        # Say so rather than silently clamping: a typo'd --start would
        # otherwise look like it worked.
        raise ValueError(
            f"--start {start_year} is before the first crash year {EARLIEST_YEAR}"
        )

    db = SessionLocal()
    total = 0
    try:
        index = build_tract_index(fetch_tract_features())
        for year in range(start_year, end_year + 1):
            crashes = fetch_crash_points(year)
            logger.info("Year %d: %d crashes with coordinates", year, len(crashes))

            if not crashes and _year_has_rows(db, year):
                # An empty read with rows already stored means the crashes
                # table lost the year, not that the tracts emptied. The
                # orchestrator's max_drop_pct guard is advisory and runs after
                # this commits, so refuse here instead.
                logger.warning(
                    "Year %d returned no coordinate crashes but tract rows "
                    "exist — refusing to wipe them", year,
                )
                continue

            rows = aggregate_crashes_to_tracts(crashes, index)

            # Delete-then-insert rather than upsert: a re-run of the window
            # has to be able to LOWER a tract's count (a crash re-geocoded
            # into its neighbour), and an upsert can only raise it. One
            # transaction per year, so a reader never sees the year missing.
            db.execute(
                text("DELETE FROM tract_crash_year WHERE year = :year"),
                {"year": year},
            )
            if rows:
                db.bulk_insert_mappings(TractCrashYear, rows)
            db.commit()
            total += len(rows)
            logger.info("Year %d: %d tract rows written", year, len(rows))

        logger.info("Done. %d tract-year rows across %d-%d",
                    total, start_year, end_year)
        return total
    finally:
        db.close()


def _year_has_rows(db, year: int) -> bool:
    return db.execute(
        text("SELECT 1 FROM tract_crash_year WHERE year = :year LIMIT 1"),
        {"year": year},
    ).first() is not None


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
