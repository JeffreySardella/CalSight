"""A view that cannot be read costs one card in /api/stats/batch, not the board.

A materialized view created WITH NO DATA raises ObjectNotInPrerequisiteState on
any SELECT until its first refresh. The batch loop used to catch only
FilterError, so that exception escaped and turned the whole request into a 500 —
every chart on a board that merely contained one such group went blank.

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


UNPOPULATED = OperationalError(
    "SELECT ...", {},
    Exception('materialized view "mv_victims_by_mode" has not been populated'),
)
MISSING_TABLE = ProgrammingError("SELECT ...", {}, Exception("undefined table"))


@pytest.mark.parametrize("exc", [UNPOPULATED, MISSING_TABLE], ids=["unpopulated", "missing"])
def test_one_unreadable_group_degrades_alone(monkeypatch, stub_db, exc):
    monkeypatch.setattr(stats, "_run_group_query", _fail_one_group(exc))

    response = TestClient(app).post(
        "/api/stats/batch", json={"groups": ["mode", "year"]},
    )

    assert response.status_code == 200
    body = response.json()
    # The broken group reports in-band, exactly like an incompatible filter.
    assert body["mode"] == {
        "error": "mode data is not available right now.",
        "filter": "unavailable",
    }
    # …and the healthy group is untouched.
    assert body["year"] == [{"year": 2023, "crash_count": 7}]


def test_the_transaction_is_rolled_back_before_the_next_group(monkeypatch, stub_db):
    """Without the rollback, Postgres fails every later statement in the batch
    with InFailedSqlTransaction, so the degradation would cascade anyway."""
    monkeypatch.setattr(stats, "_run_group_query", _fail_one_group(UNPOPULATED))

    TestClient(app).post("/api/stats/batch", json={"groups": ["mode", "year"]})

    assert stub_db.rollbacks == 1
