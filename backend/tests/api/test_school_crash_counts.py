"""/api/schools/crash-counts — the 500 ft rollup behind the school markers.

Two things here are easy to get wrong and expensive to get wrong:

  - The view ships WITH NO DATA (migration 10f264138733), so between a deploy
    and the next nightly refresh every read of it raises "materialized view
    has not been populated". That has to come back as an empty list, not a
    500 on every map load.
  - The 500 ft cutoff is a circle, not the bounding box the index uses. A
    school sitting in a corner of the box is outside the circle and must not
    be counted, or the radius quietly becomes ~700 ft on the diagonal.
"""

from __future__ import annotations

from datetime import datetime

import pytest
from sqlalchemy import text

from app.models import Crash, SchoolLocation

# Crash 3 in the shared seed: LA county, 2022, ccrs, 1 killed / 1 injured.
_CRASH_3 = (34.05, -118.05)
# Crash 4: Orange county, 2023, ccrs, 0 killed / 3 injured.
_CRASH_4 = (33.70, -117.80)


def _by_cds(body):
    return {r["cds_code"]: r for r in body["schools"]}


# ── Unpopulated view ───────────────────────────────────────────────────
# The test database runs migrations but never refreshes this view, so this
# is the real post-deploy state, not a mock of it.


def test_unpopulated_view_returns_empty_schools_not_500(client):
    res = client.get("/api/schools/crash-counts")
    assert res.status_code == 200
    body = res.json()
    assert body["schools"] == []
    assert body["years"] == []


def test_coverage_is_served_even_with_no_counts(client):
    """The caveat is the point of the endpoint; it can't wait on the view."""
    body = client.get("/api/schools/crash-counts").json()
    la = [c for c in body["coverage"] if c["county_code"] == 19]
    assert la, "expected the seeded Los Angeles data-quality row"
    # Seed: 4,200,000 crashes, 4,000,000 with coordinates.
    assert la[0]["coords_pct"] == 95.2
    assert la[0]["county_name"] == "Los Angeles"


def test_coverage_follows_the_year_filter(client):
    """?years= reads the per-year rows, not the all-time rollup."""
    body = client.get("/api/schools/crash-counts?years=2023").json()
    assert body["years"] == [2023]
    la = [c for c in body["coverage"] if c["county_code"] == 19]
    # Seed: county 19 / 2023 is 500,000 crashes, 480,000 with coordinates.
    assert la[0]["coords_pct"] == 96.0


def test_unknown_year_has_no_coverage_rows(client):
    body = client.get("/api/schools/crash-counts?years=2021").json()
    assert body["coverage"] == []


def test_out_of_range_year_is_rejected(client):
    """Same FilterError handling as every other year-filtered endpoint."""
    assert client.get("/api/schools/crash-counts?years=1999").status_code == 422
    assert client.get("/api/schools/crash-counts?years=notayear").status_code == 422


def test_cache_header(client):
    res = client.get("/api/schools/crash-counts")
    assert res.headers["Cache-Control"] == "public, max-age=3600"


# ── Populated view ─────────────────────────────────────────────────────


@pytest.fixture()
def near_school(db_session):
    """Three schools around the seeded crashes, then populate the view.

    Both the inserts and the REFRESH run inside the per-test transaction, so
    the rollback puts the view back to WITH NO DATA for the tests above.
    """
    db_session.add_all([
        # Exactly on crash 3 (LA, 2022).
        SchoolLocation(cds_code="19000000000101", school_name="Near LA Crash",
                       county_code=19, city="Los Angeles", school_type="High",
                       status="Active", latitude=_CRASH_3[0], longitude=_CRASH_3[1]),
        # Exactly on crash 4 (Orange, 2023).
        SchoolLocation(cds_code="30000000000102", school_name="Near OC Crash",
                       county_code=30, city="Anaheim", school_type="Elementary",
                       status="Active", latitude=_CRASH_4[0], longitude=_CRASH_4[1]),
        # Diagonal corner of crash 3's bounding box: ~0.0986 mi away, which is
        # inside the box the index scans but outside the 0.0947 mi circle.
        SchoolLocation(cds_code="19000000000103", school_name="Box Corner Only",
                       county_code=19, city="Los Angeles", school_type="Middle",
                       status="Active", latitude=_CRASH_3[0] + 0.00110,
                       longitude=_CRASH_3[1] + 0.00110),
        # Due north of crash 3 at 0.001372 deg = 0.09467 mi, just inside the
        # 0.0947 mi cutoff. The bounding box must therefore be wider than
        # 0.001372 deg; an earlier revision hard-coded 0.00136 and silently
        # clipped the north and south caps of every school's circle.
        SchoolLocation(cds_code="19000000000104", school_name="North Cap",
                       county_code=19, city="Los Angeles", school_type="Middle",
                       status="Active", latitude=_CRASH_3[0] + 0.001372,
                       longitude=_CRASH_3[1]),
        # Nowhere near California. cos(radians(90)) is 0 and it is a divisor in
        # the box expression, so without the latitude bound this row alone
        # would abort the REFRESH and fail the whole matviews ETL run.
        SchoolLocation(cds_code="19000000000105", school_name="North Pole High",
                       county_code=19, city="Nowhere", school_type="High",
                       status="Active", latitude=90.0, longitude=0.0),
    ])
    # Crash 3 gets 1 seriously injured, crash 4 gets 2 — KSI lives on the
    # crashes row (migration 50bbb1251cb7), not on crash_victims.
    db_session.execute(text("UPDATE crashes SET number_severe_injured = 1 WHERE id = 3"))
    db_session.execute(text("UPDATE crashes SET number_severe_injured = 2 WHERE id = 4"))
    db_session.flush()
    db_session.execute(text("REFRESH MATERIALIZED VIEW mv_school_crash_counts"))


@pytest.mark.integration
def test_counts_the_crash_at_the_school(client, near_school):
    rows = _by_cds(client.get("/api/schools/crash-counts").json())
    la = rows["19-00000-0000101"]
    assert la == {
        "cds_code": "19-00000-0000101",
        "crashes": 1,
        "killed": 1,
        "injured": 1,
        "severe_injured": 1,
    }


@pytest.mark.integration
def test_bounding_box_corner_is_outside_the_circle(client, near_school):
    """500 ft means 500 ft in every direction, not 500 ft per axis."""
    assert "19-00000-0000103" not in _by_cds(client.get("/api/schools/crash-counts").json())


@pytest.mark.integration
def test_bounding_box_encloses_the_circle(client, near_school):
    """A prefilter box has to be a superset of the circle, never a subset."""
    rows = _by_cds(client.get("/api/schools/crash-counts").json())
    assert rows["19-00000-0000104"]["crashes"] == 1


@pytest.mark.integration
def test_a_school_at_the_pole_does_not_abort_the_refresh(client, near_school):
    """The fixture's REFRESH already ran; reaching here means no divide-by-zero."""
    assert "19-00000-0000105" not in _by_cds(client.get("/api/schools/crash-counts").json())


@pytest.mark.integration
def test_schools_with_no_nearby_crash_are_absent(client, near_school):
    """The seeded Venice High is miles from every seeded crash."""
    assert "19-00000-0000001" not in _by_cds(client.get("/api/schools/crash-counts").json())


@pytest.mark.integration
def test_year_filter_selects_the_matching_school(client, near_school):
    # Both LA schools sit inside crash 3's 500 ft circle (2022); the Orange
    # school sits on crash 4 (2023).
    only_2022 = _by_cds(client.get("/api/schools/crash-counts?years=2022").json())
    assert set(only_2022) == {"19-00000-0000101", "19-00000-0000104"}

    only_2023 = _by_cds(client.get("/api/schools/crash-counts?years=2023").json())
    assert set(only_2023) == {"30-00000-0000102"}
    assert only_2023["30-00000-0000102"]["injured"] == 3
    assert only_2023["30-00000-0000102"]["severe_injured"] == 2


@pytest.mark.integration
def test_multiple_years_sum_rather_than_replace(client, near_school):
    """A multi-year filter unions the schools rather than taking the last year."""
    both = _by_cds(client.get("/api/schools/crash-counts?years=2022,2023").json())
    assert set(both) == {"19-00000-0000101", "19-00000-0000104", "30-00000-0000102"}


@pytest.mark.integration
def test_one_school_sums_across_years(client, db_session, near_school):
    """Add a second year at the LA school and confirm the totals add."""
    db_session.add(Crash(
        id=901, collision_id=901, data_source="ccrs",
        crash_datetime=datetime(2023, 5, 2, 8, 0), crash_year=2023,
        county_code=19, county_name="Los Angeles", severity="Injury",
        number_killed=0, number_injured=4, number_severe_injured=3,
        latitude=_CRASH_3[0], longitude=_CRASH_3[1],
    ))
    db_session.flush()
    db_session.execute(text("REFRESH MATERIALIZED VIEW mv_school_crash_counts"))

    la = _by_cds(client.get("/api/schools/crash-counts").json())["19-00000-0000101"]
    assert la["crashes"] == 2
    assert la["killed"] == 1
    assert la["injured"] == 5
    assert la["severe_injured"] == 4

    # And the year filter still slices it back apart.
    just_2022 = _by_cds(client.get("/api/schools/crash-counts?years=2022").json())
    assert just_2022["19-00000-0000101"]["crashes"] == 1
