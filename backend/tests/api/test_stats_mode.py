"""Integration tests for /api/stats?group_by=mode (mv_victims_by_mode).

The shared seed only has car occupants and one pedestrian, so each test that
needs a full mode split adds its own parties/victims and re-refreshes the
matview. Both happen inside the per-test transaction, so the extra rows roll
back and no other test sees them.
"""

import pytest
from sqlalchemy import text

from app.models import CrashParty, CrashVictim

pytestmark = pytest.mark.integration


def _seed_all_modes(db_session):
    """Add one victim of each mode to CCRS crash 400 (San Francisco, 2023).

    Party 2 is a motorcycle, party 3 a moped — both must land in
    `motorcyclist`. Party 4 is a car whose passenger is an `occupant`.
    Pedestrians and cyclists are keyed off person_type, not the vehicle.
    """
    db_session.add_all([
        CrashParty(party_id=9001, collision_id=400, data_source="ccrs",
                   party_number=2, party_type="Driver", at_fault=False,
                   vehicle_type="Motorcycle"),
        CrashParty(party_id=9002, collision_id=400, data_source="ccrs",
                   party_number=3, party_type="Driver", at_fault=False,
                   vehicle_type="MotorDrivenCycleScooter15HpOrLess"),
        CrashParty(party_id=9003, collision_id=400, data_source="ccrs",
                   party_number=4, party_type="Driver", at_fault=False,
                   vehicle_type="PassengerCarStationWagonJeep"),
    ])
    db_session.add_all([
        # motorcyclist: killed
        CrashVictim(victim_id=9101, collision_id=400, data_source="ccrs",
                    party_number=2, person_type="Driver", injury_severity="Fatal"),
        # motorcyclist: seriously injured (moped rider)
        CrashVictim(victim_id=9102, collision_id=400, data_source="ccrs",
                    party_number=3, person_type="Driver",
                    injury_severity="SuspectSerious"),
        # occupant
        CrashVictim(victim_id=9103, collision_id=400, data_source="ccrs",
                    party_number=4, person_type="Passenger",
                    injury_severity="SuspectMinor"),
        # cyclist: seriously injured under the retired code
        CrashVictim(victim_id=9104, collision_id=400, data_source="ccrs",
                    party_number=2, person_type="Bicyclist",
                    injury_severity="SevereInactive"),
        # pedestrian: killed
        CrashVictim(victim_id=9105, collision_id=400, data_source="ccrs",
                    party_number=4, person_type="Pedestrian",
                    injury_severity="Fatal"),
        # Uninjured people carry no person_type — must not be counted at all.
        CrashVictim(victim_id=9106, collision_id=400, data_source="ccrs",
                    party_number=4, person_type=None, injury_severity=None),
        # 'Other' is not one of the four modes either.
        CrashVictim(victim_id=9107, collision_id=400, data_source="ccrs",
                    party_number=4, person_type="Other",
                    injury_severity="SuspectMinor"),
    ])
    db_session.flush()
    db_session.execute(text("REFRESH MATERIALIZED VIEW mv_victims_by_mode"))


def test_mode_rows_count_people_by_road_user(client, db_session):
    _seed_all_modes(db_session)
    body = client.get("/api/stats?group_by=mode&county=san-francisco").json()
    rows = {r["mode"]: r for r in body}

    assert set(rows) == {"pedestrian", "cyclist", "motorcyclist", "occupant"}
    # Motorcycle and moped riders both count as motorcyclists.
    assert rows["motorcyclist"] == {
        "mode": "motorcyclist", "victim_count": 2,
        "killed": 1, "severe_injured": 1,
    }
    assert rows["pedestrian"] == {
        "mode": "pedestrian", "victim_count": 1, "killed": 1, "severe_injured": 0,
    }
    # Both serious-injury codes count, the retired one included.
    assert rows["cyclist"] == {
        "mode": "cyclist", "victim_count": 1, "killed": 0, "severe_injured": 1,
    }
    # The uninjured victim and the 'Other' person are excluded, so San
    # Francisco's only occupant is the injured passenger.
    assert rows["occupant"]["victim_count"] == 1


def test_mode_rows_do_not_leak_crash_count_fields(client, db_session):
    _seed_all_modes(db_session)
    body = client.get("/api/stats?group_by=mode").json()
    assert body
    for row in body:
        assert set(row) == {"mode", "victim_count", "killed", "severe_injured"}


def test_mode_respects_year_filter(client, db_session):
    _seed_all_modes(db_session)
    # Crash 400 is a 2023 CCRS crash; 2014 is SWITRS-only and has no victims.
    assert client.get("/api/stats?group_by=mode&year=2023").json()
    assert client.get("/api/stats?group_by=mode&year=2014").json() == []


def test_mode_respects_county_filter(client, db_session):
    _seed_all_modes(db_session)
    sf = client.get("/api/stats?group_by=mode&county=san-francisco").json()
    la = client.get("/api/stats?group_by=mode&county=los-angeles").json()
    # The motorcyclists only exist in San Francisco.
    assert "motorcyclist" in {r["mode"] for r in sf}
    assert "motorcyclist" not in {r["mode"] for r in la}


@pytest.mark.parametrize("bad", ["cause=dui", "alcohol=true"])
def test_mode_rejects_filters_the_view_cannot_answer(client, bad):
    """mv_victims_by_mode carries no cause and no involvement flags. Each must
    422 rather than return unfiltered counts."""
    response = client.get(f"/api/stats?group_by=mode&{bad}")
    assert response.status_code == 422
    assert response.json()["filter"] in {"cause", "involvement"}


def test_mode_severity_filter_narrows_to_fatal_crashes(client, db_session):
    """"Pedestrian deaths by year" is asked with a severity filter on, so the
    view carries the crash's severity and the filter has to apply.

    Crash 400 is Property Damage Only, so a fatal cut must drop every person
    seeded there and leave only the Los Angeles fatal crash's two occupants.
    """
    _seed_all_modes(db_session)
    unfiltered = {r["mode"]: r for r in
                  client.get("/api/stats?group_by=mode").json()}
    assert set(unfiltered) == {"pedestrian", "cyclist", "motorcyclist", "occupant"}

    response = client.get("/api/stats?group_by=mode&severity=fatal")
    assert response.status_code == 200
    rows = {r["mode"]: r for r in response.json()}

    # Only crash 100 (Fatal, LA) survives: a killed driver and a seriously
    # injured passenger, both vehicle occupants.
    assert set(rows) == {"occupant"}
    assert rows["occupant"]["victim_count"] == 2
    assert rows["occupant"]["killed"] == 1
    # …and the filter really did narrow — it is not the unfiltered row.
    assert rows["occupant"]["victim_count"] < unfiltered["occupant"]["victim_count"]


def test_mode_available_in_batch(client, db_session):
    _seed_all_modes(db_session)
    body = client.post("/api/stats/batch", json={"groups": ["mode"]}).json()
    assert {r["mode"] for r in body["mode"]} == {
        "pedestrian", "cyclist", "motorcyclist", "occupant",
    }


def test_mode_batch_reports_incompatible_filter_per_group(client):
    body = client.post(
        "/api/stats/batch", json={"groups": ["mode", "year"], "cause": "dui"},
    ).json()
    assert body["mode"]["filter"] == "cause"
    assert isinstance(body["year"], list)
