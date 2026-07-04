"""GET /api/stats/yoy-changes — year-over-year change ranking across counties.

Per-county insight cards already carry a single county's YoY delta; this
endpoint answers the statewide question — "which counties changed the most
between year X-1 and year X" — in one call, for a chosen metric.

Small-number discipline (see docs/data-storytelling-plan.md §3.6): tiny
baselines make percent changes meaningless (2 → 5 fatal crashes is +150% but
statistically noise). Rows whose baseline-year value is below a per-metric
threshold are flagged `small_baseline` and ranked after the rest — reported,
never hidden, but never presented as headline movers either.

Presentation is neutral: counts and percent changes, no "spike/surge/plunge"
labeling. A `partial_year` flag is set when the requested year is the current
calendar year, since that year's data is still accumulating.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import and_, case, func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import County, Crash

router = APIRouter(tags=["stats"])

_limiter = Limiter(key_func=get_remote_address)

MetricKey = Literal["crashes", "fatal_crashes", "killed", "injured"]

# Baseline-year minimums below which a percent change is flagged as noise-prone.
_MIN_BASELINE: dict[str, int] = {
    "crashes": 100,
    "fatal_crashes": 10,
    "killed": 10,
    "injured": 50,
}

# A trailing year holding fewer rows than this share of the prior year's is
# treated as not-yet-loaded (upstream ingest lag), not as a real collapse in
# crashes. Defaulting the comparison to such a year would rank every county
# at -100% — the exact small-number noise this endpoint exists to avoid.
_MIN_COVERAGE_RATIO = 0.2


def _default_year(db: Session) -> int:
    """Latest crash_year with meaningful coverage relative to the year before."""
    counts = {
        int(y): int(n)
        for y, n in db.execute(
            select(Crash.crash_year, func.count())
            .where(Crash.crash_year.isnot(None))
            .group_by(Crash.crash_year)
        ).all()
    }
    if not counts:
        return datetime.now(timezone.utc).year
    year = max(counts)
    while year - 1 in counts and counts[year] < _MIN_COVERAGE_RATIO * counts[year - 1]:
        year -= 1
    return year


class CountyChange(BaseModel):
    county_code: int
    county_name: str | None = None
    current: int
    previous: int
    abs_change: int
    #: Percent change vs the baseline year; null when the baseline is zero.
    pct_change: float | None = None
    #: True when the baseline-year value is below the metric's minimum —
    #: the percent change is reported but noise-prone.
    small_baseline: bool


class YoyChangesOut(BaseModel):
    metric: str
    year: int
    baseline_year: int
    #: True when `year` is the current calendar year (data still accumulating).
    partial_year: bool
    min_baseline: int
    rows: list[CountyChange]


def _metric_exprs(metric: str, year: int):
    """Return (current_expr, previous_expr) aggregates for the metric."""
    def year_case(y, value):
        return func.coalesce(func.sum(case((Crash.crash_year == y, value), else_=0)), 0)

    if metric == "fatal_crashes":
        value = case((Crash.severity == "Fatal", 1), else_=0)
    elif metric == "killed":
        value = func.coalesce(Crash.number_killed, 0)
    elif metric == "injured":
        value = func.coalesce(Crash.number_injured, 0)
    else:  # crashes
        value = 1

    return year_case(year, value), year_case(year - 1, value)


def compute_yoy_changes(db: Session, metric: str = "crashes", year: int | None = None) -> YoyChangesOut:
    """Per-county change between `year-1` and `year` for a metric, all counties.

    Ranked by |percent change| with small-baseline rows after the rest. Plain
    function so the API endpoint and the Ask-AI tool share one implementation.
    """
    if year is None:
        year = _default_year(db)

    current_expr, previous_expr = _metric_exprs(metric, year)

    stmt = (
        select(
            Crash.county_code.label("county_code"),
            County.name.label("county_name"),
            current_expr.label("current"),
            previous_expr.label("previous"),
        )
        .select_from(Crash)
        .join(County, County.code == Crash.county_code, isouter=True)
        .where(and_(Crash.crash_year.in_((year, year - 1)), Crash.county_code.isnot(None)))
        .group_by(Crash.county_code, County.name)
    )

    min_baseline = _MIN_BASELINE.get(metric, 100)
    rows: list[CountyChange] = []
    for r in db.execute(stmt).all():
        current = int(r.current or 0)
        previous = int(r.previous or 0)
        pct = round((current - previous) / previous * 100, 1) if previous > 0 else None
        rows.append(CountyChange(
            county_code=r.county_code,
            county_name=r.county_name,
            current=current,
            previous=previous,
            abs_change=current - previous,
            pct_change=pct,
            small_baseline=previous < min_baseline,
        ))

    # Solid-baseline rows first, each group ranked by |pct change| (None last).
    def sort_key(c: CountyChange):
        return (c.small_baseline, -(abs(c.pct_change) if c.pct_change is not None else -1))

    rows.sort(key=sort_key)

    return YoyChangesOut(
        metric=metric,
        year=year,
        baseline_year=year - 1,
        partial_year=year == datetime.now(timezone.utc).year,
        min_baseline=min_baseline,
        rows=rows,
    )


@router.get("/stats/yoy-changes", response_model=YoyChangesOut)
@_limiter.limit("120/minute;5000/hour")
def get_yoy_changes(
    request: Request,
    response: Response,
    metric: MetricKey = Query("crashes"),
    year: int | None = Query(None, ge=2002, le=2100, description="Comparison year; defaults to the latest year with meaningful data coverage"),
    db: Session = Depends(get_db),
):
    """Per-county YoY change ranking for a metric — see compute_yoy_changes."""
    response.headers["Cache-Control"] = "public, max-age=3600, stale-while-revalidate=86400"
    return compute_yoy_changes(db, metric=metric, year=year)
