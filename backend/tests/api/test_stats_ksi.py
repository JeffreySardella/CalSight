"""total_severe_injured through /api/stats: mv_year, mv_cause, mv_wide, batch."""

import pytest
from sqlalchemy import text

pytestmark = pytest.mark.integration


@pytest.fixture()
def severe(db_session):
    """Seed crash 4 (2023 Orange, ccrs, Injury, lane_change, distracted) with 2
    and crash 2 (2014 LA, switrs, Injury, speeding) with 1. The REFRESH runs
    inside the test transaction, so the rollback restores the views."""
    db_session.execute(text("UPDATE crashes SET number_severe_injured = 2 WHERE id = 4"))
    db_session.execute(text("UPDATE crashes SET number_severe_injured = 1 WHERE id = 2"))
    for mv in ("mv_crashes_by_year", "mv_crashes_by_cause", "mv_crashes_wide"):
        db_session.execute(text(f"REFRESH MATERIALIZED VIEW {mv}"))


def _by(rows, key):
    return {r[key]: r["total_severe_injured"] for r in rows}


def test_grand_total(client, severe):
    assert client.get("/api/stats").json()["total_severe_injured"] == 3


def test_year_mv_path(client, severe):
    by_year = _by(client.get("/api/stats?group_by=year").json(), "year")
    assert by_year[2014] == 1
    assert by_year[2023] == 2
    assert by_year[2022] == 0


def test_county_and_severity_mv_path(client, severe):
    assert _by(client.get("/api/stats?group_by=county").json(), "county_code")[30] == 2
    assert _by(client.get("/api/stats?group_by=severity").json(), "severity")["Injury"] == 3


def test_cause_filter_uses_cause_view(client, severe):
    rows = client.get("/api/stats?group_by=year&cause=lane-change").json()
    assert _by(rows, "year") == {2023: 2}
    causes = _by(client.get("/api/stats?group_by=cause").json(), "canonical_cause")
    assert causes["lane_change"] == 2
    assert causes["speeding"] == 1


def test_involvement_filter_uses_wide_view(client, severe):
    rows = client.get("/api/stats?group_by=year&distracted=true").json()
    assert _by(rows, "year")[2023] == 2
    total = client.get("/api/stats?distracted=true").json()
    assert total["total_severe_injured"] == 2


def test_batch_carries_the_field(client, severe):
    body = client.post("/api/stats/batch", json={"groups": ["year", "county"]}).json()
    assert _by(body["year"], "year")[2023] == 2
    assert _by(body["county"], "county_code")[19] == 1
