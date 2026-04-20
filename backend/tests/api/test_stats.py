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


def test_stats_rejects_alcohol_filter(client):
    response = client.get("/api/stats?alcohol=true")
    assert response.status_code == 422
    assert response.json()["filter"] == "alcohol"


def test_stats_rejects_distracted_filter(client):
    response = client.get("/api/stats?distracted=true")
    assert response.status_code == 422
    assert response.json()["filter"] == "distracted"


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
