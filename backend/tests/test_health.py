import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.database import engine
from app.main import app

client = TestClient(app)


def _db_available() -> bool:
    """True if the app's database is reachable.

    /api/health returns 503 ("db_unavailable") without a DB, so this test is
    only meaningful when a database is present. CI has one; DB-less runs
    (e.g. `pytest -m "not integration"` locally) skip gracefully instead of
    failing.
    """
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


def test_health():
    if not _db_available():
        pytest.skip("Database not reachable; /api/health returns 503 without a DB")
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
