"""The county-card writers store the totals each card was built from, rewrite
cards whose totals went stale, and the API then serves what they wrote.

2026-09-22: the map's Fresno card said "126 fatalities from 10,493 crashes"
(written while 2025 deaths were still filling in) beside a report card
saying 142 / 10,546. The writers now record the snapshot and the API only
serves a card while it still matches mv_crashes_by_year.
"""

from datetime import datetime

import pytest
from sqlalchemy import text

import etl.generate_county_cards as cc
import etl.generate_fun_facts as ff
import etl.generate_llm_cards as llm
from app.models import Crash, CountyInsightCard

pytestmark = pytest.mark.integration

_OK = "Los Angeles County recorded 1 crash and 1 death in 2022, the only one that year."


@pytest.fixture()
def llm_run(db_session, monkeypatch):
    """generate_llm_cards.run against the test session with a fake model."""
    calls = []

    def fake(prompt):
        calls.append(prompt)
        return _OK

    monkeypatch.setattr(llm, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(llm, "generate_narrative", fake)
    monkeypatch.setattr(llm.time, "sleep", lambda s: None)

    def run(**kw):
        calls.clear()
        created = llm.run(years=[2022], counties=["los_angeles"], delay=0, **kw)
        return created, len(calls)

    return run


def _cards(db_session, code, year):
    return {
        c.angle: c for c in db_session.query(CountyInsightCard).filter_by(county_code=code, year=year)
    }


def test_llm_cards_store_totals_and_respect_the_limit(llm_run, db_session):
    created, calls = llm_run(angles=["overview", "cause_focus", "dui"], limit=2)
    assert (created, calls) == (2, 2)
    cards = _cards(db_session, 19, 2022)
    assert len(cards) == 2
    # LA 2022 is seeded with one crash that killed one person.
    assert {(c.total_crashes, c.total_killed) for c in cards.values()} == {(1, 1)}


def test_llm_rerun_skips_current_cards_and_rewrites_stale_ones(llm_run, db_session):
    llm_run(angles=["overview"])
    db_session.add(CountyInsightCard(
        county_code=19, county_name="Los Angeles", year=2022, angle="cause_focus",
        narrative="An old card built from an earlier snapshot of 2022, now stale.",
        total_crashes=1, total_killed=0,
    ))
    db_session.add(CountyInsightCard(
        county_code=19, county_name="Los Angeles", year=2022, angle="dui",
        narrative="A legacy card from before totals were stored on each card.",
    ))
    db_session.flush()

    created, calls = llm_run(angles=["overview", "cause_focus", "dui"])
    assert (created, calls) == (2, 2)  # overview was current; the other two were not
    cards = _cards(db_session, 19, 2022)
    assert cards["cause_focus"].narrative == _OK
    assert (cards["dui"].total_crashes, cards["dui"].total_killed) == (1, 1)


def test_llm_card_is_served_by_the_api_with_its_year(llm_run, client):
    llm_run(angles=["overview"])
    body = client.get("/api/insight-cards/random?county=los-angeles&year=2022").json()
    assert body["narrative"] == _OK
    assert body["year"] == 2022


@pytest.fixture()
def sf_2023(db_session):
    """50 San Francisco crashes in 2023 — enough for the template generators'
    >= 50-crash floor — with the matview refreshed inside the test transaction."""
    db_session.add_all([
        Crash(
            id=5000 + i, collision_id=5000 + i, data_source="ccrs",
            crash_datetime=datetime(2023, 1 + i % 12, 1 + i % 28, i % 24), county_code=38,
            crash_year=2023, crash_hour=i % 24, crash_month=1 + i % 12, day_of_week_num=i % 7,
            severity="Fatal" if i < 2 else "Injury",
            canonical_cause=("speeding", "dui", "lane_change")[i % 3],
            number_killed=1 if i < 2 else 0, number_injured=1, county_name="San Francisco",
        )
        for i in range(50)
    ])
    db_session.flush()
    db_session.execute(text("REFRESH MATERIALIZED VIEW mv_crashes_by_year"))
    return db_session


def test_template_cards_store_totals_and_are_served(sf_2023, client, monkeypatch):
    monkeypatch.setattr(cc, "SessionLocal", lambda: sf_2023)
    assert cc.run() > 0
    cards = _cards(sf_2023, 38, 2023)
    # The seed's one 2023 SF crash plus the 50 added here; 2 deaths.
    assert {(c.total_crashes, c.total_killed) for c in cards.values()} == {(51, 2)}
    assert client.get("/api/insight-cards/random?county=san-francisco").json()["year"] == 2023


def test_template_rerun_rewrites_only_stale_cards(sf_2023, monkeypatch):
    monkeypatch.setattr(cc, "SessionLocal", lambda: sf_2023)
    first = cc.run()
    assert cc.run() == 0  # everything current
    card = next(iter(_cards(sf_2023, 38, 2023).values()))
    card.total_killed = 1  # as if written before a death was added
    sf_2023.flush()
    assert cc.run() == 1
    assert first > 1


def test_fun_facts_store_totals(sf_2023):
    ff._generate_county(sf_2023, force=True)
    facts = [c for a, c in _cards(sf_2023, 38, 2023).items() if a.startswith("fun_fact")]
    assert facts
    assert {(c.total_crashes, c.total_killed) for c in facts} == {(51, 2)}
