"""Aggregate crash stats, dispatched to the right materialized view."""

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import Column, Integer, MetaData, SmallInteger, String, Table, func, select
from sqlalchemy.orm import Session

from app.county_slug_map import get_slug_map
from app.database import get_db
from app.filters import (
    FilterError,
    parse_cause,
    parse_county_codes,
    parse_severity,
    parse_year,
)
from app.models import County
from app.schemas.stats import (
    AgeBracketRow,
    CauseRow,
    CountyRow,
    GenderRow,
    GrandTotal,
    HourRow,
    SeverityRow,
    YearRow,
)

router = APIRouter(tags=["stats"])

# Materialized views declared explicitly — we do NOT use `autoload_with=engine`
# because that would open a DB connection at module import time, which breaks
# pure-unit tests and CI jobs without DB access. The columns here must mirror
# `backend/migrations/versions/f3d4e5f6a7b8_add_stats_materialized_views.py`;
# if that migration changes, update this block too.
_metadata = MetaData()

mv_year = Table(
    "mv_crashes_by_year", _metadata,
    Column("county_code", SmallInteger),
    Column("crash_year", SmallInteger),
    Column("severity", String),
    Column("crash_count", Integer),
    Column("total_killed", Integer),
    Column("total_injured", Integer),
)

mv_cause = Table(
    "mv_crashes_by_cause", _metadata,
    Column("county_code", SmallInteger),
    Column("crash_year", SmallInteger),
    Column("severity", String),
    Column("canonical_cause", String),
    Column("crash_count", Integer),
    Column("total_killed", Integer),
    Column("total_injured", Integer),
)

mv_hour = Table(
    "mv_crashes_by_hour", _metadata,
    Column("county_code", SmallInteger),
    Column("crash_year", SmallInteger),
    Column("severity", String),
    Column("canonical_cause", String),
    Column("crash_hour", SmallInteger),
    Column("crash_count", Integer),
)

# Per-victim demographic aggregates. Backs ?group_by=gender / age_bracket.
# Source: crash_victims JOINed to crashes on (collision_id, data_source).
# Columns must mirror migration b5e9d3f1c8a4_add_mv_crash_victims_by_demographics.
mv_victims = Table(
    "mv_crash_victims_by_demographics", _metadata,
    Column("county_code", SmallInteger),
    Column("crash_year", SmallInteger),
    Column("severity", String),
    Column("gender", String),
    Column("age_bracket", String),
    Column("victim_count", Integer),
    Column("fatal_victim_count", Integer),
)


def _pick_view(group_by: str | None, has_cause_filter: bool):
    if group_by == "hour":
        return mv_hour
    if group_by == "cause" or has_cause_filter:
        return mv_cause
    return mv_year


def _apply_filters(stmt, view, years, county_codes, severities, causes):
    if years:
        stmt = stmt.where(view.c.crash_year.in_(years))
    if county_codes:
        stmt = stmt.where(view.c.county_code.in_(county_codes))
    if severities:
        stmt = stmt.where(view.c.severity.in_(severities))
    if causes:
        stmt = stmt.where(view.c.canonical_cause.in_(causes))
    return stmt


@router.get("/stats")
def stats(
    response: Response,
    year: str | None = Query(None),
    county: str | None = Query(None),
    severity: str | None = Query(None),
    cause: str | None = Query(None),
    alcohol: str | None = Query(None),
    distracted: str | None = Query(None),
    group_by: str | None = Query(
        None,
        pattern="^(county|year|cause|hour|severity|gender|age_bracket)$",
    ),
    db: Session = Depends(get_db),
):
    """Aggregated stats from materialized views.

    `group_by` dispatches to one of four views (see `docs/db-schema.md`):
      - `hour` -> mv_crashes_by_hour (counts only, no killed/injured)
      - `cause` OR any cause filter -> mv_crashes_by_cause
      - `gender` / `age_bracket` -> mv_crash_victims_by_demographics
        (counts VICTIMS, not crashes — see GenderRow docstring)
      - everything else -> mv_crashes_by_year

    `alcohol` / `distracted` are not supported here (crash views don't carry
    those columns). Use `/api/crashes` with those filters for drill-down.
    `cause` filter is incompatible with `group_by=gender|age_bracket`
    because the victim-demographics view doesn't carry canonical_cause.
    """
    response.headers["Cache-Control"] = "public, max-age=300"

    if alcohol is not None and alcohol != "":
        raise FilterError(
            "alcohol",
            "Alcohol filter is not supported on /api/stats. Use /api/crashes?alcohol=true.",
        )
    if distracted is not None and distracted != "":
        raise FilterError(
            "distracted",
            "Distracted filter is not supported on /api/stats. Use /api/crashes?distracted=true.",
        )

    years = parse_year(year)
    county_codes = parse_county_codes(county, get_slug_map(db)) if county else None
    severities = parse_severity(severity)
    causes = parse_cause(cause)

    if group_by in ("gender", "age_bracket") and causes:
        raise FilterError(
            "cause",
            "cause filter is not supported with group_by=gender or age_bracket "
            "(victim-demographics view doesn't carry canonical_cause).",
        )

    view = _pick_view(group_by, has_cause_filter=bool(causes))

    # --- grand total (no group_by) ---
    if group_by is None:
        stmt = select(
            func.coalesce(func.sum(view.c.crash_count), 0).label("total_crashes"),
            func.coalesce(func.sum(view.c.total_killed), 0).label("total_killed"),
            func.coalesce(func.sum(view.c.total_injured), 0).label("total_injured"),
        )
        stmt = _apply_filters(stmt, view, years, county_codes, severities, causes)
        row = db.execute(stmt).one()
        return GrandTotal(
            total_crashes=row.total_crashes,
            total_killed=row.total_killed,
            total_injured=row.total_injured,
        ).model_dump()

    # --- group_by=county ---
    if group_by == "county":
        stmt = (
            select(
                view.c.county_code,
                County.name.label("county_name"),
                func.sum(view.c.crash_count).label("crash_count"),
                func.sum(view.c.total_killed).label("total_killed"),
                func.sum(view.c.total_injured).label("total_injured"),
            )
            .select_from(view.join(County, County.code == view.c.county_code))
            .group_by(view.c.county_code, County.name)
            .order_by(func.sum(view.c.crash_count).desc())
        )
        stmt = _apply_filters(stmt, view, years, county_codes, severities, causes)
        rows = db.execute(stmt).all()
        return [
            CountyRow(
                county_code=r.county_code,
                county_name=r.county_name,
                crash_count=r.crash_count,
                total_killed=r.total_killed,
                total_injured=r.total_injured,
            ).model_dump()
            for r in rows
        ]

    # --- group_by=year ---
    if group_by == "year":
        stmt = (
            select(
                view.c.crash_year.label("year"),
                func.sum(view.c.crash_count).label("crash_count"),
                func.sum(view.c.total_killed).label("total_killed"),
                func.sum(view.c.total_injured).label("total_injured"),
            )
            .group_by(view.c.crash_year)
            .order_by(view.c.crash_year)
        )
        stmt = _apply_filters(stmt, view, years, county_codes, severities, causes)
        rows = db.execute(stmt).all()
        return [
            YearRow(
                year=r.year,
                crash_count=r.crash_count,
                total_killed=r.total_killed,
                total_injured=r.total_injured,
            ).model_dump()
            for r in rows
        ]

    # --- group_by=cause ---
    if group_by == "cause":
        stmt = (
            select(
                view.c.canonical_cause,
                func.sum(view.c.crash_count).label("crash_count"),
                func.sum(view.c.total_killed).label("total_killed"),
                func.sum(view.c.total_injured).label("total_injured"),
            )
            .group_by(view.c.canonical_cause)
            .order_by(func.sum(view.c.crash_count).desc())
        )
        stmt = _apply_filters(stmt, view, years, county_codes, severities, causes)
        rows = db.execute(stmt).all()
        return [
            CauseRow(
                canonical_cause=r.canonical_cause,
                crash_count=r.crash_count,
                total_killed=r.total_killed,
                total_injured=r.total_injured,
            ).model_dump()
            for r in rows
        ]

    # --- group_by=hour (no killed/injured columns on this view) ---
    if group_by == "hour":
        stmt = (
            select(
                view.c.crash_hour.label("hour"),
                func.sum(view.c.crash_count).label("crash_count"),
            )
            .group_by(view.c.crash_hour)
            .order_by(view.c.crash_hour)
        )
        stmt = _apply_filters(stmt, view, years, county_codes, severities, causes)
        rows = db.execute(stmt).all()
        return [HourRow(hour=r.hour, crash_count=r.crash_count).model_dump() for r in rows]

    # --- group_by=severity ---
    if group_by == "severity":
        stmt = (
            select(
                view.c.severity,
                func.sum(view.c.crash_count).label("crash_count"),
                func.sum(view.c.total_killed).label("total_killed"),
                func.sum(view.c.total_injured).label("total_injured"),
            )
            .group_by(view.c.severity)
            .order_by(func.sum(view.c.crash_count).desc())
        )
        stmt = _apply_filters(stmt, view, years, county_codes, severities, causes)
        rows = db.execute(stmt).all()
        return [
            SeverityRow(
                severity=r.severity,
                crash_count=r.crash_count,
                total_killed=r.total_killed,
                total_injured=r.total_injured,
            ).model_dump()
            for r in rows
        ]

    # --- group_by=gender (victim-demographics MV) ---
    if group_by == "gender":
        v = mv_victims
        stmt = (
            select(
                v.c.gender,
                func.sum(v.c.victim_count).label("victim_count"),
                func.sum(v.c.fatal_victim_count).label("fatal_victim_count"),
            )
            .group_by(v.c.gender)
            .order_by(func.sum(v.c.victim_count).desc())
        )
        if years:
            stmt = stmt.where(v.c.crash_year.in_(years))
        if county_codes:
            stmt = stmt.where(v.c.county_code.in_(county_codes))
        if severities:
            stmt = stmt.where(v.c.severity.in_(severities))
        rows = db.execute(stmt).all()
        return [
            GenderRow(
                gender=r.gender,
                victim_count=r.victim_count,
                fatal_victim_count=r.fatal_victim_count,
            ).model_dump()
            for r in rows
        ]

    # --- group_by=age_bracket (victim-demographics MV) ---
    if group_by == "age_bracket":
        v = mv_victims
        stmt = (
            select(
                v.c.age_bracket,
                func.sum(v.c.victim_count).label("victim_count"),
                func.sum(v.c.fatal_victim_count).label("fatal_victim_count"),
            )
            .group_by(v.c.age_bracket)
            .order_by(func.sum(v.c.victim_count).desc())
        )
        if years:
            stmt = stmt.where(v.c.crash_year.in_(years))
        if county_codes:
            stmt = stmt.where(v.c.county_code.in_(county_codes))
        if severities:
            stmt = stmt.where(v.c.severity.in_(severities))
        rows = db.execute(stmt).all()
        return [
            AgeBracketRow(
                age_bracket=r.age_bracket,
                victim_count=r.victim_count,
                fatal_victim_count=r.fatal_victim_count,
            ).model_dump()
            for r in rows
        ]

    # Unreachable — pattern validator catches bad values.
    raise HTTPException(status_code=500, detail="Unreachable group_by branch")
