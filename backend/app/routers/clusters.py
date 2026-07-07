"""Statistically significant crash-hotspot detection (grid density + z-score)."""

import logging

from fastapi import APIRouter, Depends, Query, Request, Response
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import case, func, literal_column, or_
from sqlalchemy.orm import Session

from app.county_slug_map import get_slug_map
from app.database import get_db
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

_limiter = Limiter(key_func=get_remote_address)


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
