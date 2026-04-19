"""Paginated crash detail endpoint."""

import logging

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
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
from app.schemas.common import PaginatedResponse
from app.schemas.crashes import CrashOut

router = APIRouter(tags=["crashes"])
logger = logging.getLogger(__name__)

# Bounded cost for `?include_total=true` on the 11M-row crashes table.
# Two layers of defense, because neither is enough alone on B1ms Azure:
#   1. Filter requirement — unfiltered COUNT(*) takes minutes; we reject
#      `include_total=true` unless at least one filter is set.
#   2. statement_timeout — even with filters, broad combinations (e.g.
#      year + severity only) can take >60s without a covering index
#      (#106). The timeout caps the worst case and returns total=null.
# The real fix is covering-index work on the `crashes` table — see #106.
# Future bulk/export endpoints (see #57) should use their own longer budget.
COUNT_STATEMENT_TIMEOUT_MS = 5000


@router.get("/crashes", response_model=PaginatedResponse[CrashOut])
def list_crashes(
    response: Response,
    year: str | None = Query(None),
    county: str | None = Query(None),
    severity: str | None = Query(None),
    cause: str | None = Query(None),
    alcohol: str | None = Query(None),
    distracted: str | None = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    include_total: bool = Query(False),
    db: Session = Depends(get_db),
):
    """Paginated crash detail records.

    Filters (all multi-value, comma-separated):
      - `year=2020,2023`
      - `county=los-angeles,orange` (slugified county names)
      - `severity=fatal,injury,property-damage-only`
      - `cause=dui,speeding,lane-change,other`
      - `alcohol=true|false`  (CCRS 2016+ only; excludes SWITRS)
      - `distracted=true|false`  (CCRS 2016+ only)

    Sorted by `crash_datetime DESC, id DESC`. `total` is `null` by default;
    set `?include_total=true` to get a count — this requires at least one
    filter (year, county, severity, cause, alcohol, distracted) to keep the
    query bounded. For aggregate totals across all crashes, use `/api/stats`.
    """
    response.headers["Cache-Control"] = "public, max-age=300"

    years = parse_year(year)
    county_codes = parse_county_codes(county, get_slug_map(db)) if county else None
    severities = parse_severity(severity)
    causes = parse_cause(cause)
    alcohol_v = parse_bool_flag(alcohol, "alcohol")
    distracted_v = parse_bool_flag(distracted, "distracted")

    if include_total and not any([
        years, county_codes, severities, causes,
        alcohol_v is not None, distracted_v is not None,
    ]):
        raise FilterError(
            "include_total",
            "include_total=true requires at least one filter (year, county, "
            "severity, cause, alcohol, distracted). Unbounded COUNT(*) over "
            "11M crashes is too slow. For aggregate totals, use /api/stats.",
        )

    preds = build_crash_predicates(
        years=years,
        county_codes=county_codes,
        severities=severities,
        causes=causes,
        alcohol=alcohol_v,
        distracted=distracted_v,
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
        # We use `SET` (session-scoped) rather than `SET LOCAL` (tx-scoped)
        # because SQLAlchemy's transaction lifecycle around Session.execute
        # is inconsistent enough that SET LOCAL sometimes doesn't apply to
        # the subsequent Query.count(). The finally block resets the timeout
        # before the connection goes back to the pool so the next request
        # starts clean.
        try:
            db.execute(text(f"SET statement_timeout = {COUNT_STATEMENT_TIMEOUT_MS}"))
            total = q.count()
        except OperationalError as exc:
            logger.warning(
                "include_total COUNT exceeded %dms; returning total=null (%s)",
                COUNT_STATEMENT_TIMEOUT_MS,
                exc.__class__.__name__,
            )
            db.rollback()
            total = None
        finally:
            db.execute(text("SET statement_timeout = 0"))

    rows = q.offset(offset).limit(limit).all()
    return PaginatedResponse[CrashOut](
        limit=limit,
        offset=offset,
        items=[CrashOut.model_validate(r) for r in rows],
        total=total,
    )
