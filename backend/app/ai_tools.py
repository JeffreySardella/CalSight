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
from typing import Any

from sqlalchemy import func, select
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
    TrafficVolume,
    UnemploymentRate,
    VehicleRegistration,
    Weather,
)

logger = logging.getLogger(__name__)

_MAX_ROWS = 20


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
        if code is not None:
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
        stmt = (
            select(
                col.label(group_by),
                func.count(Crash.id).label("crash_count"),
                func.sum(Crash.number_killed).label("total_killed"),
                func.sum(Crash.number_injured).label("total_injured"),
            )
            .where(*preds)
            .group_by(col)
            .order_by(func.count(Crash.id).desc())
            .limit(limit)
        )
        rows = db.execute(stmt).fetchall()
        results = [_row_to_dict(r) for r in rows]
        total = sum(r["crash_count"] for r in results)
        if total > 0:
            for r in results:
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

    metric: crash_count | total_killed | total_injured |
            fatal_crashes | alcohol_crashes | pedestrian_crashes
    order: desc (highest first) | asc (lowest first)
    Returns up to min(limit, 20) rows with county_name and the metric value.
    """
    limit = min(limit, _MAX_ROWS)

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
        # default: crash_count
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

    metric: crash_count | total_killed | total_injured |
            fatal_crashes | alcohol_crashes | pedestrian_crashes
    Returns one row per year, sorted ascending.
    """
    preds = []
    if county:
        code = _county_code(db, county)
        if code is not None:
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
    """CalEnviroScreen 4.0 scores for a county."""
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
        return None

    crash_q = db.query(
        func.count(Crash.id).label("total_crashes"),
        func.sum(Crash.number_killed).label("total_killed"),
        func.sum(Crash.number_injured).label("total_injured"),
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

    result = {
        "county": county,
        "total_crashes": crash_row.total_crashes,
        "total_killed": int(crash_row.total_killed or 0),
        "total_injured": int(crash_row.total_injured or 0),
        "population": pop,
        "licensed_drivers": drivers,
        "registered_vehicles": vehicles,
    }

    if pop and pop > 0:
        result["crashes_per_100k_pop"] = round(crash_row.total_crashes / pop * 100_000, 1)
        result["fatalities_per_100k_pop"] = round(int(crash_row.total_killed or 0) / pop * 100_000, 1)
    if drivers and drivers > 0:
        result["crashes_per_10k_drivers"] = round(crash_row.total_crashes / drivers * 10_000, 1)
    if vehicles and vehicles > 0:
        result["crashes_per_10k_vehicles"] = round(crash_row.total_crashes / vehicles * 10_000, 1)
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
}
