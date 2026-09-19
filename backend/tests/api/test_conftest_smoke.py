"""Smoke test: fixtures create and seed the DB, TestClient works."""

import pytest

from .conftest import require_throwaway_db_name

# The two DB-backed tests below carry the marker individually rather than via a
# module-level pytestmark, so the database-name guard — which needs no database
# — still runs under `pytest -m "not integration"`.


@pytest.mark.parametrize(
    "name",
    ["calsight", "postgres", "calsight_prod", "calsight_test_x", "drop me_test", ""],
)
def test_non_throwaway_names_are_refused(name):
    """_create_test_db DROPs this database, so the name is a safety boundary."""
    with pytest.raises(ValueError):
        require_throwaway_db_name(name)


@pytest.mark.parametrize("name", ["calsight_test", "calsight_schools_test", "ci_test"])
def test_throwaway_names_pass(name):
    assert require_throwaway_db_name(name) == name


@pytest.mark.integration
def test_client_health(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.integration
def test_seed_counties_present(db_session):
    from app.models import County
    names = sorted(c.name for c in db_session.query(County).all())
    assert names == ["Alameda", "Los Angeles", "Orange", "Sacramento", "San Francisco"]
