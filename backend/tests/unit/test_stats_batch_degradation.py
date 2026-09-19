"""An unpopulated view costs one card in /api/stats/batch; an outage does not.

A materialized view created WITH NO DATA raises object_not_in_prerequisite_state
(pgcode 55000) on any SELECT until its first refresh. The batch loop used to
catch only FilterError, so that exception escaped and turned the whole request
into a 500 — every chart on a board that merely contained one such group went
blank. But the loop must not swallow everything: a real outage or a botched
migration has to keep reaching main.py's handler, which logs it and answers 503,
rather than being dressed up as four empty charts behind a 200.

No database: get_db is overridden with a stub and the query function is stubbed
out, so this exercises the loop and nothing else.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError, ProgrammingError

from app.database import get_db
from app.main import app
from app.routers import stats


class _StubSession:
    """Only what the batch loop touches: rollback() after a failed statement."""

    def __init__(self):
        self.rollbacks = 0

    def rollback(self):
        self.rollbacks += 1


class _Orig(Exception):
    """Stand-in for the psycopg2 error SQLAlchemy wraps — pgcode is the part
    the loop discriminates on."""

    def __init__(self, pgcode, message):
        super().__init__(message)
        self.pgcode = pgcode


@pytest.fixture()
def stub_db():
    session = _StubSession()
    app.dependency_overrides[get_db] = lambda: session
    yield session
    app.dependency_overrides.clear()


def _fail_one_group(exc):
    """Stub _run_group_query: raise `exc` for "mode", serve "year" normally."""
    def run(group, *args, **kwargs):
        if group == "mode":
            raise exc
        return [{"year": 2023, "crash_count": 7}]
    return run


def _post(groups=("mode", "year")):
    return TestClient(app, raise_server_exceptions=False).post(
        "/api/stats/batch", json={"groups": list(groups)},
    )


NOT_POPULATED = OperationalError(
    "SELECT ...", {},
    _Orig("55000", 'materialized view "mv_victims_by_mode" has not been populated'),
)
CONNECTION_LOST = OperationalError(
    "SELECT ...", {}, _Orig("08006", "server closed the connection unexpectedly"),
)
UNDEFINED_TABLE = ProgrammingError(
    "SELECT ...", {}, _Orig("42P01", 'relation "mv_victims_by_mode" does not exist'),
)


def test_an_unpopulated_view_degrades_that_card_alone(monkeypatch, stub_db):
    monkeypatch.setattr(stats, "_run_group_query", _fail_one_group(NOT_POPULATED))

    response = _post()

    assert response.status_code == 200
    body = response.json()
    # The unreadable group reports in-band, exactly like an incompatible filter.
    assert body["mode"] == {
        "error": "mode data is not available right now.",
        "filter": "unavailable",
    }
    # …and the healthy group is untouched.
    assert body["year"] == [{"year": 2023, "crash_count": 7}]


def test_the_transaction_is_rolled_back_before_the_next_group(monkeypatch, stub_db):
    """Without the rollback, Postgres fails every later statement in the batch
    with InFailedSqlTransaction, so the degradation would cascade anyway."""
    monkeypatch.setattr(stats, "_run_group_query", _fail_one_group(NOT_POPULATED))

    _post()

    assert stub_db.rollbacks == 1


def test_a_missing_table_is_not_degraded_to_a_200(monkeypatch, stub_db):
    """A botched migration must surface, not hide behind an empty chart."""
    monkeypatch.setattr(stats, "_run_group_query", _fail_one_group(UNDEFINED_TABLE))

    response = _post()

    assert response.status_code >= 500
    assert "filter" not in response.text
    # Still rolled back on the way out, so the pooled connection is clean.
    assert stub_db.rollbacks == 1


def test_a_lost_connection_still_reaches_the_503_handler(monkeypatch, stub_db):
    """Any OperationalError other than 55000 is a real outage — main.py's
    handler answers 503 + Retry-After rather than the loop faking a 200."""
    monkeypatch.setattr(stats, "_run_group_query", _fail_one_group(CONNECTION_LOST))

    response = _post()

    assert response.status_code == 503
    assert response.headers.get("Retry-After") == "60"
