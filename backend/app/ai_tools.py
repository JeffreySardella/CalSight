"""AI tool functions for function calling in the AskAI endpoint.

Each function takes a SQLAlchemy Session as its first argument, executes a
targeted DB query, and returns a JSON-serializable dict or list[dict].

Results are capped at 20 rows. County names are resolved to county codes via
the shared `_county_code` helper so callers can pass human-readable names.

Join safety: crash_parties and crash_victims always join to crashes on BOTH
(collision_id, data_source) — never collision_id alone (SWITRS and CCRS share
overlapping numeric IDs).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import and_, case, func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.models import (
    CalenviroScreen,
    County,
    Crash,
    CrashParty,
    CrashVictim,
    Demographic,
    Hospital,
    LicensedDriver,
    RoadMile,
    SchoolLocation,
    SpeedLimit,
    TractCes,
    TractCrashYear,
    TrafficVolume,
    UnemploymentRate,
    VehicleRegistration,
    Vmt,
    Weather,
)

logger = logging.getLogger(__name__)

_MAX_ROWS = 20

# Metrics accepted by rank_counties and get_trend. An off-enum metric must
# error instead of silently falling back to crash_count — the model would
# label plain crash totals with the requested metric's name and answer
# confidently wrong (audit M13). "total_crashes" is the name the
# TOOL_DEFINITIONS enum advertises; "crash_count" is the historical name —
# both mean a plain count.
_CRASH_METRICS = (
    "crash_count",
    "total_crashes",
    "total_killed",
    "total_injured",
    "fatal_crashes",
    "alcohol_crashes",
    "pedestrian_crashes",
)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _county_code(db: Session, name: str) -> int | None:
    """Resolve a county name (case-insensitive) to its integer county_code.

    Accepts exact names ("Los Angeles"), slugs ("los-angeles"), and
    partial matches as a last resort. Returns None if not found.
    """
    if not name:
        return None
    # Try exact match first (fast, uses index)
    row = db.query(County.code).filter(
        func.lower(County.name) == name.lower()
    ).first()
    if row:
        return row.code
    # Try slug -> name (replace hyphens with spaces)
    normalized = name.replace("-", " ")
    row = db.query(County.code).filter(
        func.lower(County.name) == normalized.lower()
    ).first()
    if row:
        return row.code
    return None


def _resolve_years(years: list[int] | None) -> list[int] | None:
    """Return years list or None (pass-through; callers may pass None)."""
    return years if years else None


def _row_to_dict(row: Any) -> dict:
    """Convert a SQLAlchemy Row/KeyedTuple/ORM instance to a plain dict."""
    if hasattr(row, "_mapping"):
        return dict(row._mapping)
    if hasattr(row, "__dict__"):
        return {k: v for k, v in row.__dict__.items() if not k.startswith("_")}
    return dict(row)


# ---------------------------------------------------------------------------
# 1. query_crashes
# ---------------------------------------------------------------------------

def query_crashes(
    db: Session,
    county: str | None = None,
    years: list[int] | None = None,
    severity: str | None = None,
    cause: str | None = None,
    is_highway: bool | None = None,
    is_freeway: bool | None = None,
    hit_run: bool | None = None,
    pedestrian_involved: bool | None = None,
    is_alcohol_involved: bool | None = None,
    is_distraction_involved: bool | None = None,
    weather: str | None = None,
    lighting: str | None = None,
    day_of_week: int | None = None,
    hour: int | None = None,
    group_by: str | None = None,
    limit: int = 10,
) -> list[dict]:
    """Aggregate crash counts with optional filtering and grouping.

    group_by accepts: county_name, crash_year, severity, canonical_cause,
    collision_type, weather, lighting, day_of_week, crash_hour.
    Returns up to min(limit, 20) rows.
    """
    limit = min(limit, _MAX_ROWS)

    # --- build WHERE predicates ---
    preds = []
    if county:
        code = _county_code(db, county)
        if code is None:
            # Never silently drop the filter: an unresolvable county would
            # return the 11M-row statewide total, which the model then
            # confidently cites as the county figure.
            return [{"error": f"County not found: {county}"}]
        preds.append(Crash.county_code == code)
    if years:
        preds.append(Crash.crash_year.in_(years))
    if severity:
        preds.append(Crash.severity == severity)
    if cause:
        preds.append(Crash.canonical_cause == cause)
    if is_highway is not None:
        preds.append(Crash.is_highway.is_(is_highway))
    if is_freeway is not None:
        preds.append(Crash.is_freeway.is_(is_freeway))
    if hit_run is not None:
        if hit_run:
            preds.append(Crash.hit_run.isnot(None))
        else:
            preds.append(Crash.hit_run.is_(None))
    if pedestrian_involved is not None:
        preds.append(Crash.pedestrian_involved.is_(pedestrian_involved))
    if is_alcohol_involved is not None:
        preds.append(Crash.is_alcohol_involved.is_(is_alcohol_involved))
    if is_distraction_involved is not None:
        preds.append(Crash.is_distraction_involved.is_(is_distraction_involved))
    if weather:
        preds.append(func.lower(Crash.weather) == weather.lower())
    if lighting:
        preds.append(func.lower(Crash.lighting) == lighting.lower())
    if day_of_week is not None:
        preds.append(Crash.day_of_week_num == day_of_week)
    if hour is not None:
        preds.append(Crash.crash_hour == hour)

    # --- valid group_by columns ---
    _GROUP_BY_MAP: dict[str, Any] = {
        "county_name": Crash.county_name,
        "county": Crash.county_name,
        "crash_year": Crash.crash_year,
        "year": Crash.crash_year,
        "severity": Crash.severity,
        "canonical_cause": Crash.canonical_cause,
        "cause": Crash.canonical_cause,
        "collision_type": Crash.collision_type,
        "weather": Crash.weather,
        "lighting": Crash.lighting,
        "day_of_week": Crash.day_of_week_num,
        "crash_hour": Crash.crash_hour,
        "hour": Crash.crash_hour,
        "month": Crash.crash_month,
        "crash_month": Crash.crash_month,
        "primary_road": Crash.primary_road,
        "road_condition": Crash.road_condition,
        "is_highway": Crash.is_highway,
    }

    if group_by and group_by in _GROUP_BY_MAP:
        col = _GROUP_BY_MAP[group_by]
        # grand_total is a window SUM over ALL groups matching the filters,
        # evaluated before the LIMIT — pct_of_total must be the share of the
        # filtered total, not of the top-N rows we happen to return ("LA is
        # X% of CA crashes" would otherwise read ~2x the true share).
        grand_total = func.sum(func.count(Crash.id)).over().label("grand_total")
        stmt = (
            select(
                col.label(group_by),
                func.count(Crash.id).label("crash_count"),
                func.sum(Crash.number_killed).label("total_killed"),
                func.sum(Crash.number_injured).label("total_injured"),
                grand_total,
            )
            .where(*preds)
            .group_by(col)
            .order_by(func.count(Crash.id).desc())
            .limit(limit)
        )
        rows = db.execute(stmt).fetchall()
        results = [_row_to_dict(r) for r in rows]
        total = int(results[0].get("grand_total") or 0) if results else 0
        for r in results:
            r.pop("grand_total", None)
            if total > 0:
                r["pct_of_total"] = round(r["crash_count"] / total * 100, 1)
                r["fatality_rate_pct"] = round(r["total_killed"] / r["crash_count"] * 100, 2) if r["crash_count"] > 0 else 0
        return results
    else:
        stmt = (
            select(
                func.count(Crash.id).label("crash_count"),
                func.sum(Crash.number_killed).label("total_killed"),
                func.sum(Crash.number_injured).label("total_injured"),
            )
            .where(*preds)
        )
        rows = db.execute(stmt).fetchall()
        results = [_row_to_dict(r) for r in rows]
        for r in results:
            if r["crash_count"] > 0:
                r["fatality_rate_pct"] = round(r["total_killed"] / r["crash_count"] * 100, 2)
                r["injury_rate_pct"] = round(r["total_injured"] / r["crash_count"] * 100, 2)
        return results


# ---------------------------------------------------------------------------
# 2. rank_counties
# ---------------------------------------------------------------------------

def rank_counties(
    db: Session,
    metric: str,
    years: list[int] | None = None,
    order: str = "desc",
    limit: int = 10,
) -> list[dict]:
    """Rank all 58 counties by a crash metric.

    metric: crash_count | total_crashes | total_killed | total_injured |
            fatal_crashes | alcohol_crashes | pedestrian_crashes
    order: desc (highest first) | asc (lowest first)
    Returns up to min(limit, 20) rows with county_name and the metric value.
    """
    limit = min(limit, _MAX_ROWS)

    if metric not in _CRASH_METRICS:
        return [{"error": f"Unknown metric: {metric}. Valid: {', '.join(_CRASH_METRICS)}."}]

    preds = []
    if years:
        preds.append(Crash.crash_year.in_(years))

    # Apply metric-specific filter
    if metric == "fatal_crashes":
        preds.append(Crash.severity == "Fatal")
        agg = func.count(Crash.id)
    elif metric == "alcohol_crashes":
        preds.append(Crash.is_alcohol_involved.is_(True))
        agg = func.count(Crash.id)
    elif metric == "pedestrian_crashes":
        preds.append(Crash.pedestrian_involved.is_(True))
        agg = func.count(Crash.id)
    elif metric == "total_killed":
        agg = func.sum(Crash.number_killed)
    elif metric == "total_injured":
        agg = func.sum(Crash.number_injured)
    else:
        # crash_count / total_crashes (validated above)
        agg = func.count(Crash.id)

    agg_col = agg.label("value")
    order_col = agg.desc() if order == "desc" else agg.asc()

    stmt = (
        select(
            Crash.county_name.label("county_name"),
            Crash.county_code.label("county_code"),
            agg_col,
        )
        .where(*preds)
        .group_by(Crash.county_code, Crash.county_name)
        .order_by(order_col)
        .limit(limit)
    )
    rows = db.execute(stmt).fetchall()
    return [{"county_name": r.county_name, "county_code": r.county_code, "metric": metric, "value": r.value} for r in rows]


# ---------------------------------------------------------------------------
# 3. compare_counties
# ---------------------------------------------------------------------------

def compare_counties(
    db: Session,
    counties: list[str],
    years: list[int] | None = None,
    metrics: list[str] | None = None,
) -> list[dict]:
    """Side-by-side stats for 2-5 counties.

    Returns one dict per county with crash_count, total_killed, total_injured,
    fatal_rate, alcohol_pct, pedestrian_pct (plus any requested metrics).
    """
    if not counties:
        return []
    counties = counties[:5]  # cap at 5

    results = []
    for county_name in counties:
        code = _county_code(db, county_name)
        if code is None:
            results.append({"county_name": county_name, "error": "not found"})
            continue

        preds = [Crash.county_code == code]
        if years:
            preds.append(Crash.crash_year.in_(years))

        stmt = select(
            func.count(Crash.id).label("crash_count"),
            func.sum(Crash.number_killed).label("total_killed"),
            func.sum(Crash.number_injured).label("total_injured"),
            func.count(Crash.id).filter(Crash.severity == "Fatal").label("fatal_crashes"),
            func.count(Crash.id).filter(Crash.is_alcohol_involved.is_(True)).label("alcohol_crashes"),
            func.count(Crash.id).filter(Crash.pedestrian_involved.is_(True)).label("pedestrian_crashes"),
        ).where(*preds)

        row = db.execute(stmt).fetchone()
        if row is None:
            results.append({"county_name": county_name, "county_code": code, "crash_count": 0})
            continue

        crash_count = row.crash_count or 0
        rec = {
            "county_name": county_name,
            "county_code": code,
            "crash_count": crash_count,
            "total_killed": row.total_killed or 0,
            "total_injured": row.total_injured or 0,
            "fatal_crashes": row.fatal_crashes or 0,
            "alcohol_crashes": row.alcohol_crashes or 0,
            "pedestrian_crashes": row.pedestrian_crashes or 0,
            "fatal_rate_pct": round(100 * row.fatal_crashes / crash_count, 2) if crash_count else None,
            "alcohol_pct": round(100 * row.alcohol_crashes / crash_count, 2) if crash_count else None,
            "pedestrian_pct": round(100 * row.pedestrian_crashes / crash_count, 2) if crash_count else None,
        }
        results.append(rec)

    return results


# ---------------------------------------------------------------------------
# 4. get_trend
# ---------------------------------------------------------------------------

def get_trend(
    db: Session,
    metric: str,
    county: str | None = None,
    year_start: int | None = None,
    year_end: int | None = None,
) -> list[dict]:
    """Year-over-year time series for a metric.

    metric: crash_count | total_crashes | total_killed | total_injured |
            fatal_crashes | alcohol_crashes | pedestrian_crashes
    Returns one row per year, sorted ascending.
    """
    if metric not in _CRASH_METRICS:
        return [{"error": f"Unknown metric: {metric}. Valid: {', '.join(_CRASH_METRICS)}."}]

    preds = []
    if county:
        code = _county_code(db, county)
        if code is None:
            # Same as query_crashes: dropping the filter would present
            # statewide numbers as the county's trend.
            return [{"error": f"County not found: {county}"}]
        preds.append(Crash.county_code == code)
    if year_start:
        preds.append(Crash.crash_year >= year_start)
    if year_end:
        preds.append(Crash.crash_year <= year_end)

    if metric == "fatal_crashes":
        preds.append(Crash.severity == "Fatal")
        agg = func.count(Crash.id)
    elif metric == "alcohol_crashes":
        preds.append(Crash.is_alcohol_involved.is_(True))
        agg = func.count(Crash.id)
    elif metric == "pedestrian_crashes":
        preds.append(Crash.pedestrian_involved.is_(True))
        agg = func.count(Crash.id)
    elif metric == "total_killed":
        agg = func.sum(Crash.number_killed)
    elif metric == "total_injured":
        agg = func.sum(Crash.number_injured)
    else:
        # crash_count / total_crashes (validated above)
        agg = func.count(Crash.id)

    stmt = (
        select(
            Crash.crash_year.label("year"),
            agg.label("value"),
        )
        .where(*preds)
        .group_by(Crash.crash_year)
        .order_by(Crash.crash_year.asc())
        .limit(_MAX_ROWS)
    )
    rows = db.execute(stmt).fetchall()
    return [{"year": r.year, "metric": metric, "value": r.value} for r in rows]


# ---------------------------------------------------------------------------
# 5. get_demographics
# ---------------------------------------------------------------------------

def get_demographics(
    db: Session,
    county: str,
    year: int | None = None,
) -> dict:
    """Census ACS data for a single county.

    If year is omitted, returns the most recent available row.
    """
    code = _county_code(db, county)
    if code is None:
        return {"error": f"County not found: {county}"}

    q = db.query(Demographic).filter(Demographic.county_code == code)
    if year:
        q = q.filter(Demographic.year == year)
    else:
        q = q.order_by(Demographic.year.desc())

    row = q.first()
    if row is None:
        return {"error": f"No demographic data for {county}" + (f" ({year})" if year else "")}

    return _row_to_dict(row)


# ---------------------------------------------------------------------------
# 6. get_weather
# ---------------------------------------------------------------------------

def get_weather(
    db: Session,
    county: str,
    year: int,
) -> list[dict]:
    """Monthly NOAA weather data for a county in a given year.

    Returns up to 12 rows (one per month), sorted by month ascending.
    """
    code = _county_code(db, county)
    if code is None:
        return [{"error": f"County not found: {county}"}]

    rows = (
        db.query(Weather)
        .filter(Weather.county_code == code, Weather.year == year)
        .order_by(Weather.month.asc())
        .limit(12)
        .all()
    )
    return [_row_to_dict(r) for r in rows]


# ---------------------------------------------------------------------------
# 7. get_road_info
# ---------------------------------------------------------------------------

def get_road_info(db: Session, county: str) -> dict:
    """Road miles by functional class, speed limit distribution, hospitals,
    schools, and AADT for a county.
    """
    code = _county_code(db, county)
    if code is None:
        return {"error": f"County not found: {county}"}

    road_rows = (
        db.query(RoadMile)
        .filter(RoadMile.county_code == code)
        .order_by(RoadMile.f_system.asc())
        .all()
    )

    speed_rows = (
        db.query(SpeedLimit)
        .filter(SpeedLimit.county_code == code)
        .order_by(SpeedLimit.speed_limit.asc())
        .limit(_MAX_ROWS)
        .all()
    )

    hospital_rows = (
        db.query(Hospital)
        .filter(Hospital.county_code == code, Hospital.status == "OPEN")
        .limit(_MAX_ROWS)
        .all()
    )

    school_rows = (
        db.query(SchoolLocation)
        .filter(SchoolLocation.county_code == code, SchoolLocation.status == "Active")
        .limit(_MAX_ROWS)
        .all()
    )

    traffic_row = (
        db.query(TrafficVolume)
        .filter(TrafficVolume.county_code == code)
        .first()
    )

    return {
        "county": county,
        "county_code": code,
        "road_miles": [_row_to_dict(r) for r in road_rows],
        "speed_limits": [_row_to_dict(r) for r in speed_rows],
        "hospitals": [_row_to_dict(r) for r in hospital_rows],
        "schools_sample": [_row_to_dict(r) for r in school_rows],
        "traffic_volume": _row_to_dict(traffic_row) if traffic_row else None,
    }


# ---------------------------------------------------------------------------
# 8. get_environmental
# ---------------------------------------------------------------------------

def get_environmental(db: Session, county: str) -> dict:
    """CalEnviroScreen 5.0 scores for a county."""
    code = _county_code(db, county)
    if code is None:
        return {"error": f"County not found: {county}"}

    row = db.query(CalenviroScreen).filter(CalenviroScreen.county_code == code).first()
    if row is None:
        return {"error": f"No CalEnviroScreen data for {county}"}

    return _row_to_dict(row)


# ---------------------------------------------------------------------------
# 9. get_party_demographics
# ---------------------------------------------------------------------------

def get_party_demographics(
    db: Session,
    county: str,
    years: list[int] | None = None,
    at_fault_only: bool = True,
) -> dict:
    """Party age/gender/sobriety breakdown for crashes in a county.

    Joins crash_parties to crashes on (collision_id, data_source).
    Only CCRS data (2016+) has party records — null for older SWITRS crashes.
    """
    code = _county_code(db, county)
    if code is None:
        return {"error": f"County not found: {county}"}

    crash_preds = [Crash.county_code == code]
    if years:
        crash_preds.append(Crash.crash_year.in_(years))

    party_preds = []
    if at_fault_only:
        party_preds.append(CrashParty.at_fault.is_(True))

    # Gender breakdown
    gender_stmt = (
        select(
            CrashParty.gender.label("gender"),
            func.count(CrashParty.id).label("count"),
        )
        .join(Crash, (CrashParty.collision_id == Crash.collision_id) & (CrashParty.data_source == Crash.data_source))
        .where(*crash_preds, *party_preds)
        .group_by(CrashParty.gender)
        .order_by(func.count(CrashParty.id).desc())
        .limit(_MAX_ROWS)
    )

    # Age bracket breakdown (group into bins)
    age_stmt = (
        select(
            CrashParty.age.label("age"),
            func.count(CrashParty.id).label("count"),
        )
        .join(Crash, (CrashParty.collision_id == Crash.collision_id) & (CrashParty.data_source == Crash.data_source))
        .where(*crash_preds, *party_preds, CrashParty.age.isnot(None))
        .group_by(CrashParty.age)
        .order_by(CrashParty.age.asc())
        .limit(_MAX_ROWS)
    )

    # Sobriety breakdown
    sobriety_stmt = (
        select(
            CrashParty.sobriety.label("sobriety"),
            func.count(CrashParty.id).label("count"),
        )
        .join(Crash, (CrashParty.collision_id == Crash.collision_id) & (CrashParty.data_source == Crash.data_source))
        .where(*crash_preds, *party_preds)
        .group_by(CrashParty.sobriety)
        .order_by(func.count(CrashParty.id).desc())
        .limit(_MAX_ROWS)
    )

    gender_rows = db.execute(gender_stmt).fetchall()
    age_rows = db.execute(age_stmt).fetchall()
    sobriety_rows = db.execute(sobriety_stmt).fetchall()

    return {
        "county": county,
        "county_code": code,
        "at_fault_only": at_fault_only,
        "note": "Only CCRS data (2016+) has party records",
        "gender": [{"gender": r.gender, "count": r.count} for r in gender_rows],
        "age_distribution": [{"age": r.age, "count": r.count} for r in age_rows],
        "sobriety": [{"sobriety": r.sobriety, "count": r.count} for r in sobriety_rows],
    }


# ---------------------------------------------------------------------------
# 10. get_victim_info
# ---------------------------------------------------------------------------

def get_victim_info(
    db: Session,
    county: str,
    years: list[int] | None = None,
    injury_severity: str | None = None,
) -> dict:
    """Victim breakdown (injury severity, person type, age, gender) for a county.

    Joins crash_victims to crashes on (collision_id, data_source).
    Only CCRS data (2016+) has victim records.
    """
    code = _county_code(db, county)
    if code is None:
        return {"error": f"County not found: {county}"}

    crash_preds = [Crash.county_code == code]
    if years:
        crash_preds.append(Crash.crash_year.in_(years))

    victim_preds = []
    if injury_severity:
        victim_preds.append(func.lower(CrashVictim.injury_severity) == injury_severity.lower())

    # Injury severity counts
    severity_stmt = (
        select(
            CrashVictim.injury_severity.label("injury_severity"),
            func.count(CrashVictim.id).label("count"),
        )
        .join(Crash, (CrashVictim.collision_id == Crash.collision_id) & (CrashVictim.data_source == Crash.data_source))
        .where(*crash_preds, *victim_preds)
        .group_by(CrashVictim.injury_severity)
        .order_by(func.count(CrashVictim.id).desc())
        .limit(_MAX_ROWS)
    )

    # Person type counts
    person_type_stmt = (
        select(
            CrashVictim.person_type.label("person_type"),
            func.count(CrashVictim.id).label("count"),
        )
        .join(Crash, (CrashVictim.collision_id == Crash.collision_id) & (CrashVictim.data_source == Crash.data_source))
        .where(*crash_preds, *victim_preds)
        .group_by(CrashVictim.person_type)
        .order_by(func.count(CrashVictim.id).desc())
        .limit(_MAX_ROWS)
    )

    # Gender counts
    gender_stmt = (
        select(
            CrashVictim.gender.label("gender"),
            func.count(CrashVictim.id).label("count"),
        )
        .join(Crash, (CrashVictim.collision_id == Crash.collision_id) & (CrashVictim.data_source == Crash.data_source))
        .where(*crash_preds, *victim_preds)
        .group_by(CrashVictim.gender)
        .order_by(func.count(CrashVictim.id).desc())
        .limit(_MAX_ROWS)
    )

    severity_rows = db.execute(severity_stmt).fetchall()
    person_rows = db.execute(person_type_stmt).fetchall()
    gender_rows = db.execute(gender_stmt).fetchall()

    return {
        "county": county,
        "county_code": code,
        "note": "Only CCRS data (2016+) has victim records",
        "injury_severity": [{"injury_severity": r.injury_severity, "count": r.count} for r in severity_rows],
        "person_type": [{"person_type": r.person_type, "count": r.count} for r in person_rows],
        "gender": [{"gender": r.gender, "count": r.count} for r in gender_rows],
    }


# ---------------------------------------------------------------------------
# 11. get_unemployment
# ---------------------------------------------------------------------------

def get_unemployment(
    db: Session,
    county: str,
    year: int,
) -> list[dict]:
    """Monthly BLS unemployment rates for a county in a given year.

    Returns up to 12 rows sorted by month ascending.
    """
    code = _county_code(db, county)
    if code is None:
        return [{"error": f"County not found: {county}"}]

    rows = (
        db.query(UnemploymentRate)
        .filter(UnemploymentRate.county_code == code, UnemploymentRate.year == year)
        .order_by(UnemploymentRate.month.asc())
        .limit(12)
        .all()
    )
    return [_row_to_dict(r) for r in rows]


# ---------------------------------------------------------------------------
# 12. get_vehicle_stats
# ---------------------------------------------------------------------------

def get_vehicle_stats(
    db: Session,
    county: str,
    year: int | None = None,
) -> list[dict]:
    """Registered vehicles (total + EV) and licensed drivers for a county.

    If year is omitted, returns all available years sorted ascending.
    Caps at 20 rows.
    """
    code = _county_code(db, county)
    if code is None:
        return [{"error": f"County not found: {county}"}]

    veh_q = db.query(VehicleRegistration).filter(VehicleRegistration.county_code == code)
    drv_q = db.query(LicensedDriver).filter(LicensedDriver.county_code == code)

    if year:
        veh_q = veh_q.filter(VehicleRegistration.year == year)
        drv_q = drv_q.filter(LicensedDriver.year == year)

    veh_rows = veh_q.order_by(VehicleRegistration.year.asc()).limit(_MAX_ROWS).all()
    drv_rows = drv_q.order_by(LicensedDriver.year.asc()).limit(_MAX_ROWS).all()

    # Merge by year
    drv_by_year = {r.year: r.driver_count for r in drv_rows}
    results = []
    for r in veh_rows:
        results.append({
            "county": county,
            "county_code": code,
            "year": r.year,
            "total_vehicles": r.total_vehicles,
            "ev_vehicles": r.ev_vehicles,
            "licensed_drivers": drv_by_year.get(r.year),
        })

    # Include driver-only years (in case vehicle data is missing for some years)
    veh_years = {r.year for r in veh_rows}
    for r in drv_rows:
        if r.year not in veh_years:
            results.append({
                "county": county,
                "county_code": code,
                "year": r.year,
                "total_vehicles": None,
                "ev_vehicles": None,
                "licensed_drivers": r.driver_count,
            })

    results.sort(key=lambda x: x["year"])
    return results[:_MAX_ROWS]


# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# 13. get_crash_rate
# ---------------------------------------------------------------------------

def get_crash_rate(
    db: Session,
    county: str,
    years: list[int] | None = None,
) -> dict | None:
    """Get crash rates per capita, per licensed driver, and per vehicle for a county."""
    code = _county_code(db, county)
    if not code:
        return {"error": f"County not found: {county}"}

    crash_q = db.query(
        func.count(Crash.id).label("total_crashes"),
        func.sum(Crash.number_killed).label("total_killed"),
        func.sum(Crash.number_injured).label("total_injured"),
        func.count(func.distinct(Crash.crash_year)).label("years_covered"),
    ).filter(Crash.county_code == code)
    if years:
        crash_q = crash_q.filter(Crash.crash_year.in_(years))
    crash_row = crash_q.one()

    pop = db.query(County.population).filter(County.code == code).scalar()

    ld = db.query(LicensedDriver.driver_count).filter(
        LicensedDriver.county_code == code
    ).order_by(LicensedDriver.year.desc()).first()
    drivers = ld[0] if ld else None

    vr = db.query(VehicleRegistration.total_vehicles).filter(
        VehicleRegistration.county_code == code
    ).order_by(VehicleRegistration.year.desc()).first()
    vehicles = vr[0] if vr else None

    # The denominators (population, drivers, vehicles) are single-year
    # figures, so normalize the numerator to an annual average. Without
    # this, an unrestricted query divides ~25 years of crashes by one
    # year's population and reports a rate inflated ~25x.
    years_covered = crash_row.years_covered or 1
    crashes_per_year = crash_row.total_crashes / years_covered
    killed_per_year = int(crash_row.total_killed or 0) / years_covered

    result = {
        "county": county,
        "total_crashes": crash_row.total_crashes,
        "total_killed": int(crash_row.total_killed or 0),
        "total_injured": int(crash_row.total_injured or 0),
        "years_covered": years_covered,
        "rate_basis": f"annual average over {years_covered} year(s) of crash data",
        "population": pop,
        "licensed_drivers": drivers,
        "registered_vehicles": vehicles,
    }

    if pop and pop > 0:
        result["crashes_per_100k_pop"] = round(crashes_per_year / pop * 100_000, 1)
        result["fatalities_per_100k_pop"] = round(killed_per_year / pop * 100_000, 1)
    if drivers and drivers > 0:
        result["crashes_per_10k_drivers"] = round(crashes_per_year / drivers * 10_000, 1)
    if vehicles and vehicles > 0:
        result["crashes_per_10k_vehicles"] = round(crashes_per_year / vehicles * 10_000, 1)
    if crash_row.total_crashes > 0:
        result["fatality_rate_pct"] = round(int(crash_row.total_killed or 0) / crash_row.total_crashes * 100, 2)
        result["injury_rate_pct"] = round(int(crash_row.total_injured or 0) / crash_row.total_crashes * 100, 2)

    return result


def get_top_intersections(
    db: Session,
    county: str | None = None,
    years: list[int] | None = None,
    corridors: bool = False,
    pedestrian: bool | None = None,
    cyclist: bool | None = None,
    sort: str = "count",
    limit: int = 10,
) -> list[dict]:
    """Street-level crash aggregation, ranked by crash count or severity.

    Groups crashes by (primary_road x secondary_road) — or by primary_road
    alone when corridors=True — using the road-pair model. Optional pedestrian
    / cyclist filters restrict to those involvements. sort='severity' ranks by
    a severity-weighted score instead of raw crash count. Returns roads,
    crash_count, severity_score, and the fatal/injury/pdo split. Presents the
    numbers; the caller draws conclusions.
    """
    from app.routers.intersections import _aggregate  # noqa: PLC0415 (avoid import cycle)

    code = None
    if county:
        code = _county_code(db, county)
        if code is None:
            return [{"error": f"County not found: {county}"}]

    year_start = min(years) if years else None
    year_end = max(years) if years else None
    rows = _aggregate(
        db,
        by_secondary=not corridors,
        county_code=code,
        year_start=year_start,
        year_end=year_end,
        min_crashes=1,
        limit=min(limit, _MAX_ROWS),
        pedestrian=pedestrian,
        cyclist=cyclist,
        sort="severity" if sort == "severity" else "count",
    )
    return [r.model_dump() for r in rows]


def get_street_concentration(
    db: Session,
    county: str | None = None,
    years: list[int] | None = None,
    corridors: bool = True,
) -> dict:
    """How concentrated fatal+injury crashes are across streets.

    Returns the share of severe (fatal+injury) crashes held by the top
    1/5/10/25% of crash-carrying streets — the "a small share of streets
    carries most of the harm" statistic. corridors=True groups by a single
    street; False by intersection pairs. The denominator is crash-carrying
    streets, not all road miles. Presents the numbers; no framing.
    """
    from app.routers.intersections import _concentration  # noqa: PLC0415 (avoid import cycle)

    code = None
    name = None
    if county:
        code = _county_code(db, county)
        if code is None:
            return {"error": f"County not found: {county}"}
        name = db.query(County.name).filter(County.code == code).scalar()

    year_start = min(years) if years else None
    year_end = max(years) if years else None
    out = _concentration(
        db,
        by_secondary=not corridors,
        county_code=code,
        county_name=name,
        year_start=year_start,
        year_end=year_end,
    )
    return out.model_dump()


def get_yoy_changes(
    db: Session,
    metric: str = "crashes",
    year: int | None = None,
    limit: int = 10,
) -> dict:
    """Which counties changed the most year-over-year for a metric.

    Compares `year` (default: latest year with data) against the prior year
    for all counties. Rows whose baseline is below the metric's minimum are
    flagged small_baseline and ranked after solid-baseline rows — percent
    changes on tiny baselines are noise-prone. partial_year=True means the
    comparison year is still accumulating data. Reports numbers only.
    """
    from app.routers.changes import compute_yoy_changes  # noqa: PLC0415 (avoid import cycle)

    if metric not in ("crashes", "fatal_crashes", "killed", "injured"):
        return {"error": f"Unknown metric: {metric}. Use crashes, fatal_crashes, killed, or injured."}

    data = compute_yoy_changes(db, metric=metric, year=year).model_dump()
    data["rows"] = data["rows"][: min(limit, _MAX_ROWS)]
    return data


def get_first_rain(
    db: Session,
    county: str | None = None,
    water_year: int | None = None,
) -> dict:
    """First measurable rain of the water year and its crash lift.

    Statewide median lift plus one water year's roll-up (the latest unless
    `water_year` is given); with `county` (slug or display name), that
    county's event and days since its last measurable rain. Reuses the
    /api/first-rain builder so the numbers match the Water page exactly.
    """
    from app.county_slug_map import slugify_name  # noqa: PLC0415
    from app.routers.first_rain import build_first_rain, county_event, lookup_event  # noqa: PLC0415 (avoid import cycle)
    from etl.compute_first_rain import MATURITY_DAYS  # noqa: PLC0415

    data = build_first_rain(db)
    statewide = data.statewide.events
    sw_event = next((e for e in statewide if e.water_year == water_year), None) if water_year else None
    sw_event = sw_event or (statewide[-1] if statewide else None)
    out: dict[str, Any] = {
        "definition": (
            f"First measurable rain = the first day of a water year (starts Oct 1) with "
            f">= {data.threshold_in} in of precipitation after >= {data.min_dry_days} days "
            f"without such rain (lighter drizzle does not count as rain). "
            f"lift_pct compares crashes that day with the average over the prior "
            f"{data.baseline_days} days. Association, not causation; small_baseline=true "
            f"means the percent is noise-prone. An event is scored only once crash reports "
            f"extend {MATURITY_DAYS} days (~6 weeks) past it, so early in a season the latest "
            f"event is still the previous water year's."
        ),
        "weather_through": data.weather_through.isoformat() if data.weather_through else None,
        "statewide": {
            "water_years": data.statewide.water_years,
            "median_lift_pct": data.statewide.median_lift_pct,
            "event": sw_event.model_dump(mode="json") if sw_event else None,
        },
    }
    if county:
        slug = slugify_name(county)
        strip = next((d for d in data.days_since_rain if d.county_slug == slug), None)
        if strip is None:
            return {"error": f"Unknown county: {county}"}
        event = next((c for c in data.counties if c.county_slug == slug), None)
        if water_year is not None and (event is None or event.water_year != water_year):
            row = lookup_event(db, strip.county_code, water_year)
            event = county_event(*row) if row else None
        out["county"] = {
            "county_name": strip.county_name,
            "days_since_rain": strip.days,
            "last_rain_date": strip.last_rain_date.isoformat() if strip.last_rain_date else None,
            "event": event.model_dump(mode="json") if event else None,
        }
    return out


# ---------------------------------------------------------------------------
# 18. get_mode_breakdown
# ---------------------------------------------------------------------------

_MODE_CAVEAT = (
    "Counts PEOPLE, not crashes: one crash that hurts a pedestrian and two car "
    "occupants adds 1 to pedestrian and 2 to occupant. A person's mode is only "
    "known when they have a recorded injury outcome, so victim_count means "
    "people injured or killed, not everyone present. Victim records are "
    "CCRS-only, so this series starts in 2016 — it cannot answer mode questions "
    "about earlier years. Modes are pedestrian, cyclist, motorcyclist "
    "(motorcycles and mopeds) and occupant (everyone else riding in a vehicle); "
    "severity is the CRASH's severity, while the casualty columns come from each "
    "person's own injury outcome."
)


def get_mode_breakdown(
    db: Session,
    county: str | None = None,
    years: list[int] | None = None,
    severity: str | None = None,
    mode: str | None = None,
    by_year: bool = False,
) -> dict:
    """People hurt or killed by road-user mode (pedestrian / cyclist /
    motorcyclist / occupant).

    Reuses the /api/stats?group_by=mode query over mv_victims_by_mode, so the
    numbers match the dashboard's mode chart exactly. Counts PEOPLE, not
    crashes, only people with a recorded injury outcome, and starts in 2016
    (CCRS). Returns at most four rows plus the caveat text — repeat it.

    ``by_year=True`` returns one row per year instead (for ``mode`` if given,
    else every mode summed), the series a "is walking getting more dangerous"
    question needs. Every row carries ksi_count (killed + seriously injured),
    and the two most recent years are flagged: death records lag six months
    or more, so their counts are still rising.
    """
    from app.routers.stats import _PG_NOT_POPULATED, _run_group_query, mv_mode  # noqa: PLC0415 (avoid import cycle)

    code = None
    if county:
        code = _county_code(db, county)
        if code is None:
            return {"error": f"County not found: {county}"}

    try:
        if by_year:
            v = mv_mode
            preds = []
            if years:
                preds.append(v.c.crash_year.in_(_resolve_years(years)))
            if code:
                preds.append(v.c.county_code == code)
            if severity:
                preds.append(v.c.severity == severity)
            if mode:
                preds.append(v.c.mode == mode)
            stmt = (
                select(
                    v.c.crash_year.label("year"),
                    func.sum(v.c.victim_count).label("victim_count"),
                    func.sum(v.c.fatal_victim_count).label("fatal_victim_count"),
                    func.sum(v.c.severe_injured_count).label("severe_injured_count"),
                )
                .where(*preds)
                .group_by(v.c.crash_year)
                .order_by(v.c.crash_year.desc())
                .limit(_MAX_ROWS)
            )
            # Newest first so a row cap drops the oldest years, not the latest.
            rows = [dict(r._mapping) for r in reversed(db.execute(stmt).all())]
        else:
            rows = _run_group_query(
                "mode",
                _resolve_years(years),
                [code] if code else None,
                [severity] if severity else None,
                None,
                db,
            )
            if mode:
                rows = [r for r in rows if r["mode"] == mode]
    except DBAPIError as e:
        # mv_victims_by_mode is created WITH NO DATA, so between a migration
        # and its first refresh every read raises 55000. Say so plainly, the
        # way /api/stats does, instead of surfacing a generic tool failure.
        if getattr(e.orig, "pgcode", None) != _PG_NOT_POPULATED:
            raise
        db.rollback()
        return {
            "county": county or "California (statewide)",
            "caveats": _MODE_CAVEAT,
            "note": (
                "The mode-of-travel aggregate has not been built yet "
                "(it refreshes nightly); no counts are available right now."
            ),
            "modes": [],
        }
    # ponytail: "the last two calendar years are provisional" is a rule of
    # thumb for the 6+ month death-record lag, not a per-county completeness
    # check; switch to the loaded-data watermark if the lag ever shrinks.
    this_year = datetime.now(timezone.utc).year
    for r in rows:
        r["ksi_count"] = (r.get("fatal_victim_count") or 0) + (r.get("severe_injured_count") or 0)
        year = r.get("year")
        if year is not None and year >= this_year:
            r["status"] = "partial year (still in progress)"
        elif year is not None and year == this_year - 1:
            r["status"] = "provisional (death records still arriving; counts will rise)"
    return {
        "county": county or "California (statewide)",
        "years": years or "all available (2016+)",
        "severity": severity,
        "mode": mode,
        "caveats": _MODE_CAVEAT,
        "modes": rows[:_MAX_ROWS],
    }


# ---------------------------------------------------------------------------
# 19. get_vmt
# ---------------------------------------------------------------------------

_VMT_CAVEAT = (
    "VMT (vehicle miles traveled) is the exposure denominator road-safety work "
    "normally uses. vmt_millions is millions of miles driven on every road in "
    "the area for the whole year, from the CARB EMFAC2025 model — modelled from "
    "DMV vehicle population and Caltrans travel-demand totals, not a raw "
    "traffic count, and a future EMFAC release will restate it. It is NOT "
    "Caltrans AADT (a state-highway point count for one average day). A rate is "
    "only returned for years present in both the VMT and crash data; recent "
    "years can be partial in either. Crash counts here are all recorded "
    "crashes, coordinates or not."
)


def get_vmt(
    db: Session,
    county: str | None = None,
    year_start: int | None = None,
    year_end: int | None = None,
) -> dict:
    """Vehicle miles traveled per year, with crashes and deaths per 100M VMT.

    One row per year for a county (or statewide when county is omitted), from
    the CARB EMFAC vmt table, joined to that year's recorded crashes to give
    crashes_per_100m_vmt and killed_per_100m_vmt — the standard exposure-based
    safety rate. Returns the 20 most recent years in range.
    """
    code = None
    if county:
        code = _county_code(db, county)
        if code is None:
            return {"error": f"County not found: {county}"}

    vmt_stmt = select(
        Vmt.year.label("year"),
        func.sum(Vmt.vmt_millions).label("vmt_millions"),
    ).group_by(Vmt.year).order_by(Vmt.year.asc())
    crash_stmt = select(
        Crash.crash_year.label("year"),
        func.count(Crash.id).label("crash_count"),
        func.sum(Crash.number_killed).label("total_killed"),
    ).group_by(Crash.crash_year).order_by(Crash.crash_year.asc())

    if code:
        vmt_stmt = vmt_stmt.where(Vmt.county_code == code)
        crash_stmt = crash_stmt.where(Crash.county_code == code)
    if year_start is not None:
        vmt_stmt = vmt_stmt.where(Vmt.year >= year_start)
        crash_stmt = crash_stmt.where(Crash.crash_year >= year_start)
    if year_end is not None:
        vmt_stmt = vmt_stmt.where(Vmt.year <= year_end)
        crash_stmt = crash_stmt.where(Crash.crash_year <= year_end)

    crashes_by_year = {
        r.year: (r.crash_count, int(r.total_killed or 0))
        for r in db.execute(crash_stmt).fetchall()
    }

    # Which years the table holds at all, ignoring the caller's window — so
    # "is 2026 covered yet?" is answerable without a second tool call.
    span = db.execute(
        select(func.min(Vmt.year), func.max(Vmt.year)).where(
            *( [Vmt.county_code == code] if code else [] )
        )
    ).one()

    rows = []
    for r in db.execute(vmt_stmt).fetchall():
        vmt_millions = float(r.vmt_millions) if r.vmt_millions else None
        crash_count, killed = crashes_by_year.get(r.year, (None, None))
        rec: dict[str, Any] = {
            "year": r.year,
            "vmt_millions": round(vmt_millions, 1) if vmt_millions else None,
            "crash_count": crash_count,
            "total_killed": killed,
        }
        # 100M VMT is 100 units of vmt_millions.
        if vmt_millions and crash_count is not None:
            rec["crashes_per_100m_vmt"] = round(crash_count / (vmt_millions / 100), 2)
            rec["killed_per_100m_vmt"] = round(killed / (vmt_millions / 100), 3)
        rows.append(rec)

    return {
        "county": county or "California (statewide)",
        "vmt_years_available": (
            f"{span[0]}-{span[1]}" if span[0] is not None else "none loaded"
        ),
        "caveats": _VMT_CAVEAT,
        # Most recent years first matter more than the oldest — keep the tail.
        "years": rows[-_MAX_ROWS:],
    }


# ---------------------------------------------------------------------------
# 20. get_school_crashes
# ---------------------------------------------------------------------------

_SCHOOL_CAVEAT = (
    "Counts crashes whose recorded coordinates fall within 500 ft of a school "
    "(K-12, from the CDE school list). Only about 37% of crashes carry "
    "coordinates at all and coverage varies a lot by reporting agency, so these "
    "are located crashes only — a floor, not a total, and a school in a "
    "low-coverage county looks safer here than it is. coord_coverage_pct below "
    "is the share of crashes in scope that carry coordinates. Proximity is not "
    "attribution: a crash 500 ft from a school need not involve the school, and "
    "the counts are not limited to school hours."
)

# Totals travel on every row (like query_crashes' grand_total window) so the
# model can answer "how many crashes near schools in LA" without summing a
# top-N list and under-reporting.
_SCHOOL_TOOL_SQL = """
WITH per_school AS (
    SELECT s.id                            AS school_id,
           s.school_name                   AS school_name,
           s.city                          AS city,
           s.county_code                   AS county_code,
           sum(m.crashes)::bigint          AS crashes,
           sum(m.killed)::bigint           AS killed,
           sum(m.injured)::bigint          AS injured,
           sum(m.severe_injured)::bigint   AS severe_injured
    FROM mv_school_crash_counts m
    JOIN school_locations s ON s.id = m.school_id
    -- The cast is what lets the all-years case pass an empty list: an untyped
    -- '{}' literal has no element type for PG to compare year against.
    WHERE (:all_years OR m.year = ANY(CAST(:years AS integer[])))
      AND (:all_counties OR s.county_code = :county_code)
    GROUP BY s.id, s.school_name, s.city, s.county_code
)
SELECT p.*,
       (SELECT count(*) FROM per_school)          AS schools_with_crashes,
       (SELECT sum(crashes) FROM per_school)      AS total_crashes,
       (SELECT sum(killed) FROM per_school)       AS total_killed,
       (SELECT sum(injured) FROM per_school)      AS total_injured
FROM per_school p
ORDER BY p.crashes DESC, p.school_id
LIMIT :limit
"""


def get_school_crashes(
    db: Session,
    county: str | None = None,
    years: list[int] | None = None,
    limit: int = 10,
) -> dict:
    """Crashes within 500 ft of K-12 schools: the schools with the most, plus
    the totals for the area.

    Reads mv_school_crash_counts — the same 500 ft rollup behind the map's
    school markers. Covers only crashes that carry coordinates (~37%
    statewide), so report the numbers as located crashes and repeat the
    caveat. Returns up to min(limit, 20) schools.
    """
    from app.routers.reference import (  # noqa: PLC0415 (avoid import cycle)
        _coord_coverage,
        _school_mv_populated,
    )

    limit = min(limit, _MAX_ROWS)

    code = None
    if county:
        code = _county_code(db, county)
        if code is None:
            return {"error": f"County not found: {county}"}

    year_set = set(years) if years else None
    coverage = [
        c for c in _coord_coverage(db, year_set)
        if code is None or c.county_code == code
    ]
    located = sum(c.crashes_with_coords for c in coverage)
    all_crashes = sum(c.total_crashes for c in coverage)

    out: dict[str, Any] = {
        "county": county or "California (statewide)",
        "years": sorted(year_set) if year_set else "all available",
        "coord_coverage_pct": (
            round(located / all_crashes * 100, 1) if all_crashes else None
        ),
        "caveats": _SCHOOL_CAVEAT,
        "schools_with_a_nearby_crash": 0,
        "total_crashes_near_schools": 0,
        "total_killed_near_schools": 0,
        "total_injured_near_schools": 0,
        "top_schools": [],
    }

    # Created WITH NO DATA (migration 10f264138733): between a deploy and the
    # next nightly refresh, reading it raises rather than returning nothing.
    if not _school_mv_populated(db):
        out["note"] = (
            "The school-proximity aggregate has not been built yet "
            "(it refreshes nightly); no counts are available right now."
        )
        return out

    rows = db.execute(
        text(_SCHOOL_TOOL_SQL),
        {
            "all_years": year_set is None,
            "years": sorted(year_set or []),
            "all_counties": code is None,
            "county_code": code or 0,
            "limit": limit,
        },
    ).fetchall()

    if rows:
        out["schools_with_a_nearby_crash"] = int(rows[0].schools_with_crashes or 0)
        out["total_crashes_near_schools"] = int(rows[0].total_crashes or 0)
        out["total_killed_near_schools"] = int(rows[0].total_killed or 0)
        out["total_injured_near_schools"] = int(rows[0].total_injured or 0)
    out["top_schools"] = [
        {
            "school_name": r.school_name,
            "city": r.city,
            "county_code": r.county_code,
            "crashes": int(r.crashes or 0),
            "killed": int(r.killed or 0),
            "injured": int(r.injured or 0),
            "severe_injured": int(r.severe_injured or 0),
        }
        for r in rows
    ]
    return out


# ---------------------------------------------------------------------------
# 21. get_tract_burden
# ---------------------------------------------------------------------------

_TRACT_CAVEAT = (
    "ces_percentile is the CalEnviroScreen 5.0 cumulative-burden percentile for "
    "a census tract: 0 = least burdened in California, 100 = most burdened, "
    "combining pollution exposure with population vulnerability. It is a single "
    "CES 5.0 snapshot, not a yearly series. Tract crash counts come from crashes "
    "whose coordinates fall inside the tract, and only about 37% of crashes "
    "carry coordinates (coord_share below), so these are located crashes only — "
    "a floor, not a total. Any pattern across burden bands is an association "
    "between where crashes are RECORDED and where burdened communities are; "
    "traffic volume, road design and density all confound it."
)

_CES_BANDS = (
    (80.0, "80-100 (most burdened)"),
    (60.0, "60-80"),
    (40.0, "40-60"),
    (20.0, "20-40"),
    (0.0, "0-20 (least burdened)"),
)


def get_tract_burden(
    db: Session,
    county: str | None = None,
    year_start: int | None = None,
    year_end: int | None = None,
    limit: int = 10,
) -> dict:
    """Census-tract crash burden against CalEnviroScreen score — the equity cut.

    Summarises the same tract_ces / tract_crash_year join behind
    /api/tract-burden into two small pieces: crashes and crashes per 1,000
    residents by CES burden band (five rows), and the tracts carrying the most
    located crashes (up to min(limit, 20)). Coordinates-only coverage, and an
    association rather than a cause — repeat the caveat.
    """
    from app.routers.tract_burden import _coord_share  # noqa: PLC0415 (avoid import cycle)

    code = None
    if county:
        code = _county_code(db, county)
        if code is None:
            return {"error": f"County not found: {county}"}

    limit = min(limit, _MAX_ROWS)

    # The year filter lives in the JOIN condition, not a WHERE: a tract with no
    # crashes in the window must still count toward its band's population.
    year_cond = [TractCrashYear.geoid == TractCes.geoid]
    if year_start is not None:
        year_cond.append(TractCrashYear.year >= year_start)
    if year_end is not None:
        year_cond.append(TractCrashYear.year <= year_end)

    band = case(
        *[(TractCes.ces_percentile >= lo, label) for lo, label in _CES_BANDS],
        else_="unscored",
    ).label("ces_band")

    where = [TractCes.county_code == code] if code else []

    band_stmt = (
        select(
            band,
            func.count(func.distinct(TractCes.geoid)).label("tract_count"),
            func.coalesce(func.sum(TractCrashYear.crash_count), 0).label("crash_count"),
            func.coalesce(func.sum(TractCrashYear.killed), 0).label("killed"),
        )
        .select_from(TractCes)
        .outerjoin(TractCrashYear, and_(*year_cond))
        .where(*where)
        .group_by(band)
        .order_by(band)
    )
    # Population is per tract, so it cannot be summed in the join above
    # (a tract with N crash-years would be counted N times).
    pop_stmt = (
        select(band, func.sum(TractCes.population).label("population"))
        .select_from(TractCes)
        .where(*where)
        .group_by(band)
    )
    pop_by_band = {r.ces_band: int(r.population or 0) for r in db.execute(pop_stmt)}

    bands = []
    for r in db.execute(band_stmt).fetchall():
        pop = pop_by_band.get(r.ces_band, 0)
        bands.append({
            "ces_band": r.ces_band,
            "tract_count": r.tract_count,
            "population": pop or None,
            "crash_count": int(r.crash_count or 0),
            "killed": int(r.killed or 0),
            "crashes_per_1k_pop": (
                round(int(r.crash_count or 0) * 1000.0 / pop, 2) if pop else None
            ),
        })

    top_stmt = (
        select(
            TractCes.geoid,
            TractCes.county_code,
            TractCes.ces_percentile,
            TractCes.population,
            func.coalesce(func.sum(TractCrashYear.crash_count), 0).label("crash_count"),
            func.coalesce(func.sum(TractCrashYear.killed), 0).label("killed"),
        )
        .select_from(TractCes)
        .outerjoin(TractCrashYear, and_(*year_cond))
        .where(*where)
        .group_by(
            TractCes.geoid, TractCes.county_code,
            TractCes.ces_percentile, TractCes.population,
        )
        .order_by(func.coalesce(func.sum(TractCrashYear.crash_count), 0).desc(), TractCes.geoid)
        .limit(limit)
    )
    top_tracts = [
        {
            "geoid": r.geoid,
            "county_code": r.county_code,
            "ces_percentile": r.ces_percentile,
            "population": r.population,
            "crash_count": int(r.crash_count or 0),
            "killed": int(r.killed or 0),
            "crashes_per_1k_pop": (
                round(int(r.crash_count or 0) * 1000.0 / r.population, 2)
                if r.population else None
            ),
        }
        for r in db.execute(top_stmt).fetchall()
    ]

    return {
        "county": county or "California (statewide)",
        "years": f"{year_start or 'earliest'} to {year_end or 'latest'}",
        "coord_share": _coord_share(db, year_start, year_end, {code} if code else None),
        "caveats": _TRACT_CAVEAT,
        "burden_bands": bands,
        "top_tracts": top_tracts,
    }


# Tool registry
# ---------------------------------------------------------------------------

TOOL_REGISTRY: dict[str, Any] = {
    "query_crashes": query_crashes,
    "rank_counties": rank_counties,
    "compare_counties": compare_counties,
    "get_trend": get_trend,
    "get_demographics": get_demographics,
    "get_weather": get_weather,
    "get_road_info": get_road_info,
    "get_environmental": get_environmental,
    "get_party_demographics": get_party_demographics,
    "get_victim_info": get_victim_info,
    "get_unemployment": get_unemployment,
    "get_vehicle_stats": get_vehicle_stats,
    "get_crash_rate": get_crash_rate,
    "get_top_intersections": get_top_intersections,
    "get_street_concentration": get_street_concentration,
    "get_yoy_changes": get_yoy_changes,
    "first_rain": get_first_rain,
    "get_mode_breakdown": get_mode_breakdown,
    "get_vmt": get_vmt,
    "get_school_crashes": get_school_crashes,
    "get_tract_burden": get_tract_burden,
}
