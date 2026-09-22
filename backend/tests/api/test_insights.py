"""Integration tests for the insights endpoints.

Covers all three routes in ``app/routers/insights.py``::

    GET /api/insights/statewide
    GET /api/insight-cards/random
    GET /api/insights/{county_slug}

The shared ``conftest._seed`` seeds counties but no insight rows, so every
test here depends on the ``seed_insights`` fixture below, which adds rows to
the per-test transactional session (rolled back at teardown).
"""

from datetime import date, datetime

import pytest
from sqlalchemy import text

from app.models import CountyInsight, CountyInsightCard, Crash, StatewideInsight

pytestmark = pytest.mark.integration


@pytest.fixture()
def seed_insights(db_session):
    """Add statewide + county insight rows to the per-test session.

    Los Angeles (county_code=19) gets data for 2022 and 2023; the 2022
    ``CountyInsight`` deliberately has ``narrative=None`` to exercise the
    "structured stats exist but the LLM step was skipped" branch. San
    Francisco (38) is left with no insight rows so the 404 paths can be
    tested against a real, seeded county.
    """
    db_session.add_all([
        StatewideInsight(
            year=2023, angle="overview",
            narrative="California recorded fewer fatal crashes in 2023.",
            total_crashes=4_200_000, total_killed=3800,
            total_injured=250_000, data_source="ccrs",
        ),
        StatewideInsight(
            year=2022, angle="trend",
            narrative="Statewide crash totals rose through 2022.",
            total_crashes=4_050_000, total_killed=3950,
            total_injured=248_000, data_source="ccrs",
        ),
    ])
    # Cards carry the county-year totals they were written from; the shared
    # seed gives LA 2022 one crash / one death and LA 2015 the same, so these
    # two match mv_crashes_by_year and are servable.
    db_session.add_all([
        CountyInsightCard(
            county_code=19, county_name="Los Angeles", year=2022,
            angle="overview",
            narrative="Los Angeles County saw a slight drop in crashes.",
            total_crashes=1, total_killed=1,
        ),
        CountyInsightCard(
            county_code=19, county_name="Los Angeles", year=2015,
            angle="dui",
            narrative="DUI crashes remained a top concern in 2015.",
            total_crashes=1, total_killed=1,
        ),
    ])
    db_session.add_all([
        CountyInsight(
            county_code=19, year=2023, total_crashes=500_000,
            total_killed=300, total_injured=42_000,
            crash_rate_per_capita=0.051, top_cause="speeding",
            top_cause_pct=28.4, yoy_change_pct=-3.2, peak_hour=17,
            dui_pct=6.1, narrative="LA's 2023 crash narrative.",
        ),
        # 2022: structured stats present, narrative deliberately null.
        CountyInsight(
            county_code=19, year=2022, total_crashes=515_000,
            total_killed=310, total_injured=43_500,
            crash_rate_per_capita=0.053, top_cause="speeding",
            top_cause_pct=27.9, yoy_change_pct=1.4, peak_hour=18,
            dui_pct=6.4, narrative=None,
        ),
    ])
    db_session.flush()
    return db_session


# --- GET /api/insights/statewide ---

def test_statewide_insight_returns_row(client, seed_insights):
    response = client.get("/api/insights/statewide")
    assert response.status_code == 200
    body = response.json()
    assert body["year"] in (2022, 2023)
    assert body["angle"] in ("overview", "trend")
    assert body["narrative"]
    assert body["total_crashes"] > 0


def test_statewide_insight_year_filter(client, seed_insights):
    response = client.get("/api/insights/statewide?year=2022")
    assert response.status_code == 200
    body = response.json()
    assert body["year"] == 2022
    assert body["angle"] == "trend"


def test_statewide_insight_404_for_year_with_no_data(client, seed_insights):
    response = client.get("/api/insights/statewide?year=1999")
    assert response.status_code == 404
    assert "statewide" in response.json()["detail"].lower()


def test_statewide_insight_sets_cache_header(client, seed_insights):
    response = client.get("/api/insights/statewide")
    assert response.headers["Cache-Control"] == (
        "public, max-age=3600, stale-while-revalidate=86400"
    )


# --- GET /api/insight-cards/random ---

def test_insight_card_returns_row(client, seed_insights):
    response = client.get("/api/insight-cards/random?county=los-angeles")
    assert response.status_code == 200
    body = response.json()
    assert body["county_code"] == 19
    assert body["county_name"] == "Los Angeles"
    assert body["narrative"]
    assert body["angle"] in ("overview", "dui")


def test_insight_card_year_filter(client, seed_insights):
    response = client.get("/api/insight-cards/random?county=los-angeles&year=2015")
    assert response.status_code == 200
    body = response.json()
    assert body["year"] == 2015
    assert body["angle"] == "dui"


def _card(county_code, name, year, angle, tc, tk):
    return CountyInsightCard(
        county_code=county_code, county_name=name, year=year, angle=angle,
        narrative=f"{name} card for {year}.", total_crashes=tc, total_killed=tk,
    )


def test_insight_card_with_stale_deaths_is_not_served(client, seed_insights, db_session):
    """The live Fresno 2025 card said 126 deaths / 10,493 crashes, written
    while 2025 was still filling in; the report card says 142 / 10,546.
    Orange 2023 is seeded with 1 crash and 0 deaths — a card built when it
    had 1 death must not be served."""
    db_session.add(_card(30, "Orange", 2023, "cause_focus", 1, 1))
    db_session.flush()
    assert client.get("/api/insight-cards/random?county=orange").status_code == 404


def test_insight_card_with_stale_crash_count_is_not_served(client, seed_insights, db_session):
    db_session.add(_card(30, "Orange", 2023, "cause_focus", 2, 0))
    db_session.flush()
    assert client.get("/api/insight-cards/random?county=orange").status_code == 404


def test_insight_card_without_a_snapshot_is_not_served(client, seed_insights, db_session):
    """Cards written before totals were stored can't be verified."""
    db_session.add(_card(30, "Orange", 2023, "cause_focus", None, None))
    db_session.flush()
    assert client.get("/api/insight-cards/random?county=orange").status_code == 404


def test_insight_card_matching_live_totals_is_served_with_its_year(client, seed_insights, db_session):
    db_session.add(_card(30, "Orange", 2023, "cause_focus", 1, 0))
    db_session.flush()
    response = client.get("/api/insight-cards/random?county=orange")
    assert response.status_code == 200
    assert response.json()["year"] == 2023


def test_stale_card_never_chosen_beside_a_current_one(client, seed_insights, db_session):
    db_session.add(_card(19, "Los Angeles", 2022, "cause_focus", 1, 0))
    db_session.flush()
    for _ in range(15):
        body = client.get("/api/insight-cards/random?county=los-angeles&year=2022").json()
        assert body["angle"] == "overview"


def test_current_year_card_is_not_served_even_if_totals_match(client, seed_insights, db_session):
    """A partial year's totals change daily; a match today is luck."""
    year = date.today().year
    db_session.add(Crash(
        id=900, collision_id=900, data_source="ccrs",
        crash_datetime=datetime(year, 1, 2, 8, 0), county_code=30,
        crash_year=year, crash_hour=8, crash_month=1, day_of_week_num=0,
        severity="Injury", number_killed=0, number_injured=1, county_name="Orange",
    ))
    db_session.flush()
    db_session.execute(text("REFRESH MATERIALIZED VIEW mv_crashes_by_year"))
    db_session.add(_card(30, "Orange", year, "overview", 1, 0))
    db_session.flush()
    assert client.get(f"/api/insight-cards/random?county=orange&year={year}").status_code == 404


def test_fun_facts_skip_stale_county_facts(client, seed_insights, db_session):
    db_session.add(_card(30, "Orange", 2023, "fun_fact_timing", 1, 1))
    db_session.flush()
    assert client.get("/api/fun-facts?county=orange").status_code == 404


def test_fun_facts_serve_current_county_facts(client, seed_insights, db_session):
    db_session.add(_card(30, "Orange", 2023, "fun_fact_timing", 1, 0))
    db_session.flush()
    body = client.get("/api/fun-facts?county=orange&n=1").json()
    assert body[0]["county_name"] == "Orange"
    assert body[0]["year"] == 2023


def test_insight_card_unknown_county_404(client, seed_insights):
    response = client.get("/api/insight-cards/random?county=not-a-county")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_insight_card_county_without_cards_404(client, seed_insights):
    # San Francisco is a seeded county but has no insight cards.
    response = client.get("/api/insight-cards/random?county=san-francisco")
    assert response.status_code == 404
    assert "no insight cards" in response.json()["detail"].lower()


def test_insight_card_missing_county_param_422(client, seed_insights):
    response = client.get("/api/insight-cards/random")
    assert response.status_code == 422


# --- GET /api/insights/{county_slug} ---

def test_insight_returns_full_payload(client, seed_insights):
    response = client.get("/api/insights/los-angeles")
    assert response.status_code == 200
    body = response.json()
    assert body["county_name"] == "Los Angeles"
    assert body["year"] == 2023  # latest seeded year
    assert body["total_crashes"] == 500_000
    assert body["total_killed"] == 300
    assert body["top_cause"] == "speeding"
    assert body["peak_hour"] == 17
    assert body["narrative"] == "LA's 2023 crash narrative."


def test_insight_defaults_to_latest_year(client, seed_insights):
    response = client.get("/api/insights/los-angeles")
    assert response.json()["year"] == 2023


def test_insight_default_skips_partial_current_year(client, seed_insights, db_session):
    """Regression: the default must return the latest COMPLETE year, never a
    partial current-year row.

    A leftover current-year card reports a few months of crashes against a
    full prior year, producing a fabricated ~-50% YoY decline — which the
    public site was serving on every first-visit county click. The default
    must skip it and return 2023.
    """
    current_year = date.today().year
    db_session.add(
        CountyInsight(
            county_code=19, year=current_year, total_crashes=45_260,
            total_killed=120, total_injured=8_000,
            crash_rate_per_capita=0.004, top_cause="speeding",
            top_cause_pct=27.0, yoy_change_pct=-56.4, peak_hour=17,
            dui_pct=6.0, narrative="A partial, misleading current-year card.",
        )
    )
    db_session.flush()

    body = client.get("/api/insights/los-angeles").json()
    assert body["year"] == 2023, "default served the partial current-year row"
    assert body["yoy_change_pct"] == -3.2  # the real, complete-year figure


def test_insight_explicit_current_year_is_still_served(client, seed_insights, db_session):
    """Excluding the current year is only the DEFAULT — an explicit
    ?year=<current> request must still return that row."""
    current_year = date.today().year
    db_session.add(
        CountyInsight(
            county_code=19, year=current_year, total_crashes=45_260,
            total_killed=120, total_injured=8_000,
            crash_rate_per_capita=0.004, top_cause="speeding",
            top_cause_pct=27.0, yoy_change_pct=-56.4, peak_hour=17,
            dui_pct=6.0, narrative="Partial current-year card.",
        )
    )
    db_session.flush()

    body = client.get(f"/api/insights/los-angeles?year={current_year}").json()
    assert body["year"] == current_year
    assert body["total_crashes"] == 45_260


def test_insight_falls_back_when_only_current_year_exists(client, seed_insights, db_session):
    """If a county has ONLY a current-year card, serve it rather than 404 —
    the exclusion is a preference for complete years, not a hard filter.

    Orange County (30) is seeded with no insight rows, so it gets only the
    current-year card added here.
    """
    current_year = date.today().year
    db_session.add(
        CountyInsight(
            county_code=30, year=current_year, total_crashes=9_000,
            total_killed=20, total_injured=1_500,
            crash_rate_per_capita=0.003, top_cause="speeding",
            top_cause_pct=25.0, yoy_change_pct=None, peak_hour=16,
            dui_pct=5.0, narrative="Only a current-year card exists.",
        )
    )
    db_session.flush()

    response = client.get("/api/insights/orange")
    assert response.status_code == 200
    assert response.json()["year"] == current_year


def test_insight_year_filter_returns_null_narrative(client, seed_insights):
    # 2022 has structured stats but no LLM narrative — the endpoint returns
    # narrative: null (not 404) so the frontend can hide the blurb section.
    response = client.get("/api/insights/los-angeles?year=2022")
    assert response.status_code == 200
    body = response.json()
    assert body["year"] == 2022
    assert body["narrative"] is None
    assert body["total_crashes"] == 515_000


def test_insight_unknown_slug_404(client, seed_insights):
    response = client.get("/api/insights/atlantis")
    assert response.status_code == 404
    assert "atlantis" in response.json()["detail"]


def test_insight_county_without_data_404(client, seed_insights):
    # San Francisco is a real county but has no county_insights rows.
    response = client.get("/api/insights/san-francisco")
    assert response.status_code == 404
    assert "no insight data" in response.json()["detail"].lower()


def test_insight_sets_cache_header(client, seed_insights):
    response = client.get("/api/insights/los-angeles")
    assert response.headers["Cache-Control"] == (
        "public, max-age=3600, stale-while-revalidate=86400"
    )
