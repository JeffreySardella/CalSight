"""Unit tests for app/routers/crash_people.py.

The router's own integration tests (tests/api/test_crash_people.py) need a
real Postgres DB and are marked `integration`, which leaves the module's
validation helpers and query-building branches uncovered under the plain
unit run. This file covers those directly:

  - `_parse_age_range` / `_parse_gender`: pure validation, wrong-input paths.
  - The four endpoints, via TestClient with `get_db` overridden by an
    in-memory fake query object (no network, no real DB) so every filter
    branch and the "at least one filter required" 4xx can be exercised.
"""

from unittest.mock import MagicMock

import pytest

from app.filters import FilterError
from app.main import app
from app.database import get_db
from app.models import CrashParty, CrashVictim
from app.routers.crash_people import _parse_age_range, _parse_gender
from fastapi.testclient import TestClient


# ── pure helpers ─────────────────────────────────────────────────────────


class TestParseAgeRange:
    def test_none_passthrough(self):
        assert _parse_age_range(None, None) == (None, None)

    def test_valid_range(self):
        assert _parse_age_range(16, 25) == (16, 25)

    def test_negative_age_min_rejected(self):
        with pytest.raises(FilterError):
            _parse_age_range(-1, None)

    def test_negative_age_max_rejected(self):
        with pytest.raises(FilterError):
            _parse_age_range(None, -5)

    def test_min_greater_than_max_rejected(self):
        with pytest.raises(FilterError):
            _parse_age_range(40, 20)

    def test_min_equal_max_allowed(self):
        assert _parse_age_range(30, 30) == (30, 30)


class TestParseGender:
    def test_none_and_empty(self):
        assert _parse_gender(None) is None
        assert _parse_gender("") is None

    def test_single_value_uppercased(self):
        assert _parse_gender("m") == {"M"}

    def test_multiple_values_case_insensitive(self):
        assert _parse_gender("m,F,u") == {"M", "F", "U"}

    def test_whitespace_and_empty_segments_ignored(self):
        assert _parse_gender(" m , , f ") == {"M", "F"}

    def test_unknown_token_rejected(self):
        with pytest.raises(FilterError):
            _parse_gender("x")


# ── endpoint-level (fake DB, no network) ────────────────────────────────


class _FakeQuery:
    """Minimal stand-in for a SQLAlchemy Query: every chained call is a
    no-op that returns self, so tests only need to control the final rows."""

    def __init__(self, rows):
        self._rows = rows

    def filter(self, *a, **k):
        return self

    def join(self, *a, **k):
        return self

    def order_by(self, *a, **k):
        return self

    def offset(self, *a, **k):
        return self

    def limit(self, *a, **k):
        return self

    def all(self):
        return self._rows


def _fake_db(rows):
    db = MagicMock()
    db.query.return_value = _FakeQuery(rows)
    return db


@pytest.fixture()
def client_with(request):
    """Yields a factory: call it with a fake db to get a TestClient wired
    to that db via dependency override."""

    def _make(rows):
        db = _fake_db(rows)
        app.dependency_overrides[get_db] = lambda: db
        return TestClient(app), db

    yield _make
    app.dependency_overrides.pop(get_db, None)


def _party(**overrides):
    defaults = dict(
        id=1, party_id=1, collision_id=100, party_number=1, party_type="Driver",
        at_fault=True, gender="M", age=30, sobriety="NOT DRUNK",
        vehicle_type="Passenger Car", vehicle_year=2019, vehicle_make="Toyota",
        speed_limit=35, movement="Proceeding Straight", safety_equipment="Seatbelt",
        cell_phone_use="Not in Use", data_source="ccrs",
    )
    defaults.update(overrides)
    return CrashParty(**defaults)


def _victim(**overrides):
    defaults = dict(
        id=1, victim_id=1, collision_id=100, party_number=1, age=8,
        gender="F", injury_severity="Severe", person_type="Passenger",
        seat_position="Rear", safety_equipment="Child Seat", ejected="NotEjected",
        data_source="ccrs",
    )
    defaults.update(overrides)
    return CrashVictim(**defaults)


class TestDrillDownParties:
    def test_returns_parties_for_crash(self, client_with):
        client, _ = client_with([_party()])
        resp = client.get("/api/crashes/100/parties?data_source=ccrs")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 1
        assert body[0]["age_bracket"] == "25-34"  # age=30 -> bracket, PII suppressed
        assert "age" not in body[0]

    def test_bad_data_source_is_422(self, client_with):
        client, _ = client_with([])
        resp = client.get("/api/crashes/100/parties?data_source=bogus")
        assert resp.status_code == 422


class TestDrillDownVictims:
    def test_returns_victims_for_crash(self, client_with):
        client, _ = client_with([_victim()])
        resp = client.get("/api/crashes/100/victims?data_source=ccrs")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 1
        assert body[0]["age_bracket"] == "Under 16"


class TestListParties:
    def test_requires_at_least_one_filter(self, client_with):
        client, _ = client_with([])
        resp = client.get("/api/parties")
        assert resp.status_code == 422

    def test_collision_id_alone_satisfies_min_filter(self, client_with):
        client, _ = client_with([_party()])
        resp = client.get("/api/parties?collision_id=100")
        assert resp.status_code == 200
        body = resp.json()
        assert body["items"][0]["collision_id"] == 100
        assert body["total"] is None

    def test_year_filter_returns_empty_results(self, client_with):
        client, _ = client_with([])
        resp = client.get("/api/parties?year=2023")
        assert resp.status_code == 200
        assert resp.json()["items"] == []

    def test_invalid_gender_is_400(self, client_with):
        client, _ = client_with([])
        resp = client.get("/api/parties?collision_id=100&gender=x")
        assert resp.status_code == 422

    def test_age_min_greater_than_max_is_400(self, client_with):
        client, _ = client_with([])
        resp = client.get("/api/parties?collision_id=100&age_min=40&age_max=10")
        assert resp.status_code == 422

    def test_at_fault_and_party_type_filters(self, client_with):
        client, _ = client_with([_party()])
        resp = client.get(
            "/api/parties?collision_id=100&at_fault=true&party_type=Driver&gender=m"
        )
        assert resp.status_code == 200


class TestListVictims:
    def test_requires_at_least_one_filter(self, client_with):
        client, _ = client_with([])
        resp = client.get("/api/victims")
        assert resp.status_code == 422

    def test_collision_id_alone_satisfies_min_filter(self, client_with):
        client, _ = client_with([_victim()])
        resp = client.get("/api/victims?collision_id=100")
        assert resp.status_code == 200
        body = resp.json()
        assert body["items"][0]["collision_id"] == 100

    def test_person_type_and_injury_severity_filters(self, client_with):
        client, _ = client_with([_victim()])
        resp = client.get(
            "/api/victims?collision_id=100&person_type=Passenger&injury_severity=Severe"
        )
        assert resp.status_code == 200

    def test_invalid_age_is_400(self, client_with):
        client, _ = client_with([])
        resp = client.get("/api/victims?collision_id=100&age_min=-1")
        assert resp.status_code == 422
