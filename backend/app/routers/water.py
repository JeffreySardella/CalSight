"""Water module — reservoir conditions (CDEC) and drought status (USDM)."""

from collections import defaultdict
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from slowapi import Limiter
from sqlalchemy import func, select
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
from app.rate_limit import rate_limit_key
from app.schemas.water import (
    ReservoirConditionOut,
    ReservoirSeriesOut,
    ReservoirSeriesPoint,
)

router = APIRouter(tags=["water"])

_limiter = Limiter(key_func=rate_limit_key)

_ONE_HOUR = "public, max-age=3600"


class StationCondition:
    """One station's latest daily reading plus its same-day-of-year history."""

    __slots__ = ("station_id", "latest_date", "value", "avg", "years")

    def __init__(self, station_id, latest_date, value, avg, years):
        self.station_id = station_id
        self.latest_date = latest_date
        self.value = value
        self.avg = avg          # mean value on this (month, day) across years, or None
        self.years = years      # number of years contributing to `avg`

    @property
    def has_history(self) -> bool:
        # A single loaded year averages to exactly the latest value, so a
        # percent-of-average would be meaningless noise until >1 year exists.
        return self.avg is not None and self.years > 1


def latest_with_doy_average(db, model, value_col) -> dict[str, StationCondition]:
    """For a daily ``(station_id, date, value_col)`` table, return each
    station's latest reading with its same-day-of-year historical average
    and contributing-year count.

    Two queries regardless of station count: the latest row per station,
    then one grouped average per distinct (month, day) in that latest set
    (served by the ``..._station_doy`` expression index). Shared by the
    reservoir and snowpack endpoints so the day-of-year logic lives once.
    """
    latest_sq = (
        db.query(model.station_id, func.max(model.date).label("latest_date"))
        .group_by(model.station_id)
        .subquery()
    )
    latest_rows = (
        db.query(model.station_id, model.date, value_col)
        .join(
            latest_sq,
            (model.station_id == latest_sq.c.station_id)
            & (model.date == latest_sq.c.latest_date),
        )
        .all()
    )

    stations_by_md: dict[tuple[int, int], list[str]] = defaultdict(list)
    for sid, d, _ in latest_rows:
        stations_by_md[(d.month, d.day)].append(sid)

    averages: dict[str, tuple[float, int]] = {}
    for (month, day), sids in stations_by_md.items():
        for sid, avg, years in (
            db.query(model.station_id, func.avg(value_col), func.count())
            .filter(
                model.station_id.in_(sids),
                func.extract("month", model.date) == month,
                func.extract("day", model.date) == day,
            )
            .group_by(model.station_id)
            .all()
        ):
            averages[sid] = (float(avg), years)

    return {
        sid: StationCondition(sid, d, v, *averages.get(sid, (None, 0)))
        for sid, d, v in latest_rows
    }


# A reservoir's latest reading must be within this many days of the newest
# reading across all reservoirs to count as "current" — same rationale as
# _SNOW_RECENCY_DAYS: a station whose CDEC feed died must not contribute a
# months-old value to today's cards and statewide totals. CDEC reservoirs
# report daily, so 14 days is generous.
_RESERVOIR_RECENCY_DAYS = 14


@router.get("/water/reservoirs", response_model=list[ReservoirConditionOut])
@_limiter.limit("1000/minute;20000/hour")
def list_reservoir_conditions(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """Every tracked reservoir with a current storage reading, its
    percent of capacity, and percent of the historical average for
    that day of year. Stations whose feed has gone stale are omitted
    rather than shown with an old reading."""
    response.headers["Cache-Control"] = _ONE_HOUR

    conditions = latest_with_doy_average(db, ReservoirDaily, ReservoirDaily.storage_af)
    if conditions:
        newest = max(c.latest_date for c in conditions.values())
        cutoff = newest - timedelta(days=_RESERVOIR_RECENCY_DAYS)
        conditions = {
            sid: c for sid, c in conditions.items() if c.latest_date >= cutoff
        }
    reservoirs = (
        db.query(Reservoir)
        .filter(Reservoir.station_id.in_(conditions.keys()))
        .order_by(Reservoir.capacity_af.desc())
        .all()
    )

    out = []
    for reservoir in reservoirs:
        c = conditions[reservoir.station_id]
        out.append(
            ReservoirConditionOut(
                station_id=reservoir.station_id,
                name=reservoir.name,
                capacity_af=reservoir.capacity_af,
                county_code=reservoir.county_code,
                lat=reservoir.lat,
                lon=reservoir.lon,
                latest_date=c.latest_date,
                storage_af=c.value,
                pct_of_capacity=round(c.value / reservoir.capacity_af * 100, 1),
                avg_storage_af=round(c.avg, 1) if c.has_history else None,
                pct_of_average=(
                    round(c.value / c.avg * 100, 1)
                    if c.has_history and c.avg > 0
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
    """Daily storage time series for one reservoir, optionally windowed.

    With no ``start``, the window defaults to the year before ``end`` (or
    today) — after a multi-decade backfill the full history is ~10k rows
    per station, and no UI consumer asks for more than a year at once.
    """
    response.headers["Cache-Control"] = _ONE_HOUR

    reservoir = db.get(Reservoir, station_id.upper())
    if reservoir is None:
        raise HTTPException(status_code=404, detail="Unknown reservoir")

    if start is None:
        start = (end or date.today()) - timedelta(days=365)

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
    Counties missing a land area fall back to the average county land
    area — falling back to 1.0 would effectively zero-weight them against
    counties measured in thousands of square miles.
    """
    avg_area = (
        select(func.avg(County.land_area_sq_miles))
        .where(County.land_area_sq_miles.isnot(None))
        .scalar_subquery()
    )
    weight = func.coalesce(County.land_area_sq_miles, avg_area, 1.0)
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

    conditions = latest_with_doy_average(db, SnowDaily, SnowDaily.swe_in)
    if not conditions:
        raise HTTPException(status_code=404, detail="No snowpack data loaded")
    region_of = dict(db.query(SnowStation.station_id, SnowStation.region).all())

    # Drop stations whose latest reading is stale (offline sensor) — they
    # must not contribute a years-old value to the "current" snowpack.
    newest = max(c.latest_date for c in conditions.values())
    cutoff = newest - timedelta(days=_SNOW_RECENCY_DAYS)
    current = [c for c in conditions.values() if c.latest_date >= cutoff]
    if not current:
        raise HTTPException(status_code=404, detail="No recent snowpack data")

    def is_comparable(c: StationCondition) -> bool:
        # Needs a real day-of-year baseline for a meaningful percent: >1
        # year of history AND a non-trivial average (not deep-summer noise).
        return c.has_history and c.avg >= _MIN_MEANINGFUL_SWE

    def mean(values: list[float]) -> float:
        return sum(values) / len(values)

    # Every reported figure for a region comes from ONE station set, so
    # swe_in, avg_swe_in and pct_of_average always reconcile: when a percent
    # is shown, swe_in IS that percent of avg_swe_in.
    def summarize(region: str, cs: list[StationCondition]) -> RegionSnowpack:
        comparable = [c for c in cs if is_comparable(c)]
        used = comparable or cs
        swe = mean([c.value for c in used])
        avg = mean([c.avg for c in comparable]) if comparable else None
        return RegionSnowpack(
            region=region,
            station_count=len(used),
            latest_date=max(c.latest_date for c in used),
            swe_in=round(swe, 1),
            avg_swe_in=round(avg, 1) if avg is not None else None,
            pct_of_average=round(swe / avg * 100, 1) if avg is not None else None,
        )

    by_region: dict[str, list[StationCondition]] = defaultdict(list)
    for c in current:
        region = region_of.get(c.station_id)
        if region:  # snow_daily FK guarantees a station row; guard anyway
            by_region[region].append(c)

    regions = [summarize(region, cs) for region, cs in sorted(by_region.items())]

    # Statewide percent from every comparable station (mean SWE / mean avg).
    comparable_state = [c for c in current if is_comparable(c)]
    statewide_pct = (
        round(
            mean([c.value for c in comparable_state])
            / mean([c.avg for c in comparable_state]) * 100,
            1,
        )
        if comparable_state
        else None
    )

    return SnowpackOut(
        latest_date=newest,
        statewide_pct_of_average=statewide_pct,
        regions=regions,
    )
