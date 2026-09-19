"""Integration tests for /api/holidays.

The shared conftest seed has no crashes on any holiday, so this module commits
its own handful of rows into a year it controls (2024), refreshes
mv_crashes_by_day, and removes them again at teardown. The numbers are chosen
so every rate and every lift is exact rather than approximate.

Fixture data, county 19 (Los Angeles), November 2024:
  * Nov 28 (Thanksgiving Day): 10 crashes, 2 killed, 4 with canonical_cause
    'dui'. The other four days of the Wed-Sun period are empty, so the period
    is 10 crashes over 5 days = 2.0/day, 0.4 deaths/day, 40% DUI.
  * Nov 5 (an ordinary Tuesday): 5 crashes, 1 killed, 1 DUI. November 2024 has
    25 ordinary days (30, less Nov 1 for Halloween and Nov 27-30 for
    Thanksgiving), so the baseline is 0.2 crashes/day, 0.04 deaths/day, 20% DUI.
  * Lift therefore: crashes +900%, deaths +900%, DUI share +100%.
"""

from datetime import datetime

import pytest
from sqlalchemy import text

from app.routers.holidays import clear_holidays_cache

pytestmark = pytest.mark.integration

_FIRST_ID = 9_000_000
_COUNTY = 19

# (day of November 2024, crashes, killed, dui crashes)
_ROWS = [(28, 10, 2, 4), (5, 5, 1, 1)]


@pytest.fixture(scope="module", autouse=True)
def holiday_crashes(test_engine):
    """Commit the fixture crashes, populate the view, clean up afterwards."""
    with test_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        next_id = _FIRST_ID
        for day, crashes, killed, dui in _ROWS:
            for i in range(crashes):
                conn.execute(text("""
                    INSERT INTO crashes (
                        id, collision_id, data_source, crash_datetime, county_code,
                        county_name, crash_year, crash_month, crash_hour,
                        severity, canonical_cause, number_killed, number_injured
                    ) VALUES (
                        :id, :id, 'ccrs', :dt, :county,
                        'Los Angeles', 2024, 11, 20,
                        :severity, :cause, :killed, 0
                    )
                """), {
                    "id": next_id,
                    "dt": datetime(2024, 11, day, 20, 0),
                    "county": _COUNTY,
                    "severity": "Fatal" if i < killed else "Injury",
                    "cause": "dui" if i < dui else "speeding",
                    "killed": 1 if i < killed else 0,
                })
                next_id += 1
        conn.execute(text("REFRESH MATERIALIZED VIEW mv_crashes_by_day"))

    yield

    with test_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        conn.execute(text("DELETE FROM crashes WHERE id >= :first"), {"first": _FIRST_ID})
        conn.execute(text("REFRESH MATERIALIZED VIEW mv_crashes_by_day"))


@pytest.fixture(autouse=True)
def _no_stale_cache():
    """The endpoint memoises per (years, county); each test starts cold."""
    clear_holidays_cache()
    yield
    clear_holidays_cache()


def _thanksgiving(body):
    return next(h for h in body["holidays"] if h["key"] == "thanksgiving")


def test_returns_every_holiday(client):
    body = client.get("/api/holidays?years=2024-2024").json()
    assert [h["key"] for h in body["holidays"]] == [
        "thanksgiving", "christmas_new_year", "july_4",
        "memorial_day", "labor_day", "super_bowl", "halloween",
    ]
    assert body["first_year"] == 2024 and body["last_year"] == 2024
    assert body["county_code"] is None and body["county_name"] is None


def test_thanksgiving_counts_and_rates(client):
    tg = _thanksgiving(client.get("/api/holidays?years=2024-2024").json())
    assert tg["baseline_month"] == "November"
    assert (tg["days"], tg["crashes"], tg["killed"], tg["dui_crashes"]) == (5, 10, 2, 4)
    assert tg["crashes_per_day"] == 2.0
    assert tg["deaths_per_day"] == 0.4
    assert tg["dui_share_pct"] == 40.0


def test_thanksgiving_baseline_is_ordinary_november_days(client):
    tg = _thanksgiving(client.get("/api/holidays?years=2024-2024").json())
    base = tg["baseline"]
    assert (base["days"], base["crashes"], base["killed"], base["dui_crashes"]) == (25, 5, 1, 1)
    assert base["crashes_per_day"] == 0.2
    assert base["deaths_per_day"] == 0.04
    assert base["dui_share_pct"] == 20.0


def test_lift_arithmetic(client):
    tg = _thanksgiving(client.get("/api/holidays?years=2024-2024").json())
    assert tg["crashes_lift_pct"] == 900.0
    assert tg["deaths_lift_pct"] == 900.0
    assert tg["dui_share_lift_pct"] == 100.0


def test_small_sample_flagged_on_a_lift_built_on_almost_nothing(client):
    tg = _thanksgiving(client.get("/api/holidays?years=2024-2024").json())
    # 0.2 crashes/day baseline is far under the floor: the +900% stands, flagged.
    assert tg["small_sample"] is True
    assert tg["crashes_lift_pct"] == 900.0


def test_every_holiday_carries_the_small_sample_flag(client):
    body = client.get("/api/holidays?years=2024-2024").json()
    assert all(isinstance(h["small_sample"], bool) for h in body["holidays"])


def test_holiday_with_no_crashes_reports_zero_not_an_error(client):
    body = client.get("/api/holidays?years=2024-2024").json()
    sb = next(h for h in body["holidays"] if h["key"] == "super_bowl")
    assert sb["days"] == 1 and sb["crashes"] == 0
    assert sb["crashes_per_day"] == 0.0
    assert sb["crashes_lift_pct"] is None  # zero baseline -> undefined, not 0


def test_county_filter_matches_statewide_when_all_rows_are_in_that_county(client):
    statewide = _thanksgiving(client.get("/api/holidays?years=2024-2024").json())
    la = _thanksgiving(client.get("/api/holidays?years=2024-2024&county=los-angeles").json())
    assert la["crashes"] == statewide["crashes"]
    assert la["crashes_lift_pct"] == statewide["crashes_lift_pct"]


def test_county_filter_names_the_county(client):
    body = client.get("/api/holidays?years=2024-2024&county=orange").json()
    assert body["county_code"] == 30
    assert body["county_name"] == "Orange"
    assert _thanksgiving(body)["crashes"] == 0


def test_multiple_counties_rejected(client):
    r = client.get("/api/holidays?years=2024-2024&county=orange,los-angeles")
    assert r.status_code == 422
    assert r.json()["filter"] == "county"


def test_unknown_county_rejected(client):
    r = client.get("/api/holidays?years=2024-2024&county=atlantis")
    assert r.status_code == 422


@pytest.mark.parametrize("years", ["2024", "20xx-2024", "2024-2016", "1999-2024"])
def test_bad_year_ranges_rejected(client, years):
    r = client.get(f"/api/holidays?years={years}")
    assert r.status_code == 422
    assert r.json()["filter"] == "years"


def test_current_year_rejected(client):
    from datetime import date
    r = client.get(f"/api/holidays?years=2016-{date.today().year}")
    assert r.status_code == 422


def test_default_year_range_stops_at_the_last_complete_year(client):
    from datetime import date
    body = client.get("/api/holidays").json()
    assert body["first_year"] == 2016
    assert body["last_year"] == date.today().year - 1


def test_unpopulated_view_returns_empty_payload_not_500(client, monkeypatch):
    monkeypatch.setattr("app.routers.holidays._mv_populated", lambda db: False)
    r = client.get("/api/holidays?years=2024-2024")
    assert r.status_code == 200
    assert r.json()["holidays"] == []


def test_response_is_cacheable(client):
    r = client.get("/api/holidays?years=2024-2024")
    assert "max-age" in r.headers["cache-control"]
