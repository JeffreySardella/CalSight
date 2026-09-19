"""DB-backed tests for /api/fog-days against seeded storm_events + crashes."""

from datetime import date, datetime, timedelta

import pytest

from app.models import Crash, StormEvent

pytestmark = pytest.mark.integration

COUNTY = 34  # Sacramento — in the shared seed AND in the zone map (CAZ017/018),
             # which /api/fog-days now uses to bound its crash queries.
FOG_DAYS = [date(2024, 1, 10), date(2024, 1, 11), date(2024, 1, 12)]
OTHER_DAYS = [date(2024, 1, d) for d in list(range(1, 10)) + list(range(13, 32))]


def _crash(idx: int, day: date, hour: int, weather: str | None = None) -> Crash:
    return Crash(
        id=950_000 + idx, collision_id=950_000 + idx, data_source="ccrs",
        county_code=COUNTY, crash_datetime=datetime.combine(day, datetime.min.time())
        + timedelta(hours=hour),
        crash_year=day.year, crash_month=day.month, canonical_weather=weather,
    )


def _seed(db_session):
    """3 fog days with 2 crashes each; 28 non-fog January days with 1 each.

    So the fog-day average is 2.0/day against a 1.0/day baseline = +100%.
    Four crashes also carry canonical_weather='fog' (an independent signal).
    """
    db_session.add(StormEvent(
        source_event_id=7_000_001, county_code=COUNTY, event_type="Dense Fog",
        begin_date=FOG_DAYS[0], end_date=FOG_DAYS[-1], zone_id=311,
        zone_name="Hanford - Corcoran - Lemoore", deaths_direct=0,
        injuries_direct=0, source="Trained Spotter",
    ))
    # A winter event must not count as a fog day.
    db_session.add(StormEvent(
        source_event_id=7_000_002, county_code=COUNTY, event_type="Heavy Snow",
        begin_date=date(2024, 1, 20), end_date=date(2024, 1, 21), zone_id=330,
        zone_name="Sequoia NP", deaths_direct=0, injuries_direct=0, source=None,
    ))
    idx = 0
    for day in FOG_DAYS:
        for hour in (8, 17):
            db_session.add(_crash(idx, day, hour, "fog" if idx < 4 else None))
            idx += 1
    for day in OTHER_DAYS:
        db_session.add(_crash(idx, day, 12))
        idx += 1
    db_session.flush()


def test_statewide_fog_day_lift(client, db_session):
    _seed(db_session)
    body = client.get("/api/fog-days").json()

    assert body["county"] is None
    assert body["fog_event_type"] == "Dense Fog"
    assert body["months"] == [1]
    assert body["storm_events_through"] == 2024

    year = next(y for y in body["years"] if y["year"] == 2024)
    assert year["fog_event_days"] == 3
    assert year["crashes_on_fog_days"] == 6
    assert year["fog_day_avg_crashes"] == 2.0
    assert year["baseline_days"] == 28
    assert year["crashes_off_fog_days"] == 28
    assert year["baseline_avg_crashes"] == 1.0
    assert year["lift_pct"] == 100.0
    assert year["fog_coded_crashes"] == 4

    # A whole-period total carries no year — it spans all of them.
    assert body["totals"]["year"] is None
    assert body["totals"]["crashes_on_fog_days"] == 6

    [county] = body["counties"]
    assert county["county_code"] == COUNTY
    assert county["county_slug"] == "sacramento"
    assert county["years"][0]["fog_event_days"] == 3


def test_county_and_year_filters(client, db_session):
    _seed(db_session)
    scoped = client.get("/api/fog-days?county=sacramento&year=2024").json()
    assert scoped["county"] == "sacramento"
    assert scoped["year"] == 2024
    assert scoped["years"][0]["crashes_on_fog_days"] == 6

    # A county with no storm_events rows: an empty answer, not an error.
    empty = client.get("/api/fog-days?county=orange").json()
    assert empty["counties"] == [] and empty["years"] == []
    assert empty["totals"] is None

    other_year = client.get("/api/fog-days?year=2019").json()
    assert other_year["years"] == []


def test_advisories_outside_the_fog_season_are_ignored(client, db_session):
    """One stray June advisory must not pull June into every baseline window."""
    _seed(db_session)
    db_session.add(StormEvent(
        source_event_id=7_000_003, county_code=COUNTY, event_type="Dense Fog",
        begin_date=date(2024, 6, 5), end_date=date(2024, 6, 5), zone_id=311,
        zone_name="Hanford - Corcoran - Lemoore", deaths_direct=0,
        injuries_direct=0, source=None,
    ))
    db_session.flush()
    body = client.get("/api/fog-days").json()
    assert body["months"] == [1]
    assert body["years"][0]["fog_event_days"] == 3
    assert body["years"][0]["baseline_days"] == 28


def test_counties_outside_the_zone_map_are_not_queried(client, db_session):
    """A storm_events row for an unmapped county yields nothing, not a crash."""
    db_session.add(StormEvent(
        source_event_id=7_000_004, county_code=30, event_type="Dense Fog",
        begin_date=date(2024, 1, 10), end_date=date(2024, 1, 10), zone_id=311,
        zone_name="Hanford - Corcoran - Lemoore", deaths_direct=0,
        injuries_direct=0, source=None,
    ))  # Orange County is in no mapped zone
    db_session.flush()
    body = client.get("/api/fog-days").json()
    assert body["counties"] == [] and body["totals"] is None


def test_rejects_multi_county_and_unknown_slug(client, db_session):
    _seed(db_session)
    assert client.get("/api/fog-days?county=fresno,kern").status_code == 422
    assert client.get("/api/fog-days?county=not-a-county").status_code == 422
