"""Write-time fun-fact check (etl.fact_check) + the audit's decision logic.

2026-09-18: live fun facts said "The pandemic year likely played a role",
compared partial-2026 to full-2025 ("Crash volume dropped 38.7%"), and an
orphan Los Angeles row cited "400,000 vehicles per day at the Sepulveda Pass".
"""

import pytest

import etl.audit_narratives as na
import etl.generate_llm_cards as llm_mod
from etl import generate_county_cards as cc
from etl import generate_fun_facts as ff
from etl.audit_fun_facts import COUNTY_ANGLES, STATEWIDE_ANGLES, audit_row
from etl.fact_check import CAUSAL_RE, check_claims, check_fact, find_causal, numbers_context

_STATS = "total_crashes=150,000, killed=800, injured=70,000, county_share=33.33%"


# ── check_fact ───────────────────────────────────────────────────────────


def test_clean_fact_passes():
    assert check_fact("Los Angeles logged 150,000 crashes and 800 deaths in 2024.", _STATS, 2024, 2026) == []


def test_invented_external_figure_fails():
    text = "About 400,000 vehicles per day squeeze through the Sepulveda Pass."
    assert check_fact(text, _STATS, 2024, 2026) == ["figures not in stats: [400000.0]"]


@pytest.mark.parametrize("phrase", [
    "because", "due to", "caused", "caused by", "leads to", "lead to", "resulted in",
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


# ── the cause noun is a SWITRS category label, not a causal claim ─────────
#
# `caus\w*` flagged every sentence that named the crash-cause category, so
# the narrative gate could never be switched on without rejecting honest
# category prose. The cause family now has to read as a verb.

@pytest.mark.parametrize("text", [
    "27 (39.7%) were caused by speeding.",
    "The 2020 drop was caused by the stay-at-home order.",
    "Heavier rain causes drivers to slow down.",
    "Congestion at 5 PM causes the evening peak to flatten.",
    # Bare transitive "X causes Y" — no infinitive to lean on, and the most
    # natural way for a model to assert a cause in the present tense.
    "Speeding causes crashes.",
    "Unsafe speed causes fatal collisions.",
    "Speeding causes the majority of crashes.",
    "Distraction causes more deaths than DUI.",
    "Rain can cause more crashes on rural highways.",
    "Poor lighting may cause the evening cluster.",
    "Crash totals fell because fewer people commuted.",
    "The rise is driven by nighttime collisions.",
    "Wet pavement leads to more single-vehicle collisions.",
    "Lower speeds result in fewer fatalities.",
    "Totals dropped due to the pandemic.",
    "The pandemic likely played a role in the 2020 dip.",
])
def test_causal_phrases_flagged(text):
    assert CAUSAL_RE.search(text), text


@pytest.mark.parametrize("text", [
    "Incidents classified under other causes represent the largest share.",
    "The top cause was unsafe speed at 39.7% of crashes.",
    "Unsafe speed is the leading cause of crashes in this county.",
    "Every crash carries a cause category from the SWITRS codebook.",
    "Other causes and unknown causes together account for a tenth of the total.",
    "The cause breakdown tends to look the same from year to year.",
    "The leading cause was unsafe speed.",
    "The chart groups crashes by cause, month and hour.",
    "Crash causes are coded by the reporting officer.",
    "Each cause is recorded in a single field.",
    "Traffic backs up on the causeway.",
    # The unique_factor template, once every template angle got the check.
    "No single cause usually exceeds 30%.",
    "Crashes led the state that year.",
    "The result was 12 fewer crashes.",
])
def test_cause_category_nouns_not_flagged(text):
    assert CAUSAL_RE.search(text) is None, text


# ── hedged speculation is still a cause claim ─────────────────────────────
#
# 2026-09-23: our own recovery template said "emptier roads may have
# encouraged riskier driving" and the gate let it through — a hedge in front
# of an explanation the data can't support.

@pytest.mark.parametrize("text", [
    "Emptier roads may have encouraged speeding.",
    "Crashes fell 12%, likely due to remote work.",
    "Crashes fell 12%, possibly because fewer people commuted.",
    "The drop could reflect remote work.",
    "The rise likely reflects more miles driven.",
    "Crashes are likely driven by rain and fog.",
    "The spike was likely influenced by holiday travel.",
    "Remote work might have contributed to the decline.",
    "Longer EMS response times are likely factors.",
    "Fog is probably a factor on Highway 99.",
    "The dip is likely the result of the stay-at-home order.",
    "Tourism may be linked to the summer peak.",
    "That would explain the evening cluster.",
    "Lower gas prices may also have fueled the increase.",
    "The pandemic may well have played a role.",
    "Could reflect\nremote work.",
])
def test_hedged_causal_speculation_flagged(text):
    assert find_causal(text), text


@pytest.mark.parametrize("text", [
    "Crashes fell 12% from 2019 to 2020.",
    "May had the most crashes of any month.",
    "In May 2020 crashes fell 12%.",
    "Crashes peaked in May, with 1,200 recorded.",
    "Figures for 2025 may change as late reports arrive.",
    "The 2025 totals may be incomplete.",
    "Crashes here are 3x more likely to be fatal than the state average.",
    "The most likely hour for a crash is 5 PM.",
    "If every county matched this rate, the state would see 5,000 fewer crashes.",
    "It sits higher than its population share would suggest.",
    "Deaths could still rise as reports arrive.",
    "The county might rank higher next year.",
])
def test_plain_descriptive_sentences_not_flagged(text):
    assert find_causal(text) is None, text


def test_hedged_pattern_is_linear_on_adversarial_input():
    import time

    evil = ("may " + "have " * 3 + " " * 20_000) * 20 + "x"
    start = time.perf_counter()
    assert find_causal(evil) is None
    assert time.perf_counter() - start < 1.0


# ── "crashes resulted in injuries" reports an outcome, not a cause ────────
#
# 2026-09-19: the gate rejected 32 narratives (7 stayed NULL after the retry)
# for sentences like our own severity template's "incidents (52.1%) resulted
# in bent metal but no injuries". A crash noun as the subject and a harm as
# the object is a tally of what happened, so it passes; anything else keeps
# failing.

@pytest.mark.parametrize("text", [
    "1,204 crashes resulted in injuries.",
    "12 collisions resulted in at least one death.",
    "9,100 incidents (52.1%) resulted in bent metal but no injuries.",
    "Most crashes that resulted in a fatality happened after dark.",
    "Only 3 crashes resulted in serious injury.",
    "Each crash results in property damage, injury or death.",
])
def test_crash_outcome_tallies_pass(text):
    assert find_causal(text) is None, text


@pytest.mark.parametrize("text", [
    "Lower speeds result in fewer fatalities.",
    "Speeding resulted in 27 deaths.",
    "The stay-at-home order resulted in fewer crashes.",
    "More crashes resulted in higher insurance premiums.",
    "12 crashes resulted in deaths because of speeding.",
])
def test_causal_result_in_still_flagged(text):
    assert find_causal(text), text


@pytest.mark.parametrize("stats, text", [
    # The spelling the county-narrative context uses.
    ("total_killed=96", "The county averaged about 8 deaths a month."),
    ("total_killed=4,380, total_injured=52,000",
     "That works out to about 365 deaths a month and roughly 1,000 injuries a week."),
    ("total_crashes=52,310", "Roughly 143 crashes a day."),
    # The spelling the fun-fact context uses — unchanged.
    ("total_crashes=150,000, killed=800, injured=70,000",
     "That is about 67 deaths a month and 1,346 injuries a week."),
])
def test_derivations_pass_for_both_stat_spellings(stats, text):
    assert check_fact(text, stats, 2024, 2026) == []


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
    "tc": 150_000, "tk": 800, "ti": 70_000, "deaths_per_1k": 5.3,
    "dow": {0: 20_000, 4: 25_000, 6: 18_000}, "months": {1: 11_000, 10: 14_000},
    "peak_hour": (17, 12_000), "quiet_hour": (4, 900),
    "causes": [("unsafe_speed", 60_000), ("improper_turning", 20_000), ("dui", 9_000)],
    "dui_count": 9_000, "dui_pct": 6.0, "state_total": 450_000, "state_killed": 4_000,
    "state_deaths_per_1k": 8.9, "state_dui_pct": 8.5, "county_share": 33.33,
    "pop": 9_800_000, "per_capita": 1531.0,
    "hist": [(2016, 160_000), (2017, 165_000), (2018, 170_000), (2019, 168_000), (2020, 100_000)],
    "yoy": -3.2, "rank": 1, "crashes_per_day": 411.0, "year": 2024,
}
_SMALL_COUNTY = {
    **_BIG_COUNTY, "tc": 120, "tk": 3, "ti": 60, "deaths_per_1k": 25.0,
    "dow": {0: 12, 5: 25}, "months": {3: 14, 8: 6}, "peak_hour": (15, 14), "quiet_hour": (3, 1),
    "causes": [("unsafe_speed", 70), ("dui", 20)], "dui_count": 20, "dui_pct": 16.7,
    "county_share": 0.03, "pop": 1_200, "per_capita": 10_000.0,
    "hist": [(2016, 90), (2017, 140), (2018, 120), (2019, 110), (2020, 60)],
    "rank": 58, "crashes_per_day": 0.3,
}
_STATEWIDE = {
    "tc": 450_000, "tk": 4_000, "ti": 200_000, "year": 2024, "deaths_per_1k": 8.9,
    "crashes_per_day": 1232.9, "top_county": ("Los Angeles", 150_000),
    "small_county": ("Alpine", 40), "high_fat": ("Modoc", 35.0, 7),
    "low_fat": ("San Francisco", 3.0), "top_cause": ("unsafe_speed", 130_000),
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
    "deaths_per_1k": 5.3, "st_deaths_per_1k": 8.9, "months": [(10, 14_000), (1, 11_000)],
    "county_share": 33.33, "pop": 9_800_000,
}


@pytest.mark.parametrize("data", [
    _CARD_DATA,
    {**_CARD_DATA, "tc": 5_000, "tk": 90, "rank": 30, "fat_rank": 2, "deaths_per_1k": 18.0,
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


# ── county-narrative audit decision logic (no DB) ────────────────────────

_ALPINE = (
    "Alpine County recorded 68 crashes in 2019. Of those, 27 (39.7%) were "
    "caused by speeding. Collisions clustered in the late afternoon."
)


def test_narrative_audit_flags_causal_and_reports_the_sentence():
    ctx = lambda: "total_crashes=68, cause_count=27, top_cause_pct=39.7"  # noqa: E731
    assert na.audit_row(_ALPINE, 2019, ctx, 2026) == ["causal language: 'caused by'"]
    assert na.offending_phrase(_ALPINE) == "Of those, 27 (39.7%) were caused by speeding."


def test_narrative_audit_keeps_clean_row_and_skips_null():
    def boom():
        raise AssertionError("context must not be built for a NULL narrative")

    assert na.audit_row(None, 2019, boom, 2026) == []
    clean = "Alpine County recorded 68 crashes in 2019; the leading cause was unsafe speed."
    assert na.audit_row(clean, 2019, lambda: "total_crashes=68", 2026) == []


# ── named causes and the rate unit (check_claims) ────────────────────────
#
# 2026-09-22 phone audit: the live Fresno "Top Causes" card said "1.2 per 100
# crashes versus the statewide 0.68 average. High-speed rural road crashes,
# particularly head-on collisions from unsafe passing, drive this elevated
# severity." Nothing it was built from names head-on crashes or passing, and
# the site states this rate per 1,000 crashes (13.5 vs 8.5).

_FRESNO_STATS = (
    "total_crashes=10,546, killed=142, injured=5,446, deaths_per_1000_crashes=13.5, "
    "statewide_deaths_per_1000_crashes=8.5, top_causes=speeding(25.6%), "
    "lane_change(12.0%), right_of_way(10.1%), peak_hour=17:00, rank=10/58, "
    "state_total=401,710, county_share=2.63%, pedestrian_crashes=512, "
    "cyclist_crashes=198, hit_run_crashes=1502, speeding_crashes=2697, dui_crashes=1150"
)
_AUDIT_SENTENCE = (
    "Fresno County's 126 fatalities from 10,493 crashes give it one of the highest "
    "fatality rates per crash among California's large counties — 1.2 per 100 crashes "
    "versus the statewide 0.68 average. High-speed rural road crashes, particularly "
    "head-on collisions from unsafe passing, drive this elevated severity."
)
_HONEST = (
    "In 2025 Fresno County recorded 10,546 crashes and 142 deaths, 13.5 deaths per "
    "1,000 crashes against 8.5 statewide. Speeding was the most common primary "
    "factor at 25.6% of crashes, followed by unsafe lane changes and right-of-way "
    "violations; 1,150 crashes involved DUI."
)


def test_audit_sentence_is_rejected():
    assert check_claims(_AUDIT_SENTENCE, _FRESNO_STATS) == [
        "causes not in stats: ['head-on', 'unsafe passing']",
        "death rate not per 1,000 crashes: 'per 100 crashes'",
    ]


def test_honest_sentence_passes_every_gate():
    assert check_claims(_HONEST, _FRESNO_STATS) == []
    assert check_fact(_HONEST, _FRESNO_STATS, 2025, 2026) == []


@pytest.mark.parametrize("text, label", [
    ("Rear-end crashes dominate the freeway total.", "rear-end"),
    ("T-bone collisions at intersections stand out.", "broadside"),
    ("Rollovers are common on mountain grades.", "rollover"),
    ("Distracted drivers on cell phones account for many crashes.", "distraction"),
    ("Red-light running is a leading factor.", "red-light running"),
    ("Wrong-way drivers on Highway 99 stand out.", "wrong-way"),
])
def test_named_cause_missing_from_stats_is_rejected(text, label):
    assert check_claims(text, _FRESNO_STATS) == [f"causes not in stats: [{label!r}]"]


@pytest.mark.parametrize("text", [
    "Speeding led all factors.",
    "Drunk and impaired drivers were involved in 1,150 crashes.",
    "Unsafe lane changes ranked second.",
    "Failure to yield the right of way ranked third.",
    "Traffic moved ahead on schedule; the county sits on rural roads.",
])
def test_named_cause_in_stats_or_generic_wording_passes(text):
    assert check_claims(text, _FRESNO_STATS) == []


@pytest.mark.parametrize("text", [
    "Fresno's fatality rate of 1.35% is above the state's.",
    "The death rate was 1.3% last year.",
    "That is 1.2 deaths per 100 collisions.",
])
def test_percent_or_per_100_death_rate_is_rejected(text):
    assert check_claims(text, _FRESNO_STATS)[0].startswith("death rate not per 1,000 crashes")


def test_llm_card_with_the_audit_sentence_is_never_stored(monkeypatch):
    monkeypatch.setattr(llm_mod, "generate_narrative", lambda p: _AUDIT_SENTENCE)
    assert llm_mod._generate_verified("p", _FRESNO_STATS, 2025, "fresno", "cause_focus") is None


def test_llm_card_retry_with_honest_text_is_stored(monkeypatch):
    answers = iter([_AUDIT_SENTENCE, _HONEST])
    monkeypatch.setattr(llm_mod, "generate_narrative", lambda p: next(answers))
    assert llm_mod._generate_verified("p", _FRESNO_STATS, 2025, "fresno", "cause_focus") == _HONEST


def test_llm_guardrails_ask_for_per_1000_and_supported_causes():
    assert "per 1,000 crashes" in llm_mod._GUARDRAILS
    assert "collision type" in llm_mod._GUARDRAILS


_FULL_CARD = {
    "tc": 150_000, "tk": 800, "ti": 70_000, "deaths_per_1k": 5.3, "year": 2024,
    "causes": [("speeding", 45_000, 30.0), ("lane_change", 20_000, 13.3), ("dui", 9_000, 6.0)],
    "dui": 9_000, "dui_pct": 6.0, "sev": {}, "fatal_count": 700, "pdo_count": 90_000,
    "peak_hour": (17, 12_000),
    "months": [(10, 14_000), *((m, 12_500) for m in (1, 3, 4, 5, 6, 7, 8, 9, 11, 12)), (2, 10_000)],
    "dow": [(4, 25_000), (6, 18_000), (0, 20_000)],
    "hw_count": 50_000, "fw_count": 30_000, "hw_pct": 33.3,
    "ped": 6_000, "cyc": 3_000, "ped_pct": 4.0, "cyc_pct": 2.0, "hr": 20_000, "hr_pct": 13.3,
    "pop": 9_800_000, "per_cap": 1531, "density": 2_400, "income": 85_000, "poverty": 13.0,
    "commute_drive": 70.0, "st_tc": 450_000, "st_tk": 4_000, "st_deaths_per_1k": 8.9,
    "st_dui_pct": 8.5, "st_ped_pct": 3.0, "st_cyc_pct": 2.5, "st_hr_pct": 12.0,
    "county_share": 33.33, "rank": 1, "fat_rank": 50,
    "hist": [(y, 150_000 + y, 800) for y in range(2014, 2025)],
}
_RURAL_CARD = {
    **_FULL_CARD, "tc": 300, "tk": 9, "ti": 150, "deaths_per_1k": 30.0,
    "causes": [("speeding", 120, 40.0)], "dui": 0, "dui_pct": 0.0, "peak_hour": (23, 30),
    "hw_pct": 45.0, "pop": 3_000, "per_cap": 10_000, "density": 20, "rank": 57, "fat_rank": 2,
    "hist": [(y, 300, 9) for y in range(2014, 2025)],
}


@pytest.mark.parametrize("data", [_FULL_CARD, _RURAL_CARD])
def test_county_card_templates_name_only_causes_in_their_data(data):
    for angle, compose in cc.ANGLES.items():
        text = compose("Kern", data)
        assert check_claims(text, cc.claims_context(data)) == [], (angle, text)


# Branch coverage for the explanation-free check below: each variant steers a
# template into a branch that used to explain its numbers.
_WINTER_MONTHS = [(12, 20_000), (1, 19_000), (2, 18_000),
                  *((m, 10_000) for m in range(3, 12))]
_COVID_HIST = [(2018, 1_000, 10), (2019, 1_000, 10), (2020, 700, 9),
               (2021, 800, 9), (2022, 800, 9), (2023, 800, 9)]
_TEMPLATE_VARIANTS = [
    _FULL_CARD,
    _RURAL_CARD,
    {**_FULL_CARD, "peak_hour": (8, 12_000), "months": _WINTER_MONTHS, "hist": _COVID_HIST,
     "commute_drive": 85.0, "poverty": 18.0, "per_cap": 3_500, "density": 800,
     "hw_pct": 45.0, "cyc": 0, "cyc_pct": 0.0},
    {**_FULL_CARD, "peak_hour": (12, 12_000), "commute_drive": 60.0, "density": 200,
     "income": 90_000, "per_cap": 1_200, "hw_pct": 5.0, "dui_pct": 12.0,
     "hist": [(2018, 1_000, 10), (2019, 1_000, 10), (2020, 1_100, 11), (2021, 1_300, 9)]},
    {**_RURAL_CARD, "deaths_per_1k": 30.0, "tc": 400, "dow": [(5, 90), (6, 80), (0, 40)],
     "hist": [(2018, 300, 9), (2019, 300, 9), (2020, 250, 9), (2021, 400, 9)]},
]


@pytest.mark.parametrize("data", _TEMPLATE_VARIANTS)
def test_county_card_templates_state_no_causes(data):
    for angle, compose in cc.ANGLES.items():
        text = compose("Kern", data)
        assert find_causal(text) is None, (angle, text)


def test_county_card_writer_rejects_and_rewrites_explained_cards():
    from types import SimpleNamespace

    hedged = "Winter crashes outpace summer by 12%, likely driven by rain."
    assert cc._card_fails("Kern", 2024, "seasonal", hedged, _FULL_CARD)
    assert not cc._card_fails("Kern", 2024, "seasonal", "Winter crashes outpace summer.", _FULL_CARD)
    totals = {"total_crashes": _FULL_CARD["tc"], "total_killed": _FULL_CARD["tk"]}
    assert cc._is_current(SimpleNamespace(narrative="Plain text.", **totals), _FULL_CARD)
    assert not cc._is_current(SimpleNamespace(narrative=hedged, **totals), _FULL_CARD)


def test_statewide_llm_cards_get_the_causal_check(monkeypatch):
    """The landing card served "Insurance actuaries had known this for
    decades"; statewide prompts don't ask "why", so they get the full check."""
    calls = []

    def fake(prompt):
        calls.append(prompt)
        return "California's 150,000 crashes may reflect remote work."

    monkeypatch.setattr(llm_mod, "generate_narrative", fake)
    assert llm_mod._generate_verified(
        "p", _STATS, 2024, "statewide/2024/overview", "overview", facts_only=True,
    ) is None
    assert "not what caused them" in calls[1]
