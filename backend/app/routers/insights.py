"""GET /api/insights/{county_slug} — pre-computed per-county insight cards.

Returns the structured crash stats and AI-generated narrative for a single
county. Stats are computed deterministically at ETL time and are always
reliable. The ``narrative`` field may be null if the LLM step was skipped or
failed for that county.

Endpoint
--------
::

    GET /api/insights/{county_slug}?year={year}

Parameters
----------
county_slug : str
    County name in slug form (lowercase, hyphens for spaces).
    Examples: ``los-angeles``, ``san-francisco``, ``el-dorado``.
    Matches the convention in ``frontend/src/hooks/useFilterParams.ts``.

year : int, optional
    If omitted, returns the latest available year for this county.

Response
--------
200 JSON with the full insight payload (narrative may be null).
404 if the slug doesn't map to a known county, or if no insight data exists.

Cache
-----
``Cache-Control: public, max-age=3600, stale-while-revalidate=86400``
"""

from __future__ import annotations

from datetime import date
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel
from slowapi import Limiter
from app.rate_limit import rate_limit_key
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Query as OrmQuery, Session

from app.county_slug_map import get_code, get_slug_map
from app.database import get_db
from app.models import County, CountyInsight, CountyInsightCard, StatewideInsight
from app.routers.stats import mv_year
from app.schemas.context import CountyInsightCardOut, StatewideInsightOut

router = APIRouter(tags=["insights"])

_limiter = Limiter(key_func=rate_limit_key)


class FunFactOut(BaseModel):
    narrative: str
    year: int
    angle: str
    county_name: str | None = None

    model_config = {"from_attributes": True}


class CountyInsightPayload(BaseModel):
    """Response shape of GET /api/insights/{county_slug} (#291)."""

    county_name: str
    year: int
    total_crashes: int | None
    total_killed: int | None
    total_injured: int | None
    crash_rate_per_capita: float | None
    top_cause: str | None
    top_cause_pct: float | None
    yoy_change_pct: float | None
    peak_hour: int | None
    dui_pct: float | None
    narrative: str | None
    generated_at: str | None  # ISO 8601


def _current_cards(q: OrmQuery) -> OrmQuery:
    """Only cards that still agree with the numbers the rest of the site shows.

    A card stores the county-year totals it was written from; it is served
    only while they equal mv_crashes_by_year (the source of /api/stats and the
    county report card). The live Fresno 2025 card said "126 fatalities from
    10,493 crashes", written while 2025 deaths were still filling in; the
    report card says 142 / 10,546. NULL totals (cards written before the
    snapshot existed) never match, and the current calendar year is partial
    by definition, so neither is served.
    """
    live = (
        select(
            mv_year.c.county_code,
            mv_year.c.crash_year,
            func.sum(mv_year.c.crash_count).label("tc"),
            func.sum(mv_year.c.total_killed).label("tk"),
        )
        .group_by(mv_year.c.county_code, mv_year.c.crash_year)
        .subquery()
    )
    return q.join(
        live,
        and_(
            live.c.county_code == CountyInsightCard.county_code,
            live.c.crash_year == CountyInsightCard.year,
            live.c.tc == CountyInsightCard.total_crashes,
            live.c.tk == CountyInsightCard.total_killed,
        ),
    ).filter(CountyInsightCard.year < date.today().year)


def _current_statewide(q: OrmQuery) -> OrmQuery:
    """_current_cards for statewide_insights: served only while the stored
    year totals equal mv_crashes_by_year summed over every county.

    The May 2026 hand-seeded rows carry totals but their text was never
    checked against any stats ("Insurance actuaries had known this for
    decades"), so migration e6d9f06f7bb0 cleared their totals. Only the
    generators, which gate their text, write totals back.
    """
    live = (
        select(
            mv_year.c.crash_year,
            func.sum(mv_year.c.crash_count).label("tc"),
            func.sum(mv_year.c.total_killed).label("tk"),
        )
        .group_by(mv_year.c.crash_year)
        .subquery()
    )
    return q.join(
        live,
        and_(
            live.c.crash_year == StatewideInsight.year,
            live.c.tc == StatewideInsight.total_crashes,
            live.c.tk == StatewideInsight.total_killed,
        ),
    ).filter(StatewideInsight.year < date.today().year)


@router.get("/insights/statewide", response_model=StatewideInsightOut)
@_limiter.limit("1000/minute;20000/hour")
def get_random_statewide_insight(
    request: Request,
    response: Response,
    year: int | None = Query(None, description="Filter by year; omit for any year"),
    db: Session = Depends(get_db),
):
    """Return one random statewide insight card that matches today's data.

    404 when none does; the map then shows no California Insight card.
    """
    response.headers["Cache-Control"] = "public, max-age=3600, stale-while-revalidate=86400"
    q = _current_statewide(db.query(StatewideInsight))
    if year is not None:
        q = q.filter(StatewideInsight.year == year)
    row = q.order_by(func.random()).first()
    if row is None:
        raise HTTPException(status_code=404, detail="No statewide insights found")
    return StatewideInsightOut.model_validate(row)


@router.get("/fun-facts", response_model=List[FunFactOut])
@_limiter.limit("1000/minute;20000/hour")
def get_fun_facts(
    request: Request,
    response: Response,
    n: int = Query(3, ge=1, le=10, description="Number of fun facts to return"),
    county: str | None = Query(None, description="County slug; if provided, prefer county-specific facts"),
    db: Session = Depends(get_db),
):
    """Return N random fun facts.

    When a county is provided, fetches county-specific facts first and fills
    the remainder with statewide facts. Without a county, returns only
    statewide fun facts.
    """
    response.headers["Cache-Control"] = "public, max-age=3600, stale-while-revalidate=86400"

    results: list = []

    # If county provided, get county-specific fun facts first
    if county:
        slug_map = get_slug_map(db)
        code = get_code(county, slug_map)
        if code is not None:
            county_facts = (
                _current_cards(db.query(CountyInsightCard))
                .filter(
                    CountyInsightCard.county_code == code,
                    CountyInsightCard.angle.like("fun_fact%"),
                )
                .order_by(func.random())
                .limit(n)
                .all()
            )
            for row in county_facts:
                results.append(FunFactOut(
                    narrative=row.narrative,
                    year=row.year,
                    angle=row.angle,
                    county_name=row.county_name,
                ))

    # Fill remaining slots with statewide fun facts
    remaining = n - len(results)
    if remaining > 0:
        statewide_facts = (
            _current_statewide(db.query(StatewideInsight))
            .filter(StatewideInsight.angle.like("fun_fact%"))
            .order_by(func.random())
            .limit(remaining)
            .all()
        )
        for row in statewide_facts:
            results.append(FunFactOut(
                narrative=row.narrative,
                year=row.year,
                angle=row.angle,
                county_name=None,
            ))

    if not results:
        raise HTTPException(status_code=404, detail="No fun facts found")

    return results


@router.get("/insight-cards/random", response_model=CountyInsightCardOut)
@_limiter.limit("1000/minute;20000/hour")
def get_random_county_insight_card(
    request: Request,
    response: Response,
    county: str = Query(..., description="County slug, e.g. 'los-angeles'"),
    year: int | None = Query(None),
    db: Session = Depends(get_db),
):
    """Return one random insight card for a county that matches today's data.

    404 when none does; the map then shows /api/insights/{slug}'s narrative.
    """
    response.headers["Cache-Control"] = "public, max-age=3600, stale-while-revalidate=86400"
    slug_map = get_slug_map(db)
    code = get_code(county, slug_map)
    if code is None:
        raise HTTPException(status_code=404, detail=f"County '{county}' not found")
    q = _current_cards(db.query(CountyInsightCard)).filter(CountyInsightCard.county_code == code)
    if year is not None:
        q = q.filter(CountyInsightCard.year == year)
    row = q.order_by(func.random()).first()
    if row is None:
        raise HTTPException(status_code=404, detail="No insight cards found")
    return CountyInsightCardOut.model_validate(row)


@router.get("/insights/{county_slug}", response_model=CountyInsightPayload)
@_limiter.limit("1000/minute;20000/hour")
def get_insight(
    request: Request,
    county_slug: str,
    response: Response,
    year: int | None = Query(None, description="Insight year; defaults to latest available"),
    db: Session = Depends(get_db),
):
    """Return the pre-computed insight card for a single county.

    Returns ``narrative: null`` (not 404) when structured stats exist but the
    LLM hasn't run or failed for this county — the frontend hides the blurb
    section gracefully in that case.
    """
    response.headers["Cache-Control"] = "public, max-age=3600, stale-while-revalidate=86400"

    # Resolve slug → county_code
    slug_map = get_slug_map(db)
    county_code = get_code(county_slug, slug_map)
    if county_code is None:
        raise HTTPException(
            status_code=404,
            detail=f"County slug '{county_slug}' not found. "
                   "Use lowercase-hyphenated form, e.g. 'los-angeles'.",
        )

    # Fetch insight row
    q = db.query(CountyInsight).filter(CountyInsight.county_code == county_code)
    insight: CountyInsight | None
    if year is not None:
        insight = q.filter(CountyInsight.year == year).first()
    else:
        # "Latest available" must mean the latest COMPLETE year. A partial
        # current-year row reports a part-year total and a fabricated ~-50%
        # year-over-year swing (a full year vs. a few months), so exclude the
        # current calendar year — matching generate_insights, which only
        # writes cards for years < the current one (_EXCLUDE_CURRENT_YEAR_SQL).
        current_year = date.today().year
        insight = (
            q.filter(CountyInsight.year < current_year)
            .order_by(CountyInsight.year.desc())
            .first()
        )
        if insight is None:
            # No complete-year card exists yet — serve whatever is there
            # rather than 404. Should be rare; the generator produces
            # complete-year cards only.
            insight = q.order_by(CountyInsight.year.desc()).first()
    if insight is None:
        raise HTTPException(
            status_code=404,
            detail=f"No insight data found for '{county_slug}'"
                   + (f" year={year}" if year else "")
                   + ". Run etl/generate_insights.py first.",
        )

    # County name for the response
    county: County | None = (
        db.query(County).filter(County.code == county_code).first()
    )
    county_name = county.name if county else county_slug

    return {
        "county_name": county_name,
        "year": insight.year,
        "total_crashes": insight.total_crashes,
        "total_killed": insight.total_killed,
        "total_injured": insight.total_injured,
        "crash_rate_per_capita": insight.crash_rate_per_capita,
        "top_cause": insight.top_cause,
        "top_cause_pct": insight.top_cause_pct,
        "yoy_change_pct": insight.yoy_change_pct,
        "peak_hour": insight.peak_hour,
        "dui_pct": insight.dui_pct,
        "narrative": insight.narrative,
        "generated_at": (
            insight.generated_at.isoformat() if insight.generated_at else None
        ),
    }
