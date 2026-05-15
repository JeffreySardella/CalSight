"""Grid-aggregated crash heatmap endpoint."""

import logging
from enum import Enum

from fastapi import APIRouter, Depends, Query, Request, Response
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import func, literal_column, or_
from sqlalchemy.orm import Session

from app.county_slug_map import get_slug_map
from app.database import get_db
from app.filters import (
    FilterError,
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
from app.schemas.heatmap import HeatmapPoint, HeatmapResponse

router = APIRouter(tags=["heatmap"])
logger = logging.getLogger(__name__)

RAW_POINT_LIMIT = 150_000


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


_limiter = Limiter(key_func=get_remote_address)


@router.get("/crashes/heatmap", response_model=HeatmapResponse)
@_limiter.limit("30/minute")
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
    db: Session = Depends(get_db),
):
    """Crash locations for heatmap rendering.

    Resolution controls output:
      - raw — individual crash lat/lng (county required, limit 150K per batch)
      - low  (0.1 deg, ~7 mi)  — grid-aggregated
      - medium (0.01 deg, ~0.7 mi) — grid-aggregated
      - high (0.001 deg, ~350 ft) — grid-aggregated
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
    preds.append(Crash.latitude.between(32.5, 42.05))
    preds.append(Crash.longitude.between(-124.5, -114.0))
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

        page_size = batch_size or RAW_POINT_LIMIT
        total_batches = max(1, (total_q + page_size - 1) // page_size) if batch else None
        current_batch = batch or 1
        offset = (current_batch - 1) * page_size

        rows = (
            db.query(
                Crash.latitude, Crash.longitude, Crash.severity,
                Crash.collision_id, Crash.data_source, Crash.crash_datetime,
                Crash.canonical_cause, Crash.weather, Crash.lighting,
                Crash.number_killed, Crash.number_injured,
                Crash.primary_road, Crash.hit_run,
            )
            .filter(*preds)
            .order_by(Crash.id)
            .limit(page_size)
            .offset(offset)
            .all()
        )
        return HeatmapResponse(
            points=[HeatmapPoint(
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
            ) for r in rows],
            total_crashes=total_q,
            batch=current_batch if batch else None,
            total_batches=total_batches,
        )

    step = _STEP[resolution]
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
    decimals = _DECIMALS[resolution]

    return HeatmapResponse(
        points=[
            HeatmapPoint(lat=round(float(r.lat), decimals), lng=round(float(r.lng), decimals), weight=r.weight)
            for r in rows
        ],
        total_crashes=total,
    )
