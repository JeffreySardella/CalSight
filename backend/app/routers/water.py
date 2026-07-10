"""Water module — reservoir conditions (CDEC) and drought status (USDM)."""

from collections import defaultdict
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import County, DroughtCountyWeekly, Reservoir, ReservoirDaily
from app.schemas.drought import (
    DroughtCountyOut,
    DroughtPcts,
    DroughtSnapshotOut,
    DroughtWeekPoint,
)
from app.schemas.water import (
    ReservoirConditionOut,
    ReservoirSeriesOut,
    ReservoirSeriesPoint,
)

router = APIRouter(tags=["water"])

_limiter = Limiter(key_func=get_remote_address)

_ONE_HOUR = "public, max-age=3600"


@router.get("/water/reservoirs", response_model=list[ReservoirConditionOut])
@_limiter.limit("1000/minute;20000/hour")
def list_reservoir_conditions(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """Every tracked reservoir with its latest storage reading,
    percent of capacity, and percent of the historical average for
    that day of year."""
    response.headers["Cache-Control"] = _ONE_HOUR

    # Latest observation per station.
    latest_sq = (
        db.query(
            ReservoirDaily.station_id,
            func.max(ReservoirDaily.date).label("latest_date"),
        )
        .group_by(ReservoirDaily.station_id)
        .subquery()
    )
    rows = (
        db.query(Reservoir, ReservoirDaily)
        .join(latest_sq, latest_sq.c.station_id == Reservoir.station_id)
        .join(
            ReservoirDaily,
            (ReservoirDaily.station_id == latest_sq.c.station_id)
            & (ReservoirDaily.date == latest_sq.c.latest_date),
        )
        .order_by(Reservoir.capacity_af.desc())
        .all()
    )

    # Historical average for each station's latest (month, day). Stations
    # are normally all on the same latest date, so this is one grouped
    # query per distinct (month, day) — not one per station.
    stations_by_md: dict[tuple[int, int], list[str]] = defaultdict(list)
    for _, obs in rows:
        stations_by_md[(obs.date.month, obs.date.day)].append(obs.station_id)

    averages: dict[str, float] = {}
    for (month, day), station_ids in stations_by_md.items():
        avg_rows = (
            db.query(
                ReservoirDaily.station_id,
                func.avg(ReservoirDaily.storage_af).label("avg_af"),
            )
            .filter(
                ReservoirDaily.station_id.in_(station_ids),
                func.extract("month", ReservoirDaily.date) == month,
                func.extract("day", ReservoirDaily.date) == day,
            )
            .group_by(ReservoirDaily.station_id)
            .all()
        )
        averages.update({sid: float(avg) for sid, avg in avg_rows})

    out = []
    for reservoir, obs in rows:
        avg = averages.get(reservoir.station_id)
        # A station with a single loaded year averages to exactly its
        # latest value — pct_of_average of 100 is meaningless noise, so
        # surface the average only once it differs from the observation.
        has_history = avg is not None and abs(avg - obs.storage_af) > 1e-9
        out.append(
            ReservoirConditionOut(
                station_id=reservoir.station_id,
                name=reservoir.name,
                capacity_af=reservoir.capacity_af,
                county_code=reservoir.county_code,
                latest_date=obs.date,
                storage_af=obs.storage_af,
                pct_of_capacity=round(obs.storage_af / reservoir.capacity_af * 100, 1),
                avg_storage_af=round(avg, 1) if has_history else None,
                pct_of_average=(
                    round(obs.storage_af / avg * 100, 1)
                    if has_history and avg > 0
                    else None
                ),
            )
        )
    return out


@router.get(
    "/water/reservoirs/{station_id}/series", response_model=ReservoirSeriesOut
)
@_limiter.limit("1000/minute;20000/hour")
def reservoir_series(
    station_id: str,
    request: Request,
    response: Response,
    start: date | None = Query(None),
    end: date | None = Query(None),
    db: Session = Depends(get_db),
):
    """Daily storage time series for one reservoir, optionally windowed."""
    response.headers["Cache-Control"] = _ONE_HOUR

    reservoir = db.get(Reservoir, station_id.upper())
    if reservoir is None:
        raise HTTPException(status_code=404, detail="Unknown reservoir")

    q = db.query(ReservoirDaily).filter(
        ReservoirDaily.station_id == reservoir.station_id
    )
    if start:
        q = q.filter(ReservoirDaily.date >= start)
    if end:
        q = q.filter(ReservoirDaily.date <= end)
    points = q.order_by(ReservoirDaily.date).all()

    return ReservoirSeriesOut(
        station_id=reservoir.station_id,
        name=reservoir.name,
        capacity_af=reservoir.capacity_af,
        points=[
            ReservoirSeriesPoint(date=p.date, storage_af=p.storage_af)
            for p in points
        ],
    )


_PCT_COLS = ("none_pct", "d0_pct", "d1_pct", "d2_pct", "d3_pct", "d4_pct")


def _weighted_pcts(rows) -> DroughtPcts:
    """Land-area-weighted average of county percents.

    Counties missing a land area fall back to weight 1 so they still
    count; in practice all 58 have areas seeded.
    """
    totals = dict.fromkeys(_PCT_COLS, 0.0)
    weight_sum = 0.0
    for row in rows:
        weight = row.land_area_sq_miles or 1.0
        weight_sum += weight
        for col in _PCT_COLS:
            totals[col] += getattr(row, col) * weight
    if weight_sum == 0:
        return DroughtPcts(**dict.fromkeys(_PCT_COLS, 0.0))
    return DroughtPcts(**{c: round(totals[c] / weight_sum, 1) for c in _PCT_COLS})


@router.get("/water/drought", response_model=DroughtSnapshotOut)
@_limiter.limit("1000/minute;20000/hour")
def drought_snapshot(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """Latest US Drought Monitor week: statewide land-area-weighted
    severity percents plus every county's breakdown."""
    response.headers["Cache-Control"] = _ONE_HOUR

    latest = db.query(func.max(DroughtCountyWeekly.week_start)).scalar()
    if latest is None:
        raise HTTPException(status_code=404, detail="No drought data loaded")

    rows = (
        db.query(
            DroughtCountyWeekly.county_code,
            *[getattr(DroughtCountyWeekly, c) for c in _PCT_COLS],
            County.land_area_sq_miles,
        )
        .join(County, County.code == DroughtCountyWeekly.county_code)
        .filter(DroughtCountyWeekly.week_start == latest)
        .order_by(DroughtCountyWeekly.county_code)
        .all()
    )

    return DroughtSnapshotOut(
        week_start=latest,
        statewide=_weighted_pcts(rows),
        counties=[
            DroughtCountyOut(
                county_code=r.county_code,
                **{c: getattr(r, c) for c in _PCT_COLS},
            )
            for r in rows
        ],
    )


@router.get("/water/drought/series", response_model=list[DroughtWeekPoint])
@_limiter.limit("1000/minute;20000/hour")
def drought_series(
    request: Request,
    response: Response,
    weeks: int = Query(104, ge=1, le=1400),
    db: Session = Depends(get_db),
):
    """Statewide land-area-weighted drought percents per week, oldest
    first — the trend behind the snapshot."""
    response.headers["Cache-Control"] = _ONE_HOUR

    weight = func.coalesce(County.land_area_sq_miles, 1.0)
    weighted = [
        (
            func.sum(getattr(DroughtCountyWeekly, c) * weight)
            / func.sum(weight)
        ).label(c)
        for c in _PCT_COLS
    ]
    recent_weeks = (
        db.query(DroughtCountyWeekly.week_start)
        .distinct()
        .order_by(DroughtCountyWeekly.week_start.desc())
        .limit(weeks)
        .subquery()
    )
    rows = (
        db.query(DroughtCountyWeekly.week_start, *weighted)
        .join(County, County.code == DroughtCountyWeekly.county_code)
        .filter(DroughtCountyWeekly.week_start.in_(recent_weeks.select()))
        .group_by(DroughtCountyWeekly.week_start)
        .order_by(DroughtCountyWeekly.week_start)
        .all()
    )

    return [
        DroughtWeekPoint(
            week_start=r.week_start,
            **{c: round(getattr(r, c), 1) for c in _PCT_COLS},
        )
        for r in rows
    ]
