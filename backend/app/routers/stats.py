"""Aggregate crash stats, dispatched to the right materialized view."""

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import Column, Float, Integer, MetaData, SmallInteger, String, Table, func, select
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
    years_from_date_range,
)
from app.models import County
from app.schemas.stats import (
    AgeBracketRow,
    AtFaultAgeBracketRow,
    AtFaultGenderRow,
    BatchStatsRequest,
    CauseRow,
    CountyRow,
    DayOfWeekRow,
    GenderRow,
    GrandTotal,
    HourRow,
    MonthRow,
    RateRow,
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

# Per at-fault-party demographic aggregates. Backs ?group_by=at_fault_gender
# / at_fault_age_bracket. Source: crash_parties WHERE at_fault=TRUE, JOINed
# to crashes on (collision_id, data_source). Columns must mirror migration
# f8a1b2c3d4e5_add_mv_at_fault_parties_by_demographics.
mv_at_fault = Table(
    "mv_at_fault_parties_by_demographics", _metadata,
    Column("county_code", SmallInteger),
    Column("crash_year", SmallInteger),
    Column("severity", String),
    Column("gender", String),
    Column("age_bracket", String),
    Column("party_count", Integer),
    Column("fatal_party_count", Integer),
)

mv_month = Table(
    "mv_crashes_by_month", _metadata,
    Column("county_code", SmallInteger),
    Column("crash_year", SmallInteger),
    Column("crash_month", SmallInteger),
    Column("severity", String),
    Column("canonical_cause", String),
    Column("crash_count", Integer),
    Column("total_killed", Integer),
    Column("total_injured", Integer),
)

mv_rates = Table(
    "mv_crash_rates", _metadata,
    Column("county_code", SmallInteger),
    Column("crash_year", SmallInteger),
    Column("severity", String),
    Column("total_crashes", Integer),
    Column("total_killed", Integer),
    Column("total_injured", Integer),
    Column("per_100k_population", Float),
    Column("per_10k_licensed_drivers", Float),
    Column("per_100_road_miles", Float),
    Column("per_100k_aadt", Float),
    Column("per_10k_vehicles", Float),
)


mv_wide = Table(
    "mv_crashes_wide", _metadata,
    Column("county_code", SmallInteger),
    Column("crash_year", SmallInteger),
    Column("severity", String),
    Column("canonical_cause", String),
    Column("canonical_weather", String),
    Column("canonical_lighting", String),
    Column("canonical_collision_type", String),
    Column("is_highway", SmallInteger),
    Column("f_alcohol", SmallInteger),
    Column("f_distracted", SmallInteger),
    Column("f_pedestrian", SmallInteger),
    Column("f_cyclist", SmallInteger),
    Column("f_drug", SmallInteger),
    Column("f_hit_run", SmallInteger),
    Column("age_bracket", SmallInteger),
    Column("day_of_week_num", SmallInteger),
    Column("crash_month", SmallInteger),
    Column("crash_hour", SmallInteger),
    Column("crash_count", Integer),
    Column("total_killed", Integer),
    Column("total_injured", Integer),
)

_AGE_BRACKET_MAP = {
    (16, 21): 1, (22, 34): 2, (35, 49): 3, (50, 64): 4, (65, 200): 5,
}

_limiter = Limiter(key_func=get_remote_address)


def _pick_view(group_by: str | None, has_cause_filter: bool):
    if group_by == "hour":
        return mv_hour
    if group_by == "month":
        return mv_month
    if group_by == "day_of_week":
        return mv_wide
    if group_by == "cause" or has_cause_filter:
        return mv_cause
    return mv_year


def _apply_wide_filters(stmt, years, county_codes, severities, causes,
                         weather_v, lighting_v, collision_type_v, road_type_v,
                         alcohol_v=None, distracted_v=None, pedestrian_v=None,
                         cyclist_v=None, drug_v=None, hit_run_v=None,
                         driver_age_v=None):
    w = mv_wide
    if years:
        stmt = stmt.where(w.c.crash_year.in_(years))
    if county_codes:
        stmt = stmt.where(w.c.county_code.in_(county_codes))
    if severities:
        stmt = stmt.where(w.c.severity.in_(severities))
    if causes:
        stmt = stmt.where(w.c.canonical_cause.in_(causes))
    if weather_v:
        stmt = stmt.where(w.c.canonical_weather.in_(weather_v))
    if lighting_v:
        stmt = stmt.where(w.c.canonical_lighting.in_(lighting_v))
    if collision_type_v:
        stmt = stmt.where(w.c.canonical_collision_type.in_(collision_type_v))
    if road_type_v is not None:
        stmt = stmt.where(w.c.is_highway == (1 if road_type_v else 0))
    if alcohol_v is not None:
        stmt = stmt.where(w.c.f_alcohol == (1 if alcohol_v else 0))
    if distracted_v is not None:
        stmt = stmt.where(w.c.f_distracted == (1 if distracted_v else 0))
    if pedestrian_v is not None:
        stmt = stmt.where(w.c.f_pedestrian == (1 if pedestrian_v else 0))
    if cyclist_v is not None:
        stmt = stmt.where(w.c.f_cyclist == (1 if cyclist_v else 0))
    if drug_v is not None:
        stmt = stmt.where(w.c.f_drug == (1 if drug_v else 0))
    if hit_run_v is not None:
        stmt = stmt.where(w.c.f_hit_run == (1 if hit_run_v else 0))
    if driver_age_v is not None:
        bracket = _AGE_BRACKET_MAP.get(driver_age_v)
        if bracket is not None:
            stmt = stmt.where(w.c.age_bracket == bracket)
    return stmt


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


def _run_group_query(
    group_by: str | None,
    years: list[int] | None,
    county_codes: list[int] | None,
    severities: list[str] | None,
    causes: list[str] | None,
    db: Session,
    *,
    alcohol_v=None,
    distracted_v=None,
    pedestrian_v=None,
    cyclist_v=None,
    drug_v=None,
    driver_age_v=None,
    weather_v=None,
    lighting_v=None,
    collision_type_v=None,
    road_type_v=None,
    hit_run_v=None,
) -> list[dict] | dict:
    """Execute the appropriate query for the given group_by value and filters.

    This contains all query dispatch logic extracted from the stats() endpoint.
    """
    has_involvement = any(v is not None for v in [
        alcohol_v, distracted_v, pedestrian_v, cyclist_v, drug_v, driver_age_v,
        weather_v, lighting_v, collision_type_v, road_type_v, hit_run_v,
    ])
    has_condition_group = group_by in ("weather", "lighting", "collision_type")

    def _raw_preds():
        return build_crash_predicates(
            years=years,
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

    if has_involvement and group_by in ("gender", "age_bracket", "at_fault_gender", "at_fault_age_bracket"):
        raise FilterError(
            "involvement",
            "Involvement filters cannot be combined with demographic group_by values.",
        )

    if group_by in ("gender", "age_bracket", "at_fault_gender", "at_fault_age_bracket") and causes:
        raise FilterError(
            "cause",
            "cause filter is not supported with demographic group_by values "
            "(gender, age_bracket, at_fault_gender, at_fault_age_bracket) — "
            "those views don't carry canonical_cause.",
        )

    view = _pick_view(group_by, has_cause_filter=bool(causes))

    # When involvement/condition filters or condition group_by values are
    # active, use mv_crashes_wide (~1.7M rows) instead of the raw crashes
    # table (11M rows). All booleans and age brackets are in the GROUP BY,
    # so any combination of filters works with simple WHERE clauses.
    if has_involvement or has_condition_group:
        w = mv_wide
        cc = func.sum(w.c.crash_count)

        def _wide_query(stmt):
            return _apply_wide_filters(
                stmt, years, county_codes, severities, causes,
                weather_v, lighting_v, collision_type_v, road_type_v,
                alcohol_v, distracted_v, pedestrian_v, cyclist_v,
                drug_v, hit_run_v, driver_age_v,
            )

        if group_by is None:
            stmt = _wide_query(select(
                func.coalesce(cc, 0).label("total_crashes"),
                func.coalesce(func.sum(w.c.total_killed), 0).label("total_killed"),
                func.coalesce(func.sum(w.c.total_injured), 0).label("total_injured"),
            ))
            row = db.execute(stmt).one()
            return GrandTotal(total_crashes=row.total_crashes, total_killed=row.total_killed, total_injured=row.total_injured).model_dump()

        if group_by == "county":
            stmt = _wide_query(
                select(
                    w.c.county_code,
                    County.name.label("county_name"),
                    func.coalesce(cc, 0).label("crash_count"),
                    func.coalesce(func.sum(w.c.total_killed), 0).label("total_killed"),
                    func.coalesce(func.sum(w.c.total_injured), 0).label("total_injured"),
                )
                .join(County, County.code == w.c.county_code)
                .group_by(w.c.county_code, County.name)
                .order_by(cc.desc())
            )
            rows = db.execute(stmt).all()
            return [CountyRow(county_code=r.county_code, county_name=r.county_name, crash_count=r.crash_count, total_killed=r.total_killed, total_injured=r.total_injured).model_dump() for r in rows]

        if group_by == "year":
            stmt = _wide_query(
                select(
                    w.c.crash_year.label("year"),
                    func.coalesce(cc, 0).label("crash_count"),
                    func.coalesce(func.sum(w.c.total_killed), 0).label("total_killed"),
                    func.coalesce(func.sum(w.c.total_injured), 0).label("total_injured"),
                )
                .group_by(w.c.crash_year)
                .order_by(w.c.crash_year)
            )
            rows = db.execute(stmt).all()
            return [YearRow(year=r.year, crash_count=r.crash_count, total_killed=r.total_killed, total_injured=r.total_injured).model_dump() for r in rows]

        if group_by == "cause":
            stmt = _wide_query(
                select(
                    w.c.canonical_cause,
                    func.coalesce(cc, 0).label("crash_count"),
                    func.coalesce(func.sum(w.c.total_killed), 0).label("total_killed"),
                    func.coalesce(func.sum(w.c.total_injured), 0).label("total_injured"),
                )
                .group_by(w.c.canonical_cause)
                .order_by(cc.desc())
            )
            rows = db.execute(stmt).all()
            return [CauseRow(canonical_cause=r.canonical_cause, crash_count=r.crash_count, total_killed=r.total_killed, total_injured=r.total_injured).model_dump() for r in rows]

        if group_by == "severity":
            stmt = _wide_query(
                select(
                    w.c.severity,
                    func.coalesce(cc, 0).label("crash_count"),
                    func.coalesce(func.sum(w.c.total_killed), 0).label("total_killed"),
                    func.coalesce(func.sum(w.c.total_injured), 0).label("total_injured"),
                )
                .group_by(w.c.severity)
                .order_by(cc.desc())
            )
            rows = db.execute(stmt).all()
            return [SeverityRow(severity=r.severity, crash_count=r.crash_count, total_killed=r.total_killed, total_injured=r.total_injured).model_dump() for r in rows]

        if group_by == "weather":
            stmt = _wide_query(
                select(
                    w.c.canonical_weather.label("value"),
                    func.coalesce(cc, 0).label("crash_count"),
                )
                .group_by(w.c.canonical_weather)
                .order_by(cc.desc())
            )
            rows = db.execute(stmt).all()
            return [{"value": r.value, "crash_count": r.crash_count} for r in rows]

        if group_by == "lighting":
            stmt = _wide_query(
                select(
                    w.c.canonical_lighting.label("value"),
                    func.coalesce(cc, 0).label("crash_count"),
                )
                .group_by(w.c.canonical_lighting)
                .order_by(cc.desc())
            )
            rows = db.execute(stmt).all()
            return [{"value": r.value, "crash_count": r.crash_count} for r in rows]

        if group_by == "collision_type":
            stmt = _wide_query(
                select(
                    w.c.canonical_collision_type.label("value"),
                    func.coalesce(cc, 0).label("crash_count"),
                )
                .group_by(w.c.canonical_collision_type)
                .order_by(cc.desc())
            )
            rows = db.execute(stmt).all()
            return [{"value": r.value, "crash_count": r.crash_count} for r in rows]

        if group_by == "rate":
            raise FilterError("involvement", "Involvement filters are not supported with group_by=rate.")

        if group_by == "hour":
            stmt = _wide_query(
                select(
                    w.c.crash_hour.label("hour"),
                    func.coalesce(cc, 0).label("crash_count"),
                )
                .where(w.c.crash_hour.isnot(None))
                .group_by(w.c.crash_hour)
                .order_by(w.c.crash_hour)
            )
            rows = db.execute(stmt).all()
            return [HourRow(hour=r.hour, crash_count=r.crash_count).model_dump() for r in rows]

        if group_by == "month":
            stmt = _wide_query(
                select(
                    w.c.crash_month.label("month"),
                    func.coalesce(cc, 0).label("crash_count"),
                    func.coalesce(func.sum(w.c.total_killed), 0).label("total_killed"),
                    func.coalesce(func.sum(w.c.total_injured), 0).label("total_injured"),
                )
                .where(w.c.crash_month.isnot(None))
                .group_by(w.c.crash_month)
                .order_by(w.c.crash_month)
            )
            rows = db.execute(stmt).all()
            return [MonthRow(month=r.month, crash_count=r.crash_count, total_killed=r.total_killed, total_injured=r.total_injured).model_dump() for r in rows]

        if group_by == "day_of_week":
            stmt = _wide_query(
                select(
                    w.c.day_of_week_num.label("day_of_week"),
                    func.coalesce(cc, 0).label("crash_count"),
                )
                .where(w.c.day_of_week_num.isnot(None))
                .group_by(w.c.day_of_week_num)
                .order_by(w.c.day_of_week_num)
            )
            rows = db.execute(stmt).all()
            return [DayOfWeekRow(day_of_week=r.day_of_week, crash_count=r.crash_count).model_dump() for r in rows]

    # ---- Standard MV-backed paths (no involvement filters) ----

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

    # --- group_by=month ---
    if group_by == "month":
        stmt = (
            select(
                view.c.crash_month.label("month"),
                func.sum(view.c.crash_count).label("crash_count"),
                func.sum(view.c.total_killed).label("total_killed"),
                func.sum(view.c.total_injured).label("total_injured"),
            )
            .group_by(view.c.crash_month)
            .order_by(view.c.crash_month)
        )
        stmt = _apply_filters(stmt, view, years, county_codes, severities, causes)
        rows = db.execute(stmt).all()
        return [
            MonthRow(
                month=r.month,
                crash_count=r.crash_count,
                total_killed=r.total_killed,
                total_injured=r.total_injured,
            ).model_dump()
            for r in rows
        ]

    # --- group_by=day_of_week ---
    if group_by == "day_of_week":
        stmt = (
            select(
                view.c.day_of_week_num.label("day_of_week"),
                func.sum(view.c.crash_count).label("crash_count"),
            )
            .where(view.c.day_of_week_num.isnot(None))
            .group_by(view.c.day_of_week_num)
            .order_by(view.c.day_of_week_num)
        )
        stmt = _apply_filters(stmt, view, years, county_codes, severities, causes)
        rows = db.execute(stmt).all()
        return [
            DayOfWeekRow(
                day_of_week=r.day_of_week,
                crash_count=r.crash_count,
            ).model_dump()
            for r in rows
        ]


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

    # --- group_by=rate (mv_crash_rates — per-capita normalization) ---
    if group_by == "rate":
        v = mv_rates
        stmt = (
            select(
                v.c.county_code,
                County.name.label("county_name"),
                v.c.crash_year.label("year"),
                v.c.severity,
                v.c.total_crashes,
                v.c.total_killed,
                v.c.total_injured,
                v.c.per_100k_population,
                v.c.per_10k_licensed_drivers,
                v.c.per_100_road_miles,
                v.c.per_100k_aadt,
                v.c.per_10k_vehicles,
            )
            .select_from(v.join(County, County.code == v.c.county_code))
            .order_by(v.c.crash_year.desc(), v.c.county_code)
        )
        if years:
            stmt = stmt.where(v.c.crash_year.in_(years))
        if county_codes:
            stmt = stmt.where(v.c.county_code.in_(county_codes))
        if severities:
            stmt = stmt.where(v.c.severity.in_(severities))
        rows = db.execute(stmt).all()
        return [
            RateRow(
                county_code=r.county_code,
                county_name=r.county_name,
                year=r.year,
                severity=r.severity,
                total_crashes=r.total_crashes,
                total_killed=r.total_killed,
                total_injured=r.total_injured,
                per_100k_population=r.per_100k_population,
                per_10k_licensed_drivers=r.per_10k_licensed_drivers,
                per_100_road_miles=r.per_100_road_miles,
                per_100k_aadt=r.per_100k_aadt,
                per_10k_vehicles=r.per_10k_vehicles,
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

    # --- group_by=at_fault_gender (at-fault-parties MV) ---
    if group_by == "at_fault_gender":
        v = mv_at_fault
        stmt = (
            select(
                v.c.gender,
                func.sum(v.c.party_count).label("party_count"),
                func.sum(v.c.fatal_party_count).label("fatal_party_count"),
            )
            .group_by(v.c.gender)
            .order_by(func.sum(v.c.party_count).desc())
        )
        if years:
            stmt = stmt.where(v.c.crash_year.in_(years))
        if county_codes:
            stmt = stmt.where(v.c.county_code.in_(county_codes))
        if severities:
            stmt = stmt.where(v.c.severity.in_(severities))
        rows = db.execute(stmt).all()
        return [
            AtFaultGenderRow(
                gender=r.gender,
                party_count=r.party_count,
                fatal_party_count=r.fatal_party_count,
            ).model_dump()
            for r in rows
        ]

    # --- group_by=at_fault_age_bracket (at-fault-parties MV) ---
    if group_by == "at_fault_age_bracket":
        v = mv_at_fault
        stmt = (
            select(
                v.c.age_bracket,
                func.sum(v.c.party_count).label("party_count"),
                func.sum(v.c.fatal_party_count).label("fatal_party_count"),
            )
            .group_by(v.c.age_bracket)
            .order_by(func.sum(v.c.party_count).desc())
        )
        if years:
            stmt = stmt.where(v.c.crash_year.in_(years))
        if county_codes:
            stmt = stmt.where(v.c.county_code.in_(county_codes))
        if severities:
            stmt = stmt.where(v.c.severity.in_(severities))
        rows = db.execute(stmt).all()
        return [
            AtFaultAgeBracketRow(
                age_bracket=r.age_bracket,
                party_count=r.party_count,
                fatal_party_count=r.fatal_party_count,
            ).model_dump()
            for r in rows
        ]

    # Unreachable — pattern validator catches bad values.
    raise HTTPException(status_code=500, detail="Unreachable group_by branch")


@router.get("/stats")
@_limiter.limit("1000/minute;20000/hour")
def stats(
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
    group_by: str | None = Query(
        None,
        pattern="^(county|year|cause|hour|month|day_of_week|severity|gender|age_bracket|at_fault_gender|at_fault_age_bracket|rate|weather|lighting|collision_type)$",
    ),
    db: Session = Depends(get_db),
):
    """Aggregated stats from materialized views.

    `group_by` dispatches to one of four views (see `docs/db-schema.md`):
      - `hour` -> mv_crashes_by_hour (counts only, no killed/injured)
      - `cause` OR any cause filter -> mv_crashes_by_cause
      - `gender` / `age_bracket` -> mv_crash_victims_by_demographics
        (counts VICTIMS, not crashes — see GenderRow docstring)
      - `at_fault_gender` / `at_fault_age_bracket` ->
        mv_at_fault_parties_by_demographics (counts AT-FAULT PARTIES —
        typically drivers — not victims and not crashes)
      - everything else -> mv_crashes_by_year

    `alcohol` / `distracted` are not supported here (crash views don't carry
    those columns). Use `/api/crashes` with those filters for drill-down.
    `cause` filter is incompatible with `group_by=gender|age_bracket|
    at_fault_gender|at_fault_age_bracket` because the demographic views
    don't carry canonical_cause.

    `start`/`end` (YYYY-MM) are accepted but rounded outward to year
    boundaries here, since the underlying materialized views aggregate by
    year. For month-precise filtering, use `/api/crashes` or
    `/api/crashes/heatmap`.
    """
    response.headers["Cache-Control"] = "public, max-age=3600, stale-while-revalidate=86400"

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

    date_range = parse_date_range(start, end)
    years = years_from_date_range(date_range) if date_range is not None else parse_year(year)
    county_codes = parse_county_codes(county, get_slug_map(db)) if county else None
    severities = parse_severity(severity)
    causes = parse_cause(cause)

    return _run_group_query(
        group_by, years, county_codes, severities, causes, db,
        alcohol_v=alcohol_v,
        distracted_v=distracted_v,
        pedestrian_v=pedestrian_v,
        cyclist_v=cyclist_v,
        drug_v=drug_v,
        driver_age_v=driver_age_v,
        weather_v=weather_v,
        lighting_v=lighting_v,
        collision_type_v=collision_type_v,
        road_type_v=road_type_v,
        hit_run_v=hit_run_v,
    )


ALLOWED_GROUPS = {
    "year", "hour", "cause", "severity", "month", "day_of_week",
    "gender", "age_bracket", "at_fault_gender", "at_fault_age_bracket",
    "rate", "county", "weather", "lighting", "collision_type",
}


@router.post("/stats/batch")
@_limiter.limit("1000/minute;20000/hour")
def stats_batch(
    request: Request,
    body: BatchStatsRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    """Run multiple group_by queries in one request."""
    response.headers["Cache-Control"] = "public, max-age=3600, stale-while-revalidate=86400"

    invalid = set(body.groups) - ALLOWED_GROUPS
    if invalid:
        raise FilterError("groups", f"Invalid group_by values: {', '.join(sorted(invalid))}")

    date_range = parse_date_range(body.start, body.end)
    years = years_from_date_range(date_range) if date_range else parse_year(body.year)
    county_codes = parse_county_codes(body.county, get_slug_map(db)) if body.county else None
    severities = parse_severity(body.severity)
    causes = parse_cause(body.cause)

    kwargs = dict(
        alcohol_v=parse_bool_flag(body.alcohol, "alcohol"),
        distracted_v=parse_bool_flag(body.distracted, "distracted"),
        pedestrian_v=parse_bool_flag(body.pedestrian, "pedestrian"),
        cyclist_v=parse_bool_flag(body.cyclist, "cyclist"),
        drug_v=parse_bool_flag(body.drug, "drug"),
        driver_age_v=parse_driver_age(body.driver_age),
        weather_v=parse_weather(body.weather),
        lighting_v=parse_lighting(body.lighting),
        collision_type_v=parse_collision_type(body.collision_type),
        road_type_v=parse_road_type(body.road_type),
        hit_run_v=parse_hit_run(body.hit_run),
    )

    results = {}
    for group in body.groups:
        try:
            results[group] = _run_group_query(
                group, years, county_codes, severities, causes, db, **kwargs,
            )
        except FilterError as e:
            results[group] = {"error": e.detail, "filter": e.filter}

    return results
