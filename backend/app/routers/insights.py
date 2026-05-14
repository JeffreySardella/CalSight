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

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.county_slug_map import get_code, get_slug_map
from app.database import get_db
from app.models import County, CountyInsight, CountyInsightCard, StatewideInsight
from app.schemas.context import CountyInsightCardOut, StatewideInsightOut

router = APIRouter(tags=["insights"])


@router.get("/insights/statewide", response_model=StatewideInsightOut)
def get_random_statewide_insight(
    response: Response,
    year: int | None = Query(None, description="Filter by year; omit for any year"),
    db: Session = Depends(get_db),
):
    """Return one random statewide insight card."""
    response.headers["Cache-Control"] = "public, max-age=3600, stale-while-revalidate=86400"
    q = db.query(StatewideInsight)
    if year is not None:
        q = q.filter(StatewideInsight.year == year)
    row = q.order_by(func.random()).first()
    if row is None:
        raise HTTPException(status_code=404, detail="No statewide insights found")
    return StatewideInsightOut.model_validate(row)


@router.get("/insight-cards/random", response_model=CountyInsightCardOut)
def get_random_county_insight_card(
    response: Response,
    county: str = Query(..., description="County slug, e.g. 'los-angeles'"),
    year: int | None = Query(None),
    db: Session = Depends(get_db),
):
    """Return one random insight card for a county."""
    response.headers["Cache-Control"] = "public, max-age=3600, stale-while-revalidate=86400"
    slug_map = get_slug_map(db)
    code = get_code(county, slug_map)
    if code is None:
        raise HTTPException(status_code=404, detail=f"County '{county}' not found")
    q = db.query(CountyInsightCard).filter(CountyInsightCard.county_code == code)
    if year is not None:
        q = q.filter(CountyInsightCard.year == year)
    row = q.order_by(func.random()).first()
    if row is None:
        raise HTTPException(status_code=404, detail="No insight cards found")
    return CountyInsightCardOut.model_validate(row)


@router.get("/insights/{county_slug}")
def get_insight(
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
    if year is not None:
        q = q.filter(CountyInsight.year == year)
    else:
        q = q.order_by(CountyInsight.year.desc())

    insight: CountyInsight | None = q.first()
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
