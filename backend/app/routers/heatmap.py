"""Grid-aggregated crash heatmap endpoint."""

import logging
import math
import time
from enum import Enum
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from slowapi import Limiter
from app.rate_limit import rate_limit_key
from sqlalchemy import func, literal_column, or_
from sqlalchemy.orm import Session

from app.county_slug_map import get_slug_map
from app.database import get_db
from app.filters import (
    CA_MAX_LAT,
    CA_MAX_LNG,
    CA_MIN_LAT,
    CA_MIN_LNG,
    FilterError,
    build_crash_predicates,
    parse_bbox,
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
from app.schemas.heatmap import HeatmapPoint, HeatmapResponse

router = APIRouter(tags=["heatmap"])
logger = logging.getLogger(__name__)

RAW_POINT_LIMIT = 150_000

# The columns a raw-resolution row needs for a full-detail point (popup use).
_RAW_FULL_COLUMNS = (
    Crash.latitude, Crash.longitude, Crash.severity,
    Crash.collision_id, Crash.data_source, Crash.crash_datetime,
    Crash.canonical_cause, Crash.weather, Crash.lighting,
    Crash.number_killed, Crash.number_injured,
    Crash.primary_road, Crash.hit_run,
)
_RAW_SLIM_COLUMNS = (Crash.latitude, Crash.longitude)

# bbox default/cap for the raw+bbox "dot detail" use case (zoom>=14 popups).
BBOX_DEFAULT_LIMIT = 800
BBOX_MAX_LIMIT = 2000

# Ladder of grid steps for server-side downsampling when a raw request would
# return more than `max_points` rows (the leaflet.heat `_redraw` cost is
# O(points), not O(bytes) — slim shrinks the download, this shrinks the
# point count). Picked from finest to coarsest; ~ladder rungs double the
# earlier resolution steps below. (step_degrees, output_decimals).
_RAW_AGG_LADDER: list[tuple[float, int]] = [
    (0.0005, 4), (0.001, 3), (0.002, 3), (0.005, 3),
    (0.01, 2), (0.02, 2), (0.05, 2), (0.1, 1), (0.2, 1), (0.5, 1), (1.0, 0),
]


class Resolution(str, Enum):
    raw = "raw"
    low = "low"
    medium = "medium"
    high = "high"


_STEP = {
    Resolution.low: 0.1,
    Resolution.medium: 0.01,
    Resolution.high: 0.001,
}

_DECIMALS = {
    Resolution.low: 1,
    Resolution.medium: 2,
    Resolution.high: 3,
}

# `medium` run statewide (no county) groups the full filtered crashes table
# into a 0.01deg (~0.7mi) grid across all 58 counties — measured at 9.3 MB of
# JSON for a single year (2026-09-18 latency sweep). `raw`/`high` require a
# county for the same reason, but `medium` can't get that guard: the frontend
# legitimately requests it unscoped (LayersPanel's statewide-heatmap Resolution
# toggle offers only Low/Medium, no county involved). `low` already stays
# small at any scope by being coarse enough on its own — give unscoped
# `medium` the same treatment: a coarser step, not a bigger guard.
_STATEWIDE_MEDIUM_STEP = 0.03  # ~2mi, vs 0.01 (~0.7mi) once a county scopes it


_limiter = Limiter(key_func=rate_limit_key)


# The grid branch GROUP BYs the whole filtered crash table on an unindexed
# round() expression and is hit on every map load. Same in-process TTL cache as
# clusters.py / intersections.py, keyed on the full filter tuple + resolution.
# The raw branch stays uncached (per-county 150K-point batches).
_HEATMAP_CACHE_TTL_SECONDS = 6 * 3600
_HEATMAP_CACHE_MAX = 256
_heatmap_cache: dict[tuple, tuple[float, HeatmapResponse]] = {}


def clear_heatmap_cache() -> None:
    """Drop all cached grid results (tests / manual invalidation)."""
    _heatmap_cache.clear()


def _compute_grid(
    db: Session, preds: list, step: float, decimals: int, grid_step: float | None = None
) -> HeatmapResponse:
    """Grid-aggregate crashes under *preds*. Factored out so the cache is observable.

    `grid_step` is only set (and echoed in the response) for the raw+max_points
    downsampling path below — the fixed low/medium/high grid resolutions leave
    it null, since choosing *that* step isn't a runtime decision.
    """
    lat_bucket = (func.round(Crash.latitude / step) * step).label("lat")
    lng_bucket = (func.round(Crash.longitude / step) * step).label("lng")
    weight = func.count().label("weight")

    rows = (
        db.query(lat_bucket, lng_bucket, weight)
        .filter(*preds)
        .group_by(literal_column("lat"), literal_column("lng"))
        .all()
    )

    total = sum(r.weight for r in rows)

    return HeatmapResponse(
        points=[
            HeatmapPoint(lat=round(float(r.lat), decimals), lng=round(float(r.lng), decimals), weight=r.weight)
            for r in rows
        ],
        total_crashes=total,
        grid_step=grid_step,
    )


_AGG_STEP_QUERY_BUDGET = 3


def _choose_agg_step(db: Session, preds: list, max_points: int) -> tuple[float, int]:
    """Pick the finest ladder step whose ACTUAL distinct-cell count fits max_points.

    Crash data is sparse relative to its bounding box, so the cheap
    `ceil(d_lat/step) * ceil(d_lng/step)` estimate routinely overshoots by
    5-10x (e.g. Fresno at 0.01deg: ~35K estimated cells vs ~4.5K real ones)
    — trusting it alone picks a needlessly coarse, visibly blocky grid. The
    estimate is still an upper bound on the real count, though, so any rung
    whose estimate already fits is guaranteed to fit for real with zero
    queries; that gives a free (and often the only) upper bound for a
    binary search that resolves the rest with actual `COUNT(DISTINCT
    <cell>)` queries, capped at `_AGG_STEP_QUERY_BUDGET`.

    ponytail: assumes actual cell count is monotonic non-decreasing as the
    step gets finer (a coarser grid can only merge cells, never split them)
    — true for how these buckets are built, and it's what makes a binary
    search valid here. If no rung's actual count fits within the query
    budget, returns the coarsest rung and accepts the overshoot (matching
    the raw endpoint's existing "requires a county" scale ceiling).
    """
    min_lat, max_lat, min_lng, max_lng = db.query(
        func.min(Crash.latitude), func.max(Crash.latitude),
        func.min(Crash.longitude), func.max(Crash.longitude),
    ).filter(*preds).one()
    if min_lat is None:
        return _RAW_AGG_LADDER[0]
    d_lat = max(max_lat - min_lat, 1e-9)
    d_lng = max(max_lng - min_lng, 1e-9)

    def estimate(step: float) -> int:
        return math.ceil(d_lat / step) * math.ceil(d_lng / step)

    def actual_count(step: float) -> int:
        subq = (
            db.query(
                (func.round(Crash.latitude / step) * step).label("lat"),
                (func.round(Crash.longitude / step) * step).label("lng"),
            )
            .filter(*preds)
            .distinct()
            .subquery()
        )
        return db.query(func.count()).select_from(subq).scalar() or 0

    n = len(_RAW_AGG_LADDER)
    # Finest rung whose estimate alone guarantees a fit; falls back to the
    # coarsest rung (unverified) if no estimate ever clears the bar.
    hi = next((i for i in range(n) if estimate(_RAW_AGG_LADDER[i][0]) <= max_points), n - 1)
    if hi == 0:
        return _RAW_AGG_LADDER[0]

    lo = 0
    queries_left = _AGG_STEP_QUERY_BUDGET
    while lo < hi and queries_left > 0:
        mid = (lo + hi) // 2
        queries_left -= 1
        if actual_count(_RAW_AGG_LADDER[mid][0]) <= max_points:
            hi = mid
        else:
            lo = mid + 1
    return _RAW_AGG_LADDER[hi]


@router.get("/crashes/heatmap", response_model=HeatmapResponse)
@_limiter.limit("1000/minute;20000/hour")
def crash_heatmap(
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
    resolution: Resolution | None = Query(None),
    mismatch_only: str | None = Query(None),
    include_rivers: str | None = Query(None),
    batch: int | None = Query(None, ge=1),
    batch_size: int | None = Query(None, ge=1000, le=200_000),
    detail: Literal["slim", "full"] = Query(
        "full", description="slim -> lat/lng/weight only; full -> also crash-dot popup fields."
    ),
    bbox: str | None = Query(
        None, description="minLng,minLat,maxLng,maxLat — restrict raw points to this rectangle."
    ),
    limit: int = Query(
        BBOX_DEFAULT_LIMIT, ge=1, le=BBOX_MAX_LIMIT,
        description="Max points returned when bbox is set (raw resolution only).",
    ),
    max_points: int | None = Query(
        None, ge=1, le=100_000,
        description="Raw resolution only: if the filtered count exceeds this, "
        "aggregate onto a lat/lng grid fine enough to stay at/under it instead "
        "of returning every row.",
    ),
    db: Session = Depends(get_db),
):
    """Crash locations for heatmap rendering.

    Resolution controls output:
      - raw — individual crash lat/lng (county required, limit 150K per batch)
      - low  (0.1 deg, ~7 mi)  — grid-aggregated
      - medium (0.01 deg, ~0.7 mi) — grid-aggregated
      - high (0.001 deg, ~350 ft) — grid-aggregated

    `detail=slim` (raw only) drops every field but lat/lng/weight. `bbox`
    (raw only) restricts to a rectangle and caps the count at `limit`,
    ignoring `batch`/`batch_size` — it's the single-shot "popups in the
    current viewport" query, not a paginated dump. `max_points` (raw only)
    downsamples onto a grid when the filtered count would exceed it; the
    resulting points are always slim-shaped (a grid cell has no single
    crash's detail to report) and `grid_step` in the response says what step
    was chosen (null otherwise). `bbox` also narrows low/medium/high grid
    queries (as a plain extra predicate) — `max_points` does not apply to
    them, since their output is already grid-bounded.
    """
    response.headers["Cache-Control"] = "public, max-age=3600, stale-while-revalidate=86400"

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
    bbox_v = parse_bbox(bbox)

    if resolution is None:
        resolution = Resolution.raw if county_codes else Resolution.low

    if resolution in (Resolution.raw, Resolution.high) and not county_codes:
        raise FilterError(
            "resolution",
            f"{resolution.value.capitalize()} resolution requires a county filter.",
        )

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
    preds.append(Crash.latitude.between(CA_MIN_LAT, CA_MAX_LAT))
    preds.append(Crash.longitude.between(CA_MIN_LNG, CA_MAX_LNG))
    if bbox_v is not None:
        min_lng, min_lat, max_lng, max_lat = bbox_v
        # Same two columns as the CA-bounds predicate above, in the same
        # order as the ix_crashes_lat_lng(latitude, longitude) partial index:
        # Postgres uses the latitude range to bound the index scan and checks
        # longitude against the index's own stored values, so this stays
        # sargable without a new index (see docs on multicolumn btree index
        # constraints — only leading-column constraints narrow the scanned
        # range, but trailing-column constraints are still checked in-index).
        preds.append(Crash.latitude.between(min_lat, max_lat))
        preds.append(Crash.longitude.between(min_lng, max_lng))
    mismatch_flag = parse_bool_flag(mismatch_only, "mismatch_only")
    rivers_flag = parse_bool_flag(include_rivers, "include_rivers")
    if mismatch_flag is True:
        if rivers_flag is True:
            preds.append(or_(Crash.coord_county_mismatch == True, Crash.coord_over_water == True))  # noqa: E712
        else:
            preds.append(Crash.coord_county_mismatch == True)  # noqa: E712
    elif county_codes:
        if rivers_flag is True:
            preds.append(or_(
                Crash.coord_county_mismatch.is_(None) & Crash.coord_over_water.isnot(True),
                Crash.coord_county_mismatch == False,  # noqa: E712
            ))
        else:
            preds.append(or_(Crash.coord_county_mismatch.is_(None), Crash.coord_county_mismatch == False))  # noqa: E712

    if resolution == Resolution.raw:
        total_q = db.query(func.count()).filter(*preds).scalar() or 0

        # Falls through to the shared grid/cache branch below when the
        # filtered count exceeds max_points — same downsampling mechanism as
        # low/medium/high, just with a runtime-chosen step.
        if max_points is None or total_q <= max_points:
            if bbox_v is not None:
                # Single-shot "points in the current viewport" query — not a
                # paginated dump, so batch/batch_size are ignored.
                page_size = limit
                current_batch = None
                total_batches = None
                offset = 0
            else:
                page_size = batch_size or RAW_POINT_LIMIT
                total_batches = max(1, (total_q + page_size - 1) // page_size) if batch else None
                current_batch = batch or 1
                offset = (current_batch - 1) * page_size

            slim = detail == "slim"
            columns = _RAW_SLIM_COLUMNS if slim else _RAW_FULL_COLUMNS
            rows = (
                db.query(*columns)
                .filter(*preds)
                .order_by(Crash.id)
                .limit(page_size)
                .offset(offset)
                .all()
            )
            if slim:
                points = [HeatmapPoint(lat=r.latitude, lng=r.longitude, weight=1) for r in rows]
            else:
                points = [HeatmapPoint(
                    lat=r.latitude, lng=r.longitude, weight=1,
                    severity=r.severity,
                    collision_id=r.collision_id,
                    data_source=r.data_source,
                    crash_datetime=r.crash_datetime.isoformat() if r.crash_datetime else None,
                    canonical_cause=r.canonical_cause,
                    weather=r.weather,
                    lighting=r.lighting,
                    number_killed=r.number_killed,
                    number_injured=r.number_injured,
                    primary_road=r.primary_road,
                    hit_run=r.hit_run,
                ) for r in rows]
            return HeatmapResponse(
                points=points,
                total_crashes=total_q,
                batch=current_batch if (bbox_v is None and batch) else None,
                total_batches=total_batches,
            )

    cache_key = (
        year, start, end, county, severity, cause, alcohol, distracted,
        pedestrian, cyclist, drug, driver_age, weather, lighting,
        collision_type, road_type, hit_run, mismatch_only, include_rivers,
        resolution, detail, bbox, max_points,
    )
    cached = _heatmap_cache.get(cache_key)
    if cached is not None and cached[0] > time.monotonic():
        return cached[1]

    if resolution == Resolution.raw:
        # Got here because total_q > max_points (max_points is not None).
        step, decimals = _choose_agg_step(db, preds, max_points)
        result = _compute_grid(db, preds, step, decimals, grid_step=step)
    else:
        step = _STEP[resolution]
        if resolution == Resolution.medium and not county_codes:
            step = _STATEWIDE_MEDIUM_STEP
        result = _compute_grid(db, preds, step, _DECIMALS[resolution])

    if len(_heatmap_cache) >= _HEATMAP_CACHE_MAX:
        _heatmap_cache.clear()
    _heatmap_cache[cache_key] = (time.monotonic() + _HEATMAP_CACHE_TTL_SECONDS, result)
    return result
