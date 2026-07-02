"""Tests for the get_top_intersections AI tool.

Exercises the tool function directly against road-pair crashes inserted into
the shared transactional session.
"""

from __future__ import annotations

from datetime import datetime

import pytest

from app.ai_tools import TOOL_REGISTRY, get_top_intersections
from app.ai_prompt import TOOL_DEFINITIONS
from app.models import Crash

pytestmark = pytest.mark.integration


def _crash(cid, primary, secondary, *, severity="Injury", killed=0, injured=1, county=19):
    return Crash(
        id=cid, collision_id=cid, data_source="ccrs",
        crash_datetime=datetime(2022, 3, 10, 12, 0), county_code=county,
        crash_year=2022, crash_hour=12, crash_month=3, day_of_week_num=1,
        severity=severity, canonical_cause="speeding",
        number_killed=killed, number_injured=injured,
        county_name="Los Angeles", latitude=34.0, longitude=-118.0,
        primary_road=primary, secondary_road=secondary,
    )


@pytest.fixture
def seed(db_session):
    db_session.add_all([
        _crash(9101, "MAIN ST", "OAK AVE", severity="Fatal", killed=1, injured=0),
        _crash(9102, "main st", "oak ave"),
        _crash(9103, "MAIN ST", "OAK AVE"),
        _crash(9104, "1ST ST", "ELM AVE"),
        _crash(9105, "MAIN ST", None),  # corridor-only
    ])
    db_session.flush()


def test_tool_is_registered_and_defined():
    assert "get_top_intersections" in TOOL_REGISTRY
    names = {d["function"]["name"] for d in TOOL_DEFINITIONS}
    assert "get_top_intersections" in names
    # registry and prompt definitions stay in sync
    assert set(TOOL_REGISTRY) == names


def test_top_intersections_ranked(db_session, seed):
    rows = get_top_intersections(db_session, county="Los Angeles")
    assert rows[0]["primary_road"] == "MAIN ST"
    assert rows[0]["secondary_road"] == "OAK AVE"
    assert rows[0]["crash_count"] == 3          # normalization merged 3
    assert rows[0]["fatal_count"] == 1


def test_corridors_roll_up_primary(db_session, seed):
    rows = get_top_intersections(db_session, county="Los Angeles", corridors=True)
    main = next(r for r in rows if r["primary_road"] == "MAIN ST")
    assert main["crash_count"] == 4            # 3 intersection + 1 corridor-only
    assert main["secondary_road"] is None


def test_unknown_county_returns_error(db_session):
    rows = get_top_intersections(db_session, county="Narnia")
    assert rows == [{"error": "County not found: Narnia"}]
