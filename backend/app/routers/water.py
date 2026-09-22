"""Water module — reservoir conditions (CDEC) and drought status (USDM)."""

from collections import Counter, defaultdict
from datetime import date, timedelta
from statistics import fmean
from typing import NamedTuple

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from slowapi import Limiter
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    County,
    DroughtCountyWeekly,
    PrecipIndexDaily,
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
from app.schemas.precip import PrecipIndexOut
from app.schemas.snow import RegionSnowpack, SnowpackOut, SnowStationSnowpack
from app.rate_limit import rate_limit_key
from app.schemas.water import (
    ReservoirConditionOut,
    ReservoirSeriesOut,
    ReservoirSeriesPoint,
)

router = APIRouter(tags=["water"])

_limiter = Limiter(key_func=rate_limit_key)

_ONE_HOUR = "public, max-age=3600"

# DWR reports conditions against the 1991-2020 climatological normal, not
# the whole period of record (which lets the current low year drag its own
# baseline down). A station-day uses that window when at least
# MIN_NORMAL_YEARS of its readings fall inside it; shorter records fall back
# to everything loaded so recently installed stations keep working.
NORMAL_PERIOD = (1991, 2020)
MIN_NORMAL_YEARS = 10


class Baseline(NamedTuple):
    avg: float | None
    years: int              # readings contributing to `avg`
    period: str | None      # "1991-2020" or the period of record, e.g. "2012-2026"


def pick_baseline(rows) -> Baseline:
    """Day-of-year baseline from one station's ``(year, value)`` readings on
    one calendar day: the NORMAL_PERIOD mean when >= MIN_NORMAL_YEARS of
    those years fall inside it, otherwise the full period of record."""
    rows = list(rows)
    if not rows:
        return Baseline(None, 0, None)
    lo, hi = NORMAL_PERIOD
    normal = [v for y, v in rows if lo <= y <= hi]
    if len(normal) >= MIN_NORMAL_YEARS:
        return Baseline(fmean(normal), len(normal), f"{lo}-{hi}")
    years = [y for y, _ in rows]
    return Baseline(fmean(v for _, v in rows), len(rows), f"{min(years)}-{max(years)}")


def _common_period(periods) -> str | None:
    """The baseline period most of a station set rests on (for footnotes)."""
    periods = [p for p in periods if p]
    return Counter(periods).most_common(1)[0][0] if periods else None


def doy_baselines(db, model, value_col, station_ids, month, day) -> dict[str, Baseline]:
    """Per-station baseline for one (month, day): one query for the yearly
    readings (served by the ``..._station_doy`` expression index), reduced
    in Python by pick_baseline. Every water day-of-year average goes
    through here."""
    by_sid: dict[str, list[tuple[int, float]]] = defaultdict(list)
    for sid, d, v in (
        db.query(model.station_id, model.date, value_col)
        .filter(
            model.station_id.in_(station_ids),
            func.extract("month", model.date) == month,
            func.extract("day", model.date) == day,
        )
        .all()
    ):
        by_sid[sid].append((d.year, v))
    return {sid: pick_baseline(rows) for sid, rows in by_sid.items()}


class StationCondition:
    """One station's latest daily reading plus its same-day-of-year baseline."""

    __slots__ = ("station_id", "latest_date", "value", "avg", "years", "baseline_period")

    def __init__(self, station_id, latest_date, value, avg, years, baseline_period):
        self.station_id = station_id
        self.latest_date = latest_date
        self.value = value
        self.avg = avg          # baseline mean on this (month, day), or None
        self.years = years      # number of years contributing to `avg`
        self.baseline_period = baseline_period  # see Baseline.period

    @property
    def has_history(self) -> bool:
        # A single loaded year averages to exactly the latest value, so a
        # percent-of-average would be meaningless noise until >1 year exists.
        return self.avg is not None and self.years > 1


def latest_with_doy_average(db, model, value_col) -> dict[str, StationCondition]:
    """For a daily ``(station_id, date, value_col)`` table, return each
    station's latest reading with its same-day-of-year baseline (see
    pick_baseline) and contributing-year count.

    Two queries regardless of station count: the latest row per station,
    then one day-of-year query per distinct (month, day) in that latest set.
    Shared by the reservoir, precip and snowpack endpoints so the
    day-of-year logic lives once.
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

    baselines: dict[str, Baseline] = {}
    for (month, day), sids in stations_by_md.items():
        baselines.update(doy_baselines(db, model, value_col, sids, month, day))

    return {
        sid: StationCondition(sid, d, v, *baselines.get(sid, Baseline(None, 0, None)))
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
    percent of capacity, and percent of the 1991-2020 normal (or period
    of record — see pick_baseline) for that day of year. Stations whose
    feed has gone stale are omitted rather than shown with an old reading."""
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
                baseline_period=c.baseline_period if c.has_history else None,
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


# A precip index's latest reading must be within this many days of the newest
# across the three indices to count as current — same rationale as reservoirs.
_PRECIP_RECENCY_DAYS = 14


@router.get("/water/precip", response_model=list[PrecipIndexOut])
@_limiter.limit("1000/minute;20000/hour")
def precip_indices(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """DWR's three regional precipitation indices (8SI/5SI/6SI) with their
    latest accumulated water-year total and percent of the 1991-2020 normal
    (or period of record — see pick_baseline) for that day of year. The
    8-Station Index is the headline Northern Sierra wet-season number."""
    response.headers["Cache-Control"] = _ONE_HOUR

    # Imported here (not at module top) to keep the ETL station map — an ETL
    # concern — out of the API module's import surface, matching how the
    # water endpoints already avoid importing loader internals.
    from etl.cdec_api import PRECIP_INDEX_STATIONS

    conditions = latest_with_doy_average(
        db, PrecipIndexDaily, PrecipIndexDaily.accum_in
    )
    if not conditions:
        raise HTTPException(status_code=404, detail="No precip-index data loaded")

    newest = max(c.latest_date for c in conditions.values())
    cutoff = newest - timedelta(days=_PRECIP_RECENCY_DAYS)

    out = []
    for station_id, meta in PRECIP_INDEX_STATIONS.items():
        c = conditions.get(station_id)
        if c is None or c.latest_date < cutoff:
            continue
        out.append(
            PrecipIndexOut(
                station_id=station_id,
                name=meta["name"],
                region=meta["region"],
                latest_date=c.latest_date,
                accum_in=round(c.value, 1),
                avg_accum_in=round(c.avg, 1) if c.has_history else None,
                pct_of_average=(
                    round(c.value / c.avg * 100, 1)
                    if c.has_history and c.avg > 0
                    else None
                ),
                baseline_period=c.baseline_period if c.has_history else None,
            )
        )
    return out


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


def _april1_stats(db, station_ids, newest: date):
    """This season's April-1 SWE and the historical April-1 average per
    station — the inputs for DWR's season-defining "% of April 1 average".

    Returns (apr1_date, {sid: swe}, {sid: Baseline}). The baseline follows
    pick_baseline: DWR's 1991-2020 normal where the station has enough
    April-1 readings inside it, else its period of record.

    Pass EVERY known station, not just the current reporters: a seasonal
    sensor that reported on April 1 but has since melted out or gone offline
    still counts toward the season-defining percent.
    """
    apr1 = date(newest.year, 4, 1)
    if newest < apr1:
        apr1 = date(newest.year - 1, 4, 1)

    readings = dict(
        db.query(SnowDaily.station_id, SnowDaily.swe_in)
        .filter(SnowDaily.station_id.in_(station_ids), SnowDaily.date == apr1)
        .all()
    )
    return apr1, readings, doy_baselines(db, SnowDaily, SnowDaily.swe_in, station_ids, 4, 1)


@router.get("/water/snowpack", response_model=SnowpackOut)
@_limiter.limit("1000/minute;20000/hour")
def snowpack(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """Latest snow water equivalent by DWR region and statewide, as a
    percent of the same-day-of-year 1991-2020 normal across stations (see
    pick_baseline), plus the season-defining percent of the April-1 normal."""
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

    # The April-1 set is independent of who is reporting NOW: by September
    # most seasonal pillows are melted out (below the SWE floor) or offline,
    # and restricting April 1 to the survivors skewed the regional split.
    apr1_date, apr1_readings, apr1_averages = _april1_stats(db, list(region_of), newest)

    def apr1_comparable(sids: list[str]) -> list[str]:
        # A station counts toward the April-1 percent when it reported that
        # April 1 AND has a usable multi-year April-1 baseline.
        return [
            s
            for s in sids
            if s in apr1_readings
            and s in apr1_averages
            and apr1_averages[s].years > 1
            and apr1_averages[s].avg >= _MIN_MEANINGFUL_SWE
        ]

    def apr1_trio(sids: list[str]):
        sids = apr1_comparable(sids)
        if not sids:
            return None, None, None, 0
        swe = fmean(apr1_readings[s] for s in sids)
        avg = fmean(apr1_averages[s].avg for s in sids)
        return round(swe, 1), round(avg, 1), round(swe / avg * 100, 1), len(sids)

    def baseline_period(cs: list[StationCondition], sids: list[str]) -> str | None:
        # One footnote per set: the period most of its comparable stations
        # (day-of-year and April-1 alike) are measured against.
        return _common_period(
            [c.baseline_period for c in cs if is_comparable(c)]
            + [apr1_averages[s].period for s in apr1_comparable(sids)]
        )

    stations_by_region: dict[str, list[str]] = defaultdict(list)
    for sid, region in region_of.items():
        stations_by_region[region].append(sid)

    # Every reported figure for a region comes from ONE station set, so
    # swe_in, avg_swe_in and pct_of_average always reconcile: when a percent
    # is shown, swe_in IS that percent of avg_swe_in. (The apr1_* trio uses
    # its own set — every station in the region with an April-1 reading —
    # and reconciles within itself the same way.)
    def summarize(region: str, cs: list[StationCondition]) -> RegionSnowpack:
        comparable = [c for c in cs if is_comparable(c)]
        used = comparable or cs
        swe = fmean(c.value for c in used)
        avg = fmean(c.avg for c in comparable) if comparable else None
        apr1_swe, apr1_avg, apr1_pct, apr1_n = apr1_trio(stations_by_region[region])
        return RegionSnowpack(
            region=region,
            station_count=len(used),
            latest_date=max(c.latest_date for c in used),
            swe_in=round(swe, 1),
            avg_swe_in=round(avg, 1) if avg is not None else None,
            pct_of_average=round(swe / avg * 100, 1) if avg is not None else None,
            apr1_swe_in=apr1_swe,
            apr1_avg_swe_in=apr1_avg,
            apr1_pct_of_average=apr1_pct,
            apr1_station_count=apr1_n or None,
            baseline_period=baseline_period(cs, stations_by_region[region]),
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
            fmean(c.value for c in comparable_state)
            / fmean(c.avg for c in comparable_state) * 100,
            1,
        )
        if comparable_state
        else None
    )

    _, _, statewide_apr1_pct, statewide_apr1_n = apr1_trio(list(region_of))

    return SnowpackOut(
        latest_date=newest,
        statewide_pct_of_average=statewide_pct,
        apr1_date=apr1_date if statewide_apr1_pct is not None else None,
        statewide_apr1_pct_of_average=statewide_apr1_pct,
        apr1_station_count=statewide_apr1_n or None,
        baseline_period=baseline_period(current, list(region_of)),
        regions=regions,
    )
