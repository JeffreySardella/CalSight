"""Grid-aggregated crash heatmap endpoint."""

import logging
from enum import Enum

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import func, literal_column
from sqlalchemy.orm import Session

from app.county_slug_map import get_slug_map
from app.database import get_db
from app.filters import (
    FilterError,
    build_crash_predicates,
    parse_bool_flag,
    parse_cause,
    parse_county_codes,
    parse_severity,
    parse_year,
)
from app.models import Crash
from app.schemas.heatmap import HeatmapPoint, HeatmapResponse

router = APIRouter(tags=["heatmap"])
logger = logging.getLogger(__name__)


class Resolution(str, Enum):
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


@router.get("/crashes/heatmap", response_model=HeatmapResponse)
def crash_heatmap(
    response: Response,
    year: str | None = Query(None),
    county: str | None = Query(None),
    severity: str | None = Query(None),
    cause: str | None = Query(None),
    alcohol: str | None = Query(None),
    distracted: str | None = Query(None),
    resolution: Resolution | None = Query(None),
    db: Session = Depends(get_db),
):
    """Grid-aggregated crash locations for heatmap rendering.

    Buckets crash lat/lng into grid cells and returns {lat, lng, weight}
    per cell.  Same filter params as /api/crashes.

    Resolution controls grid cell size:
      - low  (0.1 deg, ~7 mi)  — default for statewide
      - medium (0.01 deg, ~0.7 mi) — default when county is set
      - high (0.001 deg, ~350 ft) — county-only, rejected without county
    """
    response.headers["Cache-Control"] = "public, max-age=300"

    years = parse_year(year)
    county_codes = parse_county_codes(county, get_slug_map(db)) if county else None
    severities = parse_severity(severity)
    causes = parse_cause(cause)
    alcohol_v = parse_bool_flag(alcohol, "alcohol")
    distracted_v = parse_bool_flag(distracted, "distracted")

    if resolution is None:
        resolution = Resolution.medium if county_codes else Resolution.low

    if resolution == Resolution.high and not county_codes:
        raise FilterError(
            "resolution",
            "High resolution requires a county filter. "
            "Use ?resolution=low or ?resolution=medium for statewide queries.",
        )

    step = _STEP[resolution]

    preds = build_crash_predicates(
        years=years,
        county_codes=county_codes,
        severities=severities,
        causes=causes,
        alcohol=alcohol_v,
        distracted=distracted_v,
    )
    preds.append(Crash.latitude.isnot(None))
    preds.append(Crash.longitude.isnot(None))

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
