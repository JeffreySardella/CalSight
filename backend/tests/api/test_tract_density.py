"""Integration tests for /api/tract-density."""

import pytest

from app.models import TractDensityCountyYear

pytestmark = pytest.mark.integration


def _seed(db_session):
    db_session.add_all([
        TractDensityCountyYear(county_code=19, year=2022, weighted_density=8500.0, tract_count=2300),
        TractDensityCountyYear(county_code=30, year=2022, weighted_density=4200.0, tract_count=580),
        TractDensityCountyYear(county_code=19, year=2021, weighted_density=8400.0, tract_count=2295),
    ])
    db_session.flush()


def test_tract_density_returns_rows(client, db_session):
    _seed(db_session)
    resp = client.get("/api/tract-density")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 3
    row = next(r for r in body if r["county_code"] == 19 and r["year"] == 2022)
    assert row["weighted_density"] == 8500.0
    assert row["tract_count"] == 2300


def test_tract_density_filters_by_year(client, db_session):
    _seed(db_session)
    body = client.get("/api/tract-density?year=2022").json()
    assert {r["year"] for r in body} == {2022}
    assert len(body) == 2


def test_tract_density_filters_by_county(client, db_session):
    _seed(db_session)
    body = client.get("/api/tract-density?county=orange").json()
    assert {r["county_code"] for r in body} == {30}
