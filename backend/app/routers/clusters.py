"""Statistically significant crash-hotspot detection (grid density + z-score)."""

import logging
import time

from fastapi import APIRouter, Depends, Query, Request, Response
from slowapi import Limiter
from app.rate_limit import rate_limit_key
from sqlalchemy import case, func, literal_column, or_
from sqlalchemy.orm import Session

from app.county_slug_map import get_slug_map
from app.database import apply_statement_timeout, get_db
from app.filters import (
    build_crash_predicates,
    parse_bool_flag,
    parse_cause,
    parse_collision_type,
    parse_county_codes,
    parse_date_range,
    parse_driver_age,
    parse_hit_run,
    parse_lighting,
    parse_road_type,
    parse_severity,
    parse_weather,
    parse_year,
)
from app.models import Crash
from app.schemas.clusters import ClusterPoint, ClusterResponse, SeverityBreakdown

router = APIRouter(tags=["clusters"])
logger = logging.getLogger(__name__)

_STEP = 0.01  # ~0.7 mi grid cell; hotspot detection is inherently a zoomed-out concept
_DECIMALS = 2
_Z_SCORE_THRESHOLD = 2.0

_limiter = Limiter(key_func=rate_limit_key)

# The clusters aggregation groups ~4.1M coordinate rows onto a computed grid
# key (an unindexed round() expression) and is fetched on every map load and
# filter change. The result only changes when ETL loads rows, so — exactly
# like _concentration in intersections.py — cache the computed ClusterResponse
# in-process with a short TTL, keyed on the full filter tuple. Each worker
# then pays the scan at most once per TTL window per filter permutation.
_CLUSTER_CACHE_TTL_SECONDS = 6 * 3600
_CLUSTER_CACHE_MAX = 256
_clusters_cache: dict[tuple, tuple[float, ClusterResponse]] = {}


def clear_clusters_cache() -> None:
    """Drop all cached cluster results (tests / manual invalidation)."""
    _clusters_cache.clear()


def _compute_clusters(db: Session, preds: list) -> ClusterResponse:
    """Grid-aggregate crashes under *preds* and z-score the occupied cells.

    The heavy work (the ~4.1M-row grid GROUP BY) lives here so the endpoint can
    wrap it in the TTL cache and tests can observe when it actually runs.
    """
    lat_bucket = (func.round(Crash.latitude / _STEP) * _STEP).label("lat")
    lng_bucket = (func.round(Crash.longitude / _STEP) * _STEP).label("lng")
    count_ = func.count().label("count")
    fatal_ = func.sum(case((Crash.severity == "Fatal", 1), else_=0)).label("fatal")
    injury_ = func.sum(case((Crash.severity == "Injury", 1), else_=0)).label("injury")
    pdo_ = func.sum(case((Crash.severity == "Property Damage Only", 1), else_=0)).label("pdo")

    rows = (
        db.query(lat_bucket, lng_bucket, count_, fatal_, injury_, pdo_)
        .filter(*preds)
        .group_by(literal_column("lat"), literal_column("lng"))
        .all()
    )

    # The baseline (mean/stddev) is computed over OCCUPIED grid cells only, not
    # every cell in the CA bounding box. Including the ~1M mostly-empty cells
    # would collapse the mean toward zero and flag almost every occupied cell as
    # a "hotspot", so occupied-only is deliberate. Consequence: the z-score of
    # any single cell is bounded by sqrt(n-1), so with <= 5 occupied cells no
    # cell can exceed z > 2 and we correctly return no hotspots — heavy filters
    # that leave very little data yield "not enough to call a hotspot" rather
    # than a fabricated one.
    n = len(rows)
    counts = [r.count for r in rows]
    mean = sum(counts) / n if n else 0.0
    variance = sum((c - mean) ** 2 for c in counts) / n if n else 0.0
    stddev = variance**0.5
    threshold = mean + _Z_SCORE_THRESHOLD * stddev

    clusters = []
    if stddev > 0:
        for r in rows:
            z_score = (r.count - mean) / stddev
            if z_score > _Z_SCORE_THRESHOLD:
                clusters.append(ClusterPoint(
                    lat=round(float(r.lat), _DECIMALS),
                    lng=round(float(r.lng), _DECIMALS),
                    crash_count=r.count,
                    z_score=round(z_score, 2),
                    severity=SeverityBreakdown(fatal=r.fatal, injury=r.injury, pdo=r.pdo),
                ))

    return ClusterResponse(
        clusters=clusters,
        total_grid_cells=n,
        mean_count=round(mean, 2),
        stddev_count=round(stddev, 2),
        threshold=round(threshold, 2),
    )


@router.get("/crashes/clusters", response_model=ClusterResponse)
@_limiter.limit("1000/minute;20000/hour")
def crash_clusters(
    request: Request,
    response: Response,
    year: str | None = Query(None),
    start: str | None = Query(None),
    end: str | None = Query(None),
    county: str | None = Query(None),
    severity: str | None = Query(None),
    cause: str | None = Query(None),
    alcohol: str | None = Query(None),
    distracted: str | None = Query(None),
    pedestrian: str | None = Query(None),
    cyclist: str | None = Query(None),
    drug: str | None = Query(None),
    driver_age: str | None = Query(None),
    weather: str | None = Query(None),
    lighting: str | None = Query(None),
    collision_type: str | None = Query(None),
    road_type: str | None = Query(None),
    hit_run: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """Statistically significant crash hotspots.

    Aggregates crashes into a fixed 0.01deg (~0.7 mi) grid and flags cells
    whose crash count exceeds mean + 2 standard deviations of all grid
    cell counts (z-score thresholding). Aggregation happens entirely in SQL;
    the z-score pass runs in Python over the resulting grid cells only
    (typically hundreds to low-thousands of rows), never over raw crash rows.
    """
    response.headers["Cache-Control"] = "public, max-age=3600, stale-while-revalidate=86400"
    # Unfiltered requests aggregate the full 11M-row crashes table; bound the
    # query so a pathological filter permutation can't hold a pool connection
    # indefinitely (same backstop as /api/intersections and /api/stats).
    apply_statement_timeout(db, 30_000)

    # In-process TTL cache keyed on the full filter tuple. A hit skips the
    # ~4.1M-row grid scan entirely; invalid filters (see the parse_* calls
    # below) never reach here so they always re-validate and 4xx correctly.
    cache_key = (
        year, start, end, county, severity, cause, alcohol, distracted,
        pedestrian, cyclist, drug, driver_age, weather, lighting,
        collision_type, road_type, hit_run,
    )
    cached = _clusters_cache.get(cache_key)
    if cached is not None and cached[0] > time.monotonic():
        return cached[1]

    date_range = parse_date_range(start, end)
    years = parse_year(year) if date_range is None else None
    county_codes = parse_county_codes(county, get_slug_map(db)) if county else None
    severities = parse_severity(severity)
    causes = parse_cause(cause)
    alcohol_v = parse_bool_flag(alcohol, "alcohol")
    distracted_v = parse_bool_flag(distracted, "distracted")
    pedestrian_v = parse_bool_flag(pedestrian, "pedestrian")
    cyclist_v = parse_bool_flag(cyclist, "cyclist")
    drug_v = parse_bool_flag(drug, "drug")
    driver_age_v = parse_driver_age(driver_age)
    weather_v = parse_weather(weather)
    lighting_v = parse_lighting(lighting)
    collision_type_v = parse_collision_type(collision_type)
    road_type_v = parse_road_type(road_type)
    hit_run_v = parse_hit_run(hit_run)

    preds = build_crash_predicates(
        years=years,
        date_range=date_range,
        county_codes=county_codes,
        severities=severities,
        causes=causes,
        alcohol=alcohol_v,
        distracted=distracted_v,
        pedestrian=pedestrian_v,
        cyclist=cyclist_v,
        drug=drug_v,
        driver_age=driver_age_v,
        weather=weather_v,
        lighting=lighting_v,
        collision_type=collision_type_v,
        road_type=road_type_v,
        hit_run=hit_run_v,
    )
    preds.append(Crash.latitude.isnot(None))
    preds.append(Crash.longitude.isnot(None))
    preds.append(Crash.latitude.between(32.5, 42.05))
    preds.append(Crash.longitude.between(-124.5, -114.0))
    if county_codes:
        preds.append(or_(Crash.coord_county_mismatch.is_(None), Crash.coord_county_mismatch == False))  # noqa: E712

    result = _compute_clusters(db, preds)

    if len(_clusters_cache) >= _CLUSTER_CACHE_MAX:
        _clusters_cache.clear()
    _clusters_cache[cache_key] = (time.monotonic() + _CLUSTER_CACHE_TTL_SECONDS, result)
    return result
