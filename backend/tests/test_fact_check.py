"""Write-time fun-fact check (etl.fact_check) + the audit's decision logic.

2026-09-18: live fun facts said "The pandemic year likely played a role",
compared partial-2026 to full-2025 ("Crash volume dropped 38.7%"), and an
orphan Los Angeles row cited "400,000 vehicles per day at the Sepulveda Pass".
"""

import pytest

import etl.generate_llm_cards as llm_mod
from etl import generate_county_cards as cc
from etl import generate_fun_facts as ff
from etl.audit_fun_facts import COUNTY_ANGLES, STATEWIDE_ANGLES, audit_row
from etl.fact_check import check_fact, numbers_context

_STATS = "total_crashes=150,000, killed=800, injured=70,000, county_share=33.33%"


# ── check_fact ───────────────────────────────────────────────────────────


def test_clean_fact_passes():
    assert check_fact("Los Angeles logged 150,000 crashes and 800 deaths in 2024.", _STATS, 2024, 2026) == []


def test_invented_external_figure_fails():
    text = "About 400,000 vehicles per day squeeze through the Sepulveda Pass."
    assert check_fact(text, _STATS, 2024, 2026) == ["figures not in stats: [400000.0]"]


@pytest.mark.parametrize("phrase", [
    "because", "due to", "caused", "causes", "leads to", "lead to", "resulted in",
    "results in", "likely played", "driven by", "thanks to", "Because",
])
def test_causal_language_fails(phrase):
    reasons = check_fact(f"Crashes fell 12 {phrase} remote work.", "12", 2024, 2026)
    assert reasons and reasons[0].startswith("causal language")


@pytest.mark.parametrize("text", [
    "The result was 12 fewer crashes.", "Crashes led the state.", "Drive with caution.",
])
def test_non_causal_words_pass(text):
    assert check_fact(text, "12", 2024, 2026) == []


def test_current_partial_year_fails():
    text = "Crash volume dropped 38.7% compared to the prior year."
    assert check_fact(text, "yoy=-38.7", 2026, 2026) == ["year 2026 is not complete yet"]
    assert check_fact(text, "yoy=-38.7", 2025, 2026) == []


def test_all_reasons_reported_together():
    text = "Crashes fell 50,000 due to the pandemic."
    assert len(check_fact(text, _STATS, 2026, 2026)) == 3


def test_numbers_context_skips_keys_and_bools():
    ctx = numbers_context({"dow": {6: 1234}, "flag": True, "name": "Alpine", "hist": [(2020, 55)]})
    assert ctx.split() == ["1234.0", "2020.0", "55.0"]


# ── templates pass by construction ───────────────────────────────────────

_BIG_COUNTY = {
    "tc": 150_000, "tk": 800, "ti": 70_000, "fatality_rate": 0.53,
    "dow": {0: 20_000, 4: 25_000, 6: 18_000}, "months": {1: 11_000, 10: 14_000},
    "peak_hour": (17, 12_000), "quiet_hour": (4, 900),
    "causes": [("unsafe_speed", 60_000), ("improper_turning", 20_000), ("dui", 9_000)],
    "dui_count": 9_000, "dui_pct": 6.0, "state_total": 450_000, "state_killed": 4_000,
    "state_fatality_rate": 0.89, "state_dui_pct": 8.5, "county_share": 33.33,
    "pop": 9_800_000, "per_capita": 1531.0,
    "hist": [(2016, 160_000), (2017, 165_000), (2018, 170_000), (2019, 168_000), (2020, 100_000)],
    "yoy": -3.2, "rank": 1, "crashes_per_day": 411.0, "year": 2024,
}
_SMALL_COUNTY = {
    **_BIG_COUNTY, "tc": 120, "tk": 3, "ti": 60, "fatality_rate": 2.5,
    "dow": {0: 12, 5: 25}, "months": {3: 14, 8: 6}, "peak_hour": (15, 14), "quiet_hour": (3, 1),
    "causes": [("unsafe_speed", 70), ("dui", 20)], "dui_count": 20, "dui_pct": 16.7,
    "county_share": 0.03, "pop": 1_200, "per_capita": 10_000.0,
    "hist": [(2016, 90), (2017, 140), (2018, 120), (2019, 110), (2020, 60)],
    "rank": 58, "crashes_per_day": 0.3,
}
_STATEWIDE = {
    "tc": 450_000, "tk": 4_000, "ti": 200_000, "year": 2024, "fatality_rate": 0.89,
    "crashes_per_day": 1232.9, "top_county": ("Los Angeles", 150_000),
    "small_county": ("Alpine", 40), "high_fat": ("Modoc", 3.5, 7),
    "low_fat": ("San Francisco", 0.3), "top_cause": ("unsafe_speed", 130_000),
    "dui_count": 30_000, "dui_pct": 6.7, "high_dui": ("Inyo", 14.2),
    "peak_hour": (17, 36_000), "dow": {0: 60_000, 4: 70_000}, "yoy": -8.4,
}


@pytest.mark.parametrize("stats", [_BIG_COUNTY, _SMALL_COUNTY])
@pytest.mark.parametrize("name", ["Los Angeles", "Alpine", "Kern", "Modoc", "Napa"])
def test_fun_fact_county_templates_pass(stats, name):
    ctx = ff.fact_context(stats)
    for angle, compose in ff.COUNTY_ANGLES.items():
        text = compose(name, stats)
        assert check_fact(text, ctx, 2024, 2026) == [], (angle, text)


@pytest.mark.parametrize("stats", [
    _STATEWIDE,
    {**_STATEWIDE, "peak_hour": (2, 30_000), "dui_pct": 11.2, "yoy": 9.1},
])
def test_fun_fact_statewide_templates_pass(stats):
    ctx = ff.fact_context(stats)
    for angle, compose in ff.STATEWIDE_ANGLES.items():
        text = compose(stats)
        assert check_fact(text, ctx, 2024, 2026) == [], (angle, text)


_CARD_DATA = {
    "tc": 150_000, "tk": 800, "ti": 70_000, "year": 2024, "rank": 1, "fat_rank": 50,
    "fat_rate": 0.53, "st_fat_rate": 0.89, "months": [(10, 14_000), (1, 11_000)],
    "county_share": 33.33, "pop": 9_800_000,
}


@pytest.mark.parametrize("data", [
    _CARD_DATA,
    {**_CARD_DATA, "tc": 5_000, "tk": 90, "rank": 30, "fat_rank": 2, "fat_rate": 1.8,
     "county_share": 1.1, "pop": 200_000, "months": [(7, 600)]},
    {**_CARD_DATA, "tc": 300, "tk": 0, "rank": 57, "county_share": 0.07, "pop": 3_000,
     "months": [(7, 40)]},
])
def test_county_card_fun_fact_templates_pass(data):
    ctx = cc.fact_context(data)
    for angle, compose in cc.ANGLES.items():
        if angle.startswith("fun_fact"):
            text = compose("Kern", data)
            assert check_fact(text, ctx, 2024, 2026) == [], (angle, text)


# ── audit decision logic (no DB) ─────────────────────────────────────────


def test_orphan_angle_flagged_without_building_context():
    def boom():
        raise AssertionError("context must not be built for an unknown angle")

    text = "About 400,000 vehicles per day pass the Sepulveda Pass."
    assert "fun_fact" not in COUNTY_ANGLES
    assert audit_row(text, "fun_fact", 2024, COUNTY_ANGLES, boom, 2026) == [
        "angle 'fun_fact' is not produced by any generator"
    ]


def test_audit_keeps_good_row_and_flags_bad_ones():
    ctx = lambda: _STATS  # noqa: E731
    good = "Los Angeles logged 150,000 crashes in 2024."
    assert audit_row(good, "fun_fact_timing", 2024, COUNTY_ANGLES, ctx, 2026) == []
    assert audit_row(good, "fun_fact_timing", 2026, COUNTY_ANGLES, ctx, 2026) == [
        "year 2026 is not complete yet"
    ]
    causal = "Crashes fell in 2020; the pandemic likely played a role."
    assert audit_row(causal, "fun_fact_quirky", 2020, COUNTY_ANGLES, ctx, 2026) == [
        "causal language: 'likely played'"
    ]
    assert audit_row(None, "fun_fact_surprising", 2024, STATEWIDE_ANGLES, ctx, 2026) == []


# ── LLM fun facts get the causal check too ───────────────────────────────


def test_llm_fun_fact_rejects_causal_text(monkeypatch):
    calls = []

    def fake(prompt):
        calls.append(prompt)
        return "Crashes peak at 5 PM in Kern County because of commuter traffic, 150,000 in all."

    monkeypatch.setattr(llm_mod, "generate_narrative", fake)
    assert llm_mod._generate_verified("p", _STATS, 2024, "kern", "fun_fact_timing") is None
    assert "not what caused them" in calls[1]


def test_llm_other_angles_keep_numeric_gate_only(monkeypatch):
    text = "Crashes peak at 5 PM in Kern County because of commuter traffic, 150,000 in all."
    monkeypatch.setattr(llm_mod, "generate_narrative", lambda p: text)
    assert llm_mod._generate_verified("p", _STATS, 2024, "kern", "time_of_day") == text
