"""DB-backed tests for the first-rain pipeline: daily weather upsert, the
first_rain ETL, and /api/first-rain."""

from datetime import date, datetime, timedelta

import pytest

from app.models import Crash, FirstRainEvent, WeatherDaily
from etl.compute_first_rain import compute_events
from etl.nclimgrid_weather import upsert_daily

pytestmark = pytest.mark.integration

FIRST_RAIN = date(2025, 10, 21)  # WY 2026, after 20 dry days from Oct 1


def _seed_first_rain(db_session, county_code=19, crashes_on_day=3, crashes_before=28):
    """20 dry days, then 0.4" on Oct 21; `crashes_before` spread one per day
    over the 28-day baseline window (baseline = crashes_before / 28)."""
    db_session.add_all(
        [WeatherDaily(county_code=county_code, date=date(2025, 10, 1) + timedelta(days=i), precip_in=0.0)
         for i in range(20)]
        + [WeatherDaily(county_code=county_code, date=FIRST_RAIN, precip_in=0.4)]
    )
    base_id = 900_000 + county_code * 1000
    db_session.add_all(
        [Crash(id=base_id + i, collision_id=base_id + i, data_source="ccrs", county_code=county_code,
               crash_datetime=datetime.combine(FIRST_RAIN - timedelta(days=28 - i), datetime.min.time()) + timedelta(hours=8))
         for i in range(crashes_before)]
        + [Crash(id=base_id + 500 + i, collision_id=base_id + 500 + i, data_source="ccrs", county_code=county_code,
                 crash_datetime=datetime.combine(FIRST_RAIN, datetime.min.time()) + timedelta(hours=i))
           for i in range(crashes_on_day)]
    )
    db_session.flush()


def test_compute_events_counts_day_and_baseline(db_session):
    _seed_first_rain(db_session)
    events, counties, skipped = compute_events(db_session, [2025, 2026])
    assert (events, counties, skipped) == (1, 1, 4)  # 5 seeded counties, 1 with weather

    ev = db_session.query(FirstRainEvent).one()
    assert (ev.county_code, ev.water_year, ev.first_rain_date) == (19, 2026, FIRST_RAIN)
    assert (ev.precip_in, ev.dry_days_before) == (0.4, 20)
    assert (ev.crashes_on_day, ev.baseline_daily_crashes, ev.baseline_days) == (3, 1.0, 28)
    assert ev.lift_pct == 200.0

    # Re-running upserts in place rather than duplicating.
    compute_events(db_session, [2026])
    assert db_session.query(FirstRainEvent).count() == 1


def _seed_api(db_session):
    _seed_first_rain(db_session)
    # Four dry days after the event push weather_through past it; Orange has
    # weather but never rains, so it gets no event and no last_rain_date.
    db_session.add_all(
        [WeatherDaily(county_code=19, date=FIRST_RAIN + timedelta(days=i), precip_in=0.0) for i in range(1, 5)]
        + [WeatherDaily(county_code=30, date=date(2025, 10, 1) + timedelta(days=i), precip_in=0.0) for i in range(25)]
    )
    db_session.flush()
    compute_events(db_session, [2026])


def test_first_rain_summary(client, db_session):
    _seed_api(db_session)
    r = client.get("/api/first-rain")
    assert r.status_code == 200
    assert r.headers["cache-control"].startswith("public, max-age=3600")
    body = r.json()

    assert (body["threshold_in"], body["min_dry_days"], body["baseline_days"]) == (0.10, 14, 28)
    assert body["weather_through"] == "2025-10-25"

    assert body["statewide"] == {
        "water_years": 1,
        "median_lift_pct": 200.0,
        "events": [{
            "water_year": 2026, "counties": 1, "crashes_on_first_rain_days": 3,
            "baseline_expected": 1.0, "lift_pct": 200.0, "median_first_rain_date": "2025-10-21",
        }],
    }

    assert body["counties"] == [{
        "county_code": 19, "county_name": "Los Angeles", "county_slug": "los-angeles",
        "water_year": 2026, "first_rain_date": "2025-10-21", "precip_in": 0.4,
        "dry_days_before": 20, "crashes_on_day": 3, "baseline_daily_crashes": 1.0,
        "lift_pct": 200.0, "small_baseline": True,
    }]

    by_code = {row["county_code"]: row for row in body["days_since_rain"]}
    assert len(by_code) == 5  # every seeded county, with or without weather
    assert by_code[19] == {"county_code": 19, "county_name": "Los Angeles", "county_slug": "los-angeles",
                           "last_rain_date": "2025-10-21", "days": 4}
    assert by_code[30]["last_rain_date"] is None and by_code[30]["days"] is None
    assert by_code[1]["days"] is None


def test_first_rain_summary_empty(client):
    body = client.get("/api/first-rain").json()
    assert body["weather_through"] is None
    assert body["statewide"] == {"water_years": 0, "median_lift_pct": None, "events": []}
    assert body["counties"] == []
    assert len(body["days_since_rain"]) == 5


def test_first_rain_series(client, db_session):
    _seed_api(db_session)
    r = client.get("/api/first-rain/series?county=los-angeles&water_year=2026")
    assert r.status_code == 200
    body = r.json()
    assert (body["county_code"], body["county_name"], body["water_year"]) == (19, "Los Angeles", 2026)
    assert body["first_rain_date"] == "2025-10-21"

    points = body["points"]
    assert len(points) == 29
    assert points[0]["date"] == "2025-10-07" and points[-1]["date"] == "2025-11-04"
    by_date = {p["date"]: p for p in points}
    assert by_date["2025-10-21"] == {"date": "2025-10-21", "crashes": 3, "precip_in": 0.4, "is_first_rain": True}
    assert by_date["2025-10-20"] == {"date": "2025-10-20", "crashes": 1, "precip_in": 0.0, "is_first_rain": False}
    # Past the weather record: no precip row, no crashes.
    assert by_date["2025-10-26"] == {"date": "2025-10-26", "crashes": 0, "precip_in": None, "is_first_rain": False}
    assert sum(p["is_first_rain"] for p in points) == 1


def test_first_rain_series_404_without_event(client, db_session):
    _seed_api(db_session)
    assert client.get("/api/first-rain/series?county=los-angeles&water_year=2025").status_code == 404
    assert client.get("/api/first-rain/series?county=orange&water_year=2026").status_code == 404
    assert client.get("/api/first-rain/series?county=atlantis&water_year=2026").status_code == 422


def test_upsert_daily_fills_one_row_from_two_variables(db_session):
    """PRCP and TAVG arrive in separate files; each must only touch its own
    column so the second upsert doesn't null out the first."""
    name_to_code = {"Los Angeles": 19}
    d = date(2026, 1, 3)

    n = upsert_daily(db_session, "PRCP", {"Los Angeles": {d: 0.5}, "Nowhere": {d: 1.0}}, name_to_code)
    assert n == 1
    upsert_daily(db_session, "TAVG", {"Los Angeles": {d: 61.0}}, name_to_code)
    # Re-upsert of PRCP with a revised value must overwrite precip only.
    upsert_daily(db_session, "PRCP", {"Los Angeles": {d: 0.75}}, name_to_code)

    rows = db_session.query(WeatherDaily).filter_by(county_code=19).all()
    assert len(rows) == 1
    assert rows[0].date == d
    assert rows[0].precip_in == 0.75
    assert rows[0].avg_temp_f == 61.0
    assert rows[0].max_temp_f is None
