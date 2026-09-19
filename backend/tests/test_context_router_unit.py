"""Unit tests for app/routers/context.py.

tests/api/test_context.py covers the happy paths against a real Postgres DB
and is marked `integration`. This file exercises the same endpoints' filter
branches (county set/unset, year set/unset, the data-quality scope matrix,
the insight-cards angle filter) with `get_db` overridden by an in-memory
fake query — no network, no real DB.
"""

from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

import app.county_slug_map as county_slug_map
from app.database import get_db
from app.main import app
from app.models import (
    CountyInsight,
    CountyInsightCard,
    DataQualityStat,
    LicensedDriver,
    UnemploymentRate,
    VehicleRegistration,
)


class _FakeQuery:
    def __init__(self, rows):
        self._rows = rows

    def filter(self, *a, **k):
        return self

    def order_by(self, *a, **k):
        return self

    def offset(self, *a, **k):
        return self

    def limit(self, *a, **k):
        return self

    def all(self):
        return self._rows


@pytest.fixture()
def client_with():
    def _make(rows):
        db = MagicMock()
        db.query.return_value = _FakeQuery(rows)
        app.dependency_overrides[get_db] = lambda: db
        return TestClient(app)

    yield _make
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def _slug_map():
    """Bypass the DB-backed slug cache with a fixed county map."""
    county_slug_map._cached_map = {"los-angeles": 19, "orange": 30}
    yield
    county_slug_map._cached_map = None


class TestUnemployment:
    def test_no_filters_returns_all_rows(self, client_with):
        row = UnemploymentRate(county_code=19, year=2023, month=1, unemployment_rate=4.7)
        client = client_with([row])
        resp = client.get("/api/unemployment")
        assert resp.status_code == 200
        assert resp.json()[0]["unemployment_rate"] == 4.7

    def test_county_filter(self, client_with):
        row = UnemploymentRate(county_code=19, year=2023, month=1, unemployment_rate=4.7)
        client = client_with([row])
        resp = client.get("/api/unemployment?county=los-angeles")
        assert resp.status_code == 200
        assert resp.json()[0]["county_code"] == 19

    def test_unknown_county_is_error(self, client_with):
        client = client_with([])
        resp = client.get("/api/unemployment?county=nowhere")
        assert resp.status_code == 422

    def test_year_filter(self, client_with):
        row = UnemploymentRate(county_code=19, year=2023, month=1, unemployment_rate=4.7)
        client = client_with([row])
        resp = client.get("/api/unemployment?year=2023")
        assert resp.status_code == 200

    def test_pagination_params(self, client_with):
        client = client_with([])
        resp = client.get("/api/unemployment?limit=10&offset=5")
        assert resp.status_code == 200
        assert resp.json() == []


class TestVehicles:
    def test_returns_rows(self, client_with):
        row = VehicleRegistration(county_code=19, year=2023, total_vehicles=1000, ev_vehicles=310000)
        client = client_with([row])
        resp = client.get("/api/vehicles?county=los-angeles&year=2023")
        assert resp.status_code == 200
        assert resp.json()[0]["ev_vehicles"] == 310000

    def test_no_filters(self, client_with):
        client = client_with([])
        resp = client.get("/api/vehicles")
        assert resp.status_code == 200
        assert resp.json() == []


class TestLicensedDrivers:
    def test_returns_rows(self, client_with):
        row = LicensedDriver(county_code=19, year=2023, driver_count=5_000_000)
        client = client_with([row])
        resp = client.get("/api/licensed-drivers?county=los-angeles&year=2023")
        assert resp.status_code == 200
        assert resp.json()[0]["driver_count"] == 5_000_000

    def test_no_filters(self, client_with):
        client = client_with([])
        resp = client.get("/api/licensed-drivers")
        assert resp.status_code == 200


class TestDataQuality:
    def test_county_and_year_scope(self, client_with):
        row = DataQualityStat(county_code=19, year=2023, total_crashes=100)
        client = client_with([row])
        resp = client.get("/api/data-quality?county=los-angeles&year=2023")
        assert resp.status_code == 200
        assert resp.json()[0]["total_crashes"] == 100

    def test_county_only_scope(self, client_with):
        row = DataQualityStat(county_code=19, year=None, total_crashes=100)
        client = client_with([row])
        resp = client.get("/api/data-quality?county=los-angeles")
        assert resp.status_code == 200

    def test_year_only_scope(self, client_with):
        row = DataQualityStat(county_code=None, year=2023, total_crashes=100)
        client = client_with([row])
        resp = client.get("/api/data-quality?year=2023")
        assert resp.status_code == 200

    def test_no_filter_scope(self, client_with):
        row = DataQualityStat(county_code=None, year=None, total_crashes=100)
        client = client_with([row])
        resp = client.get("/api/data-quality")
        assert resp.status_code == 200
        assert len(resp.json()) == 1


class TestInsights:
    def test_returns_rows(self, client_with):
        row = CountyInsight(county_code=19, year=2023, total_crashes=100)
        client = client_with([row])
        resp = client.get("/api/insights?county=los-angeles&year=2023")
        assert resp.status_code == 200
        assert resp.json()[0]["county_code"] == 19

    def test_no_filters_empty(self, client_with):
        client = client_with([])
        resp = client.get("/api/insights")
        assert resp.status_code == 200
        assert resp.json() == []


class TestInsightCards:
    def test_returns_rows_with_angle_filter(self, client_with):
        row = CountyInsightCard(
            county_code=19, county_name="Los Angeles", year=2023,
            angle="overview", narrative="Text",
        )
        client = client_with([row])
        resp = client.get("/api/insight-cards?county=los-angeles&year=2023&angle=overview")
        assert resp.status_code == 200
        assert resp.json()[0]["angle"] == "overview"

    def test_no_filters(self, client_with):
        client = client_with([])
        resp = client.get("/api/insight-cards")
        assert resp.status_code == 200
        assert resp.json() == []
