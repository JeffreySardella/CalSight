"""Integration tests for /api/fars."""

import pytest

from app.models import FarsCountyYear

pytestmark = pytest.mark.integration


def _seed_fars(db_session):
    db_session.add_all([
        FarsCountyYear(county_code=19, year=2022, fatalities=100,
                       unrestrained_killed=30, restraint_known_killed=80),
        FarsCountyYear(county_code=30, year=2022, fatalities=20,
                       unrestrained_killed=5, restraint_known_killed=18),
        FarsCountyYear(county_code=19, year=2021, fatalities=90,
                       unrestrained_killed=25, restraint_known_killed=70),
    ])
    db_session.flush()


def test_fars_returns_rows(client, db_session):
    _seed_fars(db_session)
    resp = client.get("/api/fars")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 3
    row = next(r for r in body if r["county_code"] == 19 and r["year"] == 2022)
    assert row["fatalities"] == 100
    assert row["unrestrained_killed"] == 30
    assert row["restraint_known_killed"] == 80


def test_fars_filters_by_year(client, db_session):
    _seed_fars(db_session)
    body = client.get("/api/fars?year=2022").json()
    assert {r["year"] for r in body} == {2022}
    assert len(body) == 2


def test_fars_filters_by_county(client, db_session):
    _seed_fars(db_session)
    body = client.get("/api/fars?county=orange").json()
    assert {r["county_code"] for r in body} == {30}
