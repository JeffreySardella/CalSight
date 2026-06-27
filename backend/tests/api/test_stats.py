"""Integration tests for /api/stats."""

import pytest

pytestmark = pytest.mark.integration


def test_stats_no_group_by_returns_grand_totals(client):
    response = client.get("/api/stats")
    assert response.status_code == 200
    body = response.json()
    assert "total_crashes" in body
    assert "total_killed" in body
    assert "total_injured" in body


def test_stats_group_by_county(client):
    response = client.get("/api/stats?group_by=county")
    body = response.json()
    assert isinstance(body, list)
    for row in body:
        assert "county_code" in row and "crash_count" in row


def test_stats_group_by_year(client):
    response = client.get("/api/stats?group_by=year")
    body = response.json()
    years = {row["year"] for row in body}
    assert 2023 in years


def test_stats_group_by_cause_uses_cause_view(client):
    response = client.get("/api/stats?group_by=cause")
    body = response.json()
    assert all("canonical_cause" in row for row in body)
    causes = {row["canonical_cause"] for row in body}
    assert "dui" in causes


def test_stats_group_by_hour_no_killed_injured(client):
    response = client.get("/api/stats?group_by=hour")
    body = response.json()
    for row in body:
        assert "hour" in row
        assert "crash_count" in row
        # MV does not carry these; endpoint must not fabricate them.
        assert "total_killed" not in row
        assert "total_injured" not in row


def test_stats_group_by_severity(client):
    response = client.get("/api/stats?group_by=severity")
    body = response.json()
    severities = {row["severity"] for row in body}
    assert severities.issubset({"Fatal", "Injury", "Property Damage Only"})


def test_stats_filter_year(client):
    response = client.get("/api/stats?group_by=year&year=2023")
    body = response.json()
    assert all(row["year"] == 2023 for row in body)


def test_stats_cause_filter_uses_cause_view(client):
    response = client.get("/api/stats?cause=dui&group_by=county")
    body = response.json()
    assert len(body) >= 1


def test_stats_accepts_alcohol_filter(client):
    response = client.get("/api/stats?alcohol=true")
    assert response.status_code == 200


def test_stats_accepts_distracted_filter(client):
    response = client.get("/api/stats?distracted=true")
    assert response.status_code == 200


def test_stats_rejects_involvement_with_demographics(client):
    response = client.get("/api/stats?group_by=gender&alcohol=true")
    assert response.status_code == 422
    assert response.json()["filter"] == "involvement"


def test_stats_involvement_false_excludes_unknown_and_matches_crashes(client):
    """HIGH-1: an involvement `=false` filter must not bucket rows whose
    underlying flag is NULL (unknown) as 'false'.

    /stats reads mv_crashes_wide; /crashes reads the raw table with
    `.is_(False)` semantics (NULL excluded). The two must agree.

    Seed alcohol flags: id3=True, id4=False, id5=False, id1/id2 (SWITRS)=NULL.
    So `alcohol=false` is exactly the 2 real-false crashes — not the 2 NULL
    SWITRS rows. Before the fix /stats returned 4 (2 false + 2 NULL).
    """
    years = "year=2014,2015,2022,2023"
    stats = client.get(f"/api/stats?alcohol=false&{years}").json()
    crashes = client.get(
        f"/api/crashes?alcohol=false&{years}&include_total=true&limit=1"
    ).json()

    assert stats["total_crashes"] == 2
    assert stats["total_crashes"] == crashes["total"]


# --- group_by=gender / age_bracket (mv_crash_victims_by_demographics) ---


def test_stats_group_by_gender_returns_victim_buckets(client):
    response = client.get("/api/stats?group_by=gender")
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, list)
    genders = {row["gender"] for row in body}
    # Seed has both M and F victims.
    assert "M" in genders
    assert "F" in genders
    for row in body:
        assert "victim_count" in row
        assert "fatal_victim_count" in row
        # Crash-count fields are NOT present on this MV — must not leak.
        assert "crash_count" not in row


def test_stats_group_by_age_bracket(client):
    response = client.get("/api/stats?group_by=age_bracket")
    body = response.json()
    brackets = {row["age_bracket"] for row in body}
    # Seed has victims aged 18, 20, 33, 42, 45 — covers 18_24 and 25_44 brackets.
    assert "18_24" in brackets or "25_44" in brackets


def test_stats_gender_with_county_filter(client):
    response = client.get("/api/stats?group_by=gender&county=los-angeles")
    body = response.json()
    # Only crash 3 victims (1 M driver, 1 F passenger) are in LA.
    assert len(body) >= 1


def test_stats_gender_rejects_cause_filter(client):
    response = client.get("/api/stats?group_by=gender&cause=dui")
    assert response.status_code == 422
    assert response.json()["filter"] == "cause"


def test_stats_age_bracket_rejects_cause_filter(client):
    response = client.get("/api/stats?group_by=age_bracket&cause=speeding")
    assert response.status_code == 422
    assert response.json()["filter"] == "cause"


def test_stats_gender_severity_filter_works(client):
    """Severity filter IS supported — mv_victims has a severity column."""
    response = client.get("/api/stats?group_by=gender&severity=fatal")
    assert response.status_code == 200
    body = response.json()
    # Crash 3 has severity=Fatal with 2 victims (M driver, F passenger).
    assert len(body) >= 1


# --- group_by=at_fault_gender / at_fault_age_bracket
#     (mv_at_fault_parties_by_demographics) ---


def test_stats_group_by_at_fault_gender_returns_party_buckets(client):
    response = client.get("/api/stats?group_by=at_fault_gender")
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, list)
    # Seed has 2 at-fault parties total, both male (parties 1001 + 1003).
    # The non-at-fault parties (1002, 1004) MUST NOT appear.
    male_row = next((r for r in body if r["gender"] == "M"), None)
    assert male_row is not None
    assert male_row["party_count"] == 2
    # No female at-fault parties in seed → row should not exist or be 0.
    female_row = next((r for r in body if r["gender"] == "F"), None)
    assert female_row is None or female_row["party_count"] == 0
    for row in body:
        # Party-count fields must not leak as victim_count.
        assert "victim_count" not in row
        assert "party_count" in row
        assert "fatal_party_count" in row


def test_stats_group_by_at_fault_age_bracket(client):
    response = client.get("/api/stats?group_by=at_fault_age_bracket")
    assert response.status_code == 200
    body = response.json()
    brackets = {row["age_bracket"] for row in body}
    # Seed: at-fault driver ages 42 (25_44) and 22 (18_24).
    assert "25_44" in brackets
    assert "18_24" in brackets


def test_stats_at_fault_gender_with_county_filter(client):
    response = client.get("/api/stats?group_by=at_fault_gender&county=los-angeles")
    assert response.status_code == 200
    body = response.json()
    # Only crash 3 (LA) has an at-fault party (1001, M, 42).
    male_row = next((r for r in body if r["gender"] == "M"), None)
    assert male_row is not None
    assert male_row["party_count"] == 1
    assert male_row["fatal_party_count"] == 1


def test_stats_at_fault_gender_rejects_cause_filter(client):
    response = client.get("/api/stats?group_by=at_fault_gender&cause=dui")
    assert response.status_code == 422
    assert response.json()["filter"] == "cause"


def test_stats_at_fault_age_bracket_rejects_cause_filter(client):
    response = client.get("/api/stats?group_by=at_fault_age_bracket&cause=speeding")
    assert response.status_code == 422
    assert response.json()["filter"] == "cause"


def test_stats_at_fault_gender_severity_filter_works(client):
    """Severity filter IS supported — mv_at_fault has a severity column."""
    response = client.get("/api/stats?group_by=at_fault_gender&severity=fatal")
    assert response.status_code == 200
    body = response.json()
    # Crash 3 (LA, Fatal severity) has 1 male at-fault party.
    male_row = next((r for r in body if r["gender"] == "M"), None)
    assert male_row is not None
    assert male_row["party_count"] == 1


def test_stats_rejects_unknown_group_by(client):
    """Sanity: pattern validator still rejects garbage values, even with the
    new at_fault_* options on the allowlist."""
    response = client.get("/api/stats?group_by=at_fault_height")
    assert response.status_code == 422


# --- group_by=month (mv_crashes_by_month) ---


def test_stats_group_by_month(client):
    response = client.get("/api/stats?group_by=month")
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, list)
    months = {row["month"] for row in body}
    # Seed has crashes in months 1, 3, 6, 7, 12
    assert 6 in months or 7 in months
    for row in body:
        assert "crash_count" in row
        assert "total_killed" in row
        assert "total_injured" in row


def test_stats_group_by_month_with_year_filter(client):
    response = client.get("/api/stats?group_by=month&year=2023")
    body = response.json()
    # 2023 has crashes in months 7 (Orange) and 12 (SF)
    months = {row["month"] for row in body}
    assert months.issubset({7, 12})


# --- group_by=rate (mv_crash_rates) ---


def test_stats_group_by_rate(client):
    response = client.get("/api/stats?group_by=rate")
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, list)
    for row in body:
        assert "county_code" in row
        assert "county_name" in row
        assert "year" in row
        assert "severity" in row
        assert "total_crashes" in row
        assert "per_100k_population" in row
        assert "per_10k_licensed_drivers" in row
        assert "per_100_road_miles" in row
        assert "per_100k_aadt" in row
        assert "per_10k_vehicles" in row


def test_stats_group_by_rate_with_county_filter(client):
    response = client.get("/api/stats?group_by=rate&county=los-angeles")
    body = response.json()
    assert all(row["county_code"] == 19 for row in body)


def test_stats_group_by_rate_la_2023_has_rates(client):
    """LA 2023 has all denominator data seeded — rates should be non-null."""
    response = client.get("/api/stats?group_by=rate&county=los-angeles&year=2023")
    assert response.status_code == 200


# --- cause filter accepts new categories ---


def test_stats_cause_filter_accepts_new_categories(client):
    """New cause slugs should be accepted without 422."""
    for slug in ["right-of-way", "turning", "following-too-close",
                 "signal-violation", "pedestrian-violation", "unsafe-backing"]:
        response = client.get(f"/api/stats?cause={slug}&group_by=county")
        assert response.status_code == 200, f"Cause '{slug}' rejected"
