"""Integration tests for /api/crashes/{collision_id}/parties|victims and
/api/parties|victims."""

import pytest

pytestmark = pytest.mark.integration


# ── Drill-down (B1) ───────────────────────────────────────────────────


def test_drill_down_parties_for_crash(client):
    # Crash 3 (collision_id=100, ccrs) has 2 parties seeded.
    response = client.get("/api/crashes/100/parties?data_source=ccrs")
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 2
    party_numbers = sorted(p["party_number"] for p in body)
    assert party_numbers == [1, 2]


def test_drill_down_parties_isolates_data_source(client):
    # collision_id=100 is shared between SWITRS (crash 1) and CCRS (crash 3).
    # SWITRS has no party data, so this returns empty.
    response = client.get("/api/crashes/100/parties?data_source=switrs")
    assert response.json() == []


def test_drill_down_parties_requires_data_source(client):
    response = client.get("/api/crashes/100/parties")
    assert response.status_code == 422  # FastAPI Query(..., required)


def test_drill_down_parties_rejects_bad_data_source(client):
    response = client.get("/api/crashes/100/parties?data_source=bogus")
    assert response.status_code == 422


def test_drill_down_victims_for_crash(client):
    # Crash 4 (collision_id=300, ccrs) has 3 victims seeded.
    response = client.get("/api/crashes/300/victims?data_source=ccrs")
    body = response.json()
    assert len(body) == 3


def test_drill_down_victims_empty_for_pdo_crash(client):
    # Crash 5 (collision_id=400, ccrs) is Property Damage Only — no victims.
    response = client.get("/api/crashes/400/victims?data_source=ccrs")
    assert response.json() == []


# ── Cross-crash list (B2) ─────────────────────────────────────────────


def test_parties_pagination(client):
    response = client.get("/api/parties?limit=2")
    assert response.status_code == 200
    body = response.json()
    assert body["limit"] == 2
    assert len(body["items"]) <= 2
    assert body["total"] is None  # always null per docstring


def test_parties_filter_by_gender(client):
    response = client.get("/api/parties?gender=f")
    body = response.json()
    assert all(p["gender"] == "F" for p in body["items"])


def test_parties_filter_by_age_range(client):
    response = client.get("/api/parties?age_min=20&age_max=30")
    body = response.json()
    for p in body["items"]:
        assert p["age"] is None or 20 <= p["age"] <= 30


def test_parties_filter_at_fault(client):
    response = client.get("/api/parties?at_fault=true")
    body = response.json()
    assert all(p["at_fault"] is True for p in body["items"])


def test_parties_county_filter_via_join(client):
    # Crash 3 + 4 are in LA, crash 5 is in SF. Their parties join correctly.
    response = client.get("/api/parties?county=los-angeles")
    body = response.json()
    # All parties returned must be from LA crashes (collision_id 100 or 300).
    cids = {p["collision_id"] for p in body["items"]}
    assert cids.issubset({100, 300})


def test_parties_collision_id_filter(client):
    response = client.get("/api/parties?collision_id=100&data_source=ccrs")
    body = response.json()
    assert len(body["items"]) == 2  # 2 parties seeded for this crash
    assert {p["data_source"] for p in body["items"]} == {"ccrs"}


def test_parties_rejects_bad_age_range(client):
    response = client.get("/api/parties?age_min=50&age_max=20")
    assert response.status_code == 422
    assert response.json()["filter"] == "age_min"


def test_parties_rejects_unknown_gender(client):
    response = client.get("/api/parties?gender=z")
    assert response.status_code == 422
    assert response.json()["filter"] == "gender"


def test_victims_pagination(client):
    response = client.get("/api/victims?limit=2")
    body = response.json()
    assert body["limit"] == 2
    assert body["total"] is None


def test_victims_filter_injury_severity(client):
    response = client.get("/api/victims?injury_severity=Fatal")
    body = response.json()
    assert all(v["injury_severity"] == "Fatal" for v in body["items"])


def test_victims_filter_person_type(client):
    response = client.get("/api/victims?person_type=Pedestrian")
    body = response.json()
    assert all(v["person_type"] == "Pedestrian" for v in body["items"])


def test_victims_county_filter_via_join(client):
    response = client.get("/api/victims?county=orange")
    body = response.json()
    # Only crash 4 (collision_id=300) is in Orange and has victims.
    cids = {v["collision_id"] for v in body["items"]}
    assert cids.issubset({300})
