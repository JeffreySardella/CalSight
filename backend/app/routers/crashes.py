"""Paginated crash detail endpoint."""

import logging

from fastapi import APIRouter, Depends, Query, Request, Response
from slowapi import Limiter
from app.rate_limit import rate_limit_key
from sqlalchemy.exc import OperationalError
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
    require_min_filter,
)
from app.models import Crash
from app.schemas.common import PaginatedResponse
from app.schemas.crashes import CrashOut

router = APIRouter(tags=["crashes"])
logger = logging.getLogger(__name__)

# Bounded cost for `?include_total=true` on the 11M-row crashes table.
# Two layers of defense, because neither is enough alone on B1ms Azure:
#   1. require_min_filter (security + performance) — rejects requests with
#      no county/year/date_range. Originally protected the unfiltered
#      COUNT(*) path; #282 extended it to all reads so individual crash
#      rows (lat/lng + alcohol/distraction flags) can't be walked from
#      offset=0 without first narrowing the slice.
#   2. statement_timeout — even with a county/year filter, broad
#      combinations can take >60s without a covering index (#106). The
#      timeout caps the worst case and returns total=null.
# The real fix is covering-index work on the `crashes` table — see #106.
# Future bulk/export endpoints (see #57) should use their own longer budget.
COUNT_STATEMENT_TIMEOUT_MS = 5000

_limiter = Limiter(key_func=rate_limit_key)


@router.get("/crashes", response_model=PaginatedResponse[CrashOut])
@_limiter.limit("1000/minute;20000/hour")
def list_crashes(
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
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    include_total: bool = Query(False),
    db: Session = Depends(get_db),
):
    """Paginated crash detail records.

    Filters (all multi-value, comma-separated):
      - `start=2020-01&end=2023-12` (month-resolution date range; either
        side may be omitted)
      - `year=2020,2023` (legacy; ignored when `start` or `end` is set)
      - `county=los-angeles,orange` (slugified county names)
      - `severity=fatal,injury,property-damage-only`
      - `cause=dui,speeding,lane-change,other`
      - `alcohol=true|false`  (CCRS 2016+ only; excludes SWITRS)
      - `distracted=true|false`  (CCRS 2016+ only)

    Sorted by `crash_datetime DESC, id DESC`. `total` is `null` by default;
    set `?include_total=true` to get a count.

    At least one of `county`, `year`, `start`/`end` is required — unfiltered
    paginated reads of individual crash rows (lat/lng + alcohol/distraction
    flags) lower the barrier to bulk re-identification. For aggregate totals
    across all crashes, use `/api/stats`.

    Cache-Control: `no-store` so a public CDN can't memoize individual rows.
    """
    response.headers["Cache-Control"] = "no-store"

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

    require_min_filter(
        county_codes=county_codes,
        years=years,
        date_range=date_range,
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

    q = db.query(Crash).filter(*preds).order_by(
        Crash.crash_datetime.desc(), Crash.id.desc()
    )

    total: int | None = None
    if include_total:
        # Bounded COUNT — falls back to null on timeout so slow queries
        # don't stall the client. (The filter requirement above handles
        # the unfiltered case; this catches broad filter combos.)
        #
        try:
            # Bound only the COUNT, then reset. We work inside the Session's
            # existing (autobegun) transaction and use the Session's own
            # rollback on timeout — no manual BEGIN/COMMIT, which would desync
            # the Session from the DB's transaction state (audit M-B3). The
            # explicit reset keeps the timeout from bounding the rows query
            # below; on timeout the rollback ends the aborted transaction so
            # that query starts clean, and SET LOCAL is dropped with it.
            apply_statement_timeout(db, COUNT_STATEMENT_TIMEOUT_MS)
            total = q.count()
            apply_statement_timeout(db, 0)
        except OperationalError as exc:
            db.rollback()
            logger.warning(
                "include_total COUNT exceeded %dms; returning total=null (%s)",
                COUNT_STATEMENT_TIMEOUT_MS,
                exc.__class__.__name__,
            )
            total = None

    rows = q.offset(offset).limit(limit).all()
    return PaginatedResponse[CrashOut](
        limit=limit,
        offset=offset,
        items=[CrashOut.model_validate(r) for r in rows],
        total=total,
    )
