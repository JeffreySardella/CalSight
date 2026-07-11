"""Water module — reservoir conditions (CDEC) and drought status (USDM)."""

from collections import defaultdict
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    County,
    DroughtCountyWeekly,
    Reservoir,
    ReservoirDaily,
    SnowDaily,
    SnowStation,
)
from app.schemas.drought import (
    DroughtCountyOut,
    DroughtPcts,
    DroughtSnapshotOut,
    DroughtWeekPoint,
)
from app.schemas.snow import RegionSnowpack, SnowpackOut
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

    # (average, number of years contributing) per station.
    averages: dict[str, tuple[float, int]] = {}
    for (month, day), station_ids in stations_by_md.items():
        avg_rows = (
            db.query(
                ReservoirDaily.station_id,
                func.avg(ReservoirDaily.storage_af).label("avg_af"),
                func.count().label("years"),
            )
            .filter(
                ReservoirDaily.station_id.in_(station_ids),
                func.extract("month", ReservoirDaily.date) == month,
                func.extract("day", ReservoirDaily.date) == day,
            )
            .group_by(ReservoirDaily.station_id)
            .all()
        )
        averages.update({sid: (float(avg), years) for sid, avg, years in avg_rows})

    out = []
    for reservoir, obs in rows:
        avg, years = averages.get(reservoir.station_id, (None, 0))
        # With a single loaded year the average IS the latest value —
        # pct_of_average of 100 would be meaningless noise, so surface
        # the average only once more than one year contributes.
        has_history = avg is not None and years > 1
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

    q = db.query(ReservoirDaily.date, ReservoirDaily.storage_af).filter(
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
            ReservoirSeriesPoint(date=d, storage_af=s) for d, s in points
        ],
    )


_PCT_COLS = ("none_pct", "d0_pct", "d1_pct", "d2_pct", "d3_pct", "d4_pct")


def _weighted_pct_columns():
    """SQL columns for the land-area-weighted statewide percents.

    The single definition both drought endpoints aggregate with, so the
    snapshot headline and the series' latest point can never disagree.
    Counties missing a land area fall back to weight 1 so they still count.
    """
    weight = func.coalesce(County.land_area_sq_miles, 1.0)
    return [
        (
            func.sum(getattr(DroughtCountyWeekly, c) * weight) / func.sum(weight)
        ).label(c)
        for c in _PCT_COLS
    ]


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

    statewide = (
        db.query(*_weighted_pct_columns())
        .select_from(DroughtCountyWeekly)
        .join(County, County.code == DroughtCountyWeekly.county_code)
        .filter(DroughtCountyWeekly.week_start == latest)
        .one()
    )

    rows = (
        db.query(
            DroughtCountyWeekly.county_code,
            *[getattr(DroughtCountyWeekly, c) for c in _PCT_COLS],
        )
        .filter(DroughtCountyWeekly.week_start == latest)
        .order_by(DroughtCountyWeekly.county_code)
        .all()
    )

    return DroughtSnapshotOut(
        week_start=latest,
        statewide=DroughtPcts(
            **{c: round(getattr(statewide, c), 1) for c in _PCT_COLS}
        ),
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

    recent_weeks = (
        db.query(DroughtCountyWeekly.week_start)
        .distinct()
        .order_by(DroughtCountyWeekly.week_start.desc())
        .limit(weeks)
        .subquery()
    )
    rows = (
        db.query(DroughtCountyWeekly.week_start, *_weighted_pct_columns())
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


# Below this SWE (inches) there is essentially no snow to compare against,
# so a "percent of average" would be noise (near-0 / near-0). Applied PER
# STATION to that station's day-of-year average — snowpack percentages are
# meaningful in accumulation season, not late summer.
_MIN_MEANINGFUL_SWE = 0.5

# A station's latest reading must be within this many days of the newest
# reading across all stations to count as "current" — a snow sensor that
# went offline (buried, seasonal) must not contribute a stale last-ever
# value to the current snowpack total.
_SNOW_RECENCY_DAYS = 14


@router.get("/water/snowpack", response_model=SnowpackOut)
@_limiter.limit("1000/minute;20000/hour")
def snowpack(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """Latest snow water equivalent by DWR region and statewide, each as a
    percent of the same-day-of-year historical average across stations."""
    response.headers["Cache-Control"] = _ONE_HOUR

    # Latest observation per station.
    latest_sq = (
        db.query(
            SnowDaily.station_id,
            func.max(SnowDaily.date).label("latest_date"),
        )
        .group_by(SnowDaily.station_id)
        .subquery()
    )
    rows = (
        db.query(SnowStation.station_id, SnowStation.region, SnowDaily.date, SnowDaily.swe_in)
        .join(latest_sq, latest_sq.c.station_id == SnowStation.station_id)
        .join(
            SnowDaily,
            (SnowDaily.station_id == latest_sq.c.station_id)
            & (SnowDaily.date == latest_sq.c.latest_date),
        )
        .all()
    )
    if not rows:
        raise HTTPException(status_code=404, detail="No snowpack data loaded")

    # Same-day-of-year average (and contributing-year count) per station,
    # grouped by the distinct (month, day) of the latest readings.
    stations_by_md: dict[tuple[int, int], list[str]] = defaultdict(list)
    for r in rows:
        stations_by_md[(r.date.month, r.date.day)].append(r.station_id)
    averages: dict[str, tuple[float, int]] = {}
    for (month, day), station_ids in stations_by_md.items():
        for sid, avg, years in (
            db.query(
                SnowDaily.station_id,
                func.avg(SnowDaily.swe_in),
                func.count(),
            )
            .filter(
                SnowDaily.station_id.in_(station_ids),
                func.extract("month", SnowDaily.date) == month,
                func.extract("day", SnowDaily.date) == day,
            )
            .group_by(SnowDaily.station_id)
            .all()
        ):
            averages[sid] = (float(avg), years)

    # Drop stations whose latest reading is stale (offline sensor) — they
    # must not contribute a years-old value to the "current" snowpack.
    newest = max(r.date for r in rows)
    cutoff = newest - timedelta(days=_SNOW_RECENCY_DAYS)
    current = [r for r in rows if r.date >= cutoff]
    if not current:
        raise HTTPException(status_code=404, detail="No recent snowpack data")

    # Split each region's current stations into:
    #   comparable — has >1 year of history AND a non-trivial day-of-year
    #     average (so a percent-of-average is meaningful); and
    #   the rest — shown for their current SWE only.
    # All reported figures for a region come from ONE station set so
    # swe_in, avg_swe_in and pct_of_average always reconcile with each
    # other: when a percent is shown, swe_in IS that percent of avg_swe_in.
    by_region: dict[str, list] = defaultdict(list)
    for r in current:
        by_region[r.region].append(r)

    def mean(values: list[float]) -> float:
        return sum(values) / len(values)

    def summarize(region_rows) -> dict:
        comparable = [
            (r, averages[r.station_id][0])
            for r in region_rows
            if (m := averages.get(r.station_id))
            and m[1] > 1
            and m[0] >= _MIN_MEANINGFUL_SWE
        ]
        if comparable:
            swe = mean([r.swe_in for r, _ in comparable])
            avg = mean([a for _, a in comparable])
            return {
                "count": len(comparable),
                "date": max(r.date for r, _ in comparable),
                "swe": swe,
                "avg": avg,
                "pct": round(swe / avg * 100, 1),
            }
        # No usable baseline (e.g. deep summer, or a brand-new station) —
        # report current SWE across the recent stations, no percent.
        return {
            "count": len(region_rows),
            "date": max(r.date for r in region_rows),
            "swe": mean([r.swe_in for r in region_rows]),
            "avg": None,
            "pct": None,
        }

    regions = []
    for region, region_rows in sorted(by_region.items()):
        s = summarize(region_rows)
        regions.append(
            RegionSnowpack(
                region=region,
                station_count=s["count"],
                latest_date=s["date"],
                swe_in=round(s["swe"], 1),
                avg_swe_in=round(s["avg"], 1) if s["avg"] is not None else None,
                pct_of_average=s["pct"],
            )
        )

    # Statewide percent from every comparable station (mean SWE / mean avg).
    comparable_state = [
        (r.swe_in, averages[r.station_id][0])
        for r in current
        if (m := averages.get(r.station_id)) and m[1] > 1 and m[0] >= _MIN_MEANINGFUL_SWE
    ]
    statewide_pct = (
        round(mean([s for s, _ in comparable_state])
              / mean([a for _, a in comparable_state]) * 100, 1)
        if comparable_state
        else None
    )

    return SnowpackOut(
        latest_date=newest,
        statewide_pct_of_average=statewide_pct,
        regions=regions,
    )
