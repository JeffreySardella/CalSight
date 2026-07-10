"""Water module — reservoir conditions from CDEC daily storage data."""

from collections import defaultdict
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Reservoir, ReservoirDaily
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
