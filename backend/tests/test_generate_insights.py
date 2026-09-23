"""M12 — generate_insights must build cards from complete years only.

The >= 50-crash gate alone let the partial current calendar year win the
"latest year" query (any real county clears 50 crashes by February), which
made yoy_change_pct divide a partial year by a full prior year (~-50% for
every county in July) and defeated the skip-if-unchanged guard (current-year
counts churn daily → 58 LLM calls/day). The year queries now exclude the
current calendar year exactly like generate_llm_cards' "latest" mode.
"""

import pytest

import etl.generate_insights as gi
from etl.generate_insights import (
    _EXCLUDE_CURRENT_YEAR_SQL,
    _STRICTER_PROMPT_LINE,
    _all_years,
    _build_update_dict,
    _fresh_narrative,
    _latest_year,
    _stats_parts,
    is_junk_narrative,
)


class _CaptureResult:
    def __init__(self, scalar_value=None):
        self._scalar = scalar_value

    def scalar(self):
        return self._scalar

    def all(self):
        return [(self._scalar,)] if self._scalar is not None else []


class _CaptureDB:
    """Session stand-in that records the SQL each helper issues."""

    def __init__(self, scalar_value=2025):
        self.statements = []
        self._scalar = scalar_value

    def execute(self, clause, params=None):
        self.statements.append(" ".join(str(clause).split()))
        return _CaptureResult(scalar_value=self._scalar)


def test_latest_year_excludes_current_calendar_year():
    db = _CaptureDB(scalar_value=2025)

    assert _latest_year(db, 19) == 2025

    sql = db.statements[0].lower()
    assert "crash_year < extract(year from current_date)" in sql
    # The sparse-year gate must survive the change.
    assert "count(*) >= :min" in sql


def test_all_years_excludes_current_calendar_year():
    db = _CaptureDB(scalar_value=2025)

    assert _all_years(db, 19) == [2025]

    sql = db.statements[0].lower()
    assert "crash_year < extract(year from current_date)" in sql
    assert "count(*) >= :min" in sql


def test_exclusion_matches_generate_llm_cards_pattern():
    """Both card generators must gate on the same current-year exclusion so
    the two insight surfaces never disagree about which year is 'latest'."""
    assert "crash_year < EXTRACT(year FROM CURRENT_DATE)" in _EXCLUDE_CURRENT_YEAR_SQL


# ── junk-narrative detection ─────────────────────────────────────────────
#
# Older rows hold chatter from the previous model ("Here is a 2-3 sentence
# narrative...") — non-NULL, so the NULL-only retry never touched them.

_REAL = (
    "Los Angeles County recorded 52,310 crashes in 2011, a 3% drop from 2010; "
    "unsafe speed was the leading cause."
)


@pytest.mark.parametrize(
    "text",
    [
        None,
        "",
        "Here is a 2-3 sentence narrative for Los Angeles County in 2010: " + _REAL,
        "Here's the narrative: " + _REAL,
        "Sure, here's a short summary. " + _REAL,
        "Certainly! " + _REAL,
        "Okay. " + _REAL,
        "Below is the requested text. " + _REAL,
        "As an AI language model I " + _REAL,
        "I cannot generate " + _REAL,
        "I can't generate " + _REAL,
        "**Los Angeles County, 2010** " + _REAL,
        _REAL + " (2-3 sentence version)",
        "Crashes fell 3% in 2011.",
    ],
)
def test_is_junk_narrative_flags_chatter(text):
    assert is_junk_narrative(text) is True


def test_is_junk_narrative_keeps_real_prose():
    assert is_junk_narrative(_REAL) is False
    assert is_junk_narrative("  " + _REAL + "\n") is False


# ── stale-stats detection ────────────────────────────────────────────────
#
# 2026-09-12: SWITRS 2001 grew from 310k to 522k crashes, but run_all_years
# skipped every existing row whose narrative wasn't junk — LA 2001 kept
# showing 98,838 crashes and every 2002 card's YoY stayed wrong.

from etl.generate_insights import _PROMPT_TEMPLATE, stats_changed  # noqa: E402

_LA_2001 = {
    "total_crashes": 150_421, "total_killed": 768,
    "total_injured": 60_000, "yoy_change_pct": None,
}


def _row(tc, tk, ti, yoy, narrative=_REAL):
    return (tc, tk, ti, yoy, narrative)


def test_stats_changed_false_when_numbers_match():
    assert stats_changed(_row(150_421, 768, 60_000, None), _LA_2001) is False


def test_stats_changed_true_when_total_crashes_grew():
    assert stats_changed(_row(98_838, 504, 40_000, None), _LA_2001) is True


def test_stats_changed_true_when_yoy_moved():
    stats = {**_LA_2001, "yoy_change_pct": 3.1}
    assert stats_changed(_row(150_421, 768, 60_000, 56.85), stats) is True


def test_stats_changed_tolerates_float_noise_in_yoy():
    stats = {**_LA_2001, "yoy_change_pct": 3.1}
    # Numeric(...) round-trips never trigger a 58-call regen.
    assert stats_changed(_row(150_421, 768, 60_000, 3.12), stats) is False


def test_stats_changed_when_yoy_appears_or_disappears():
    stats = {**_LA_2001, "yoy_change_pct": 3.1}
    assert stats_changed(_row(150_421, 768, 60_000, None), stats) is True
    assert stats_changed(_row(150_421, 768, 60_000, 3.1), _LA_2001) is True


def test_prompt_forbids_unsupplied_comparisons():
    assert "national average" in _PROMPT_TEMPLATE
    assert "peak hour" in _PROMPT_TEMPLATE


# ── write-time junk guard ────────────────────────────────────────────────
#
# A junk reply from the model must not overwrite a good stored narrative:
# _fresh_narrative returns None, and _build_update_dict omits the column.

_STATS = dict(total_crashes=1, total_killed=0, total_injured=0, crash_rate_per_capita=0.0,
              top_cause="dui", top_cause_pct=0.0, yoy_change_pct=None, peak_hour=0, dui_pct=0.0)


# Shaped like _stats_parts: the top cause the cards name is in it.
_CTX = "total_crashes=52,310, yoy_change=-3.0%, top_cause=unsafe_speed (31.2%)"


@pytest.mark.parametrize("reply", ["Here is a 2-3 sentence summary", "", "**Los Angeles County**"])
def test_junk_reply_keeps_stored_narrative(monkeypatch, reply):
    monkeypatch.setattr(gi, "generate_narrative", lambda prompt: reply)
    narrative = _fresh_narrative("prompt", "Los Angeles (2025)", _CTX, 2011)
    assert narrative is None
    assert "narrative" not in _build_update_dict(_STATS, narrative, None)


def test_real_reply_is_written(monkeypatch):
    monkeypatch.setattr(gi, "generate_narrative", lambda prompt: _REAL)
    narrative = _fresh_narrative("prompt", "Los Angeles (2025)", _CTX, 2011)
    assert narrative == _REAL
    assert _build_update_dict(_STATS, narrative, None)["narrative"] == _REAL


# ── write-time fact gate ─────────────────────────────────────────────────
#
# Live on 2026-09-18: Alpine's card asserted "27 (39.7%) were caused by
# speeding". The fun-fact cards ran etl.fact_check; the narrative did not.

_CAUSAL = (
    "Alpine County recorded 68 crashes in 2011. Of those, 27 (39.7%) were "
    "caused by speeding, and collisions clustered in the late afternoon."
)


def test_causal_reply_is_retried_then_accepted(monkeypatch):
    prompts = []

    def fake(prompt):
        prompts.append(prompt)
        return _CAUSAL if len(prompts) == 1 else _REAL

    monkeypatch.setattr(gi, "generate_narrative", fake)
    assert _fresh_narrative("prompt", "Alpine (2011)", _CTX, 2011) == _REAL
    assert prompts[1] == "prompt" + _STRICTER_PROMPT_LINE
    assert "never state or imply that one factor caused another" in prompts[1]


def test_stubborn_causal_reply_is_not_written(monkeypatch):
    monkeypatch.setattr(gi, "generate_narrative", lambda prompt: _CAUSAL)
    narrative = _fresh_narrative("prompt", "Alpine (2011)", _CTX, 2011)
    assert narrative is None
    # The previously stored narrative survives — the column is left out.
    assert "narrative" not in _build_update_dict(_STATS, narrative, None)


def test_invented_figure_is_not_written(monkeypatch):
    invented = (
        "Los Angeles County recorded 52,310 crashes in 2011, well under the "
        "national average of 431,900 for comparable metros."
    )
    monkeypatch.setattr(gi, "generate_narrative", lambda prompt: invented)
    assert _fresh_narrative("prompt", "Los Angeles (2011)", _CTX, 2011) is None


def test_category_wording_survives_the_gate(monkeypatch):
    """The gate must not reject the crash-cause category the card is built on."""
    text = (
        "Los Angeles County recorded 52,310 crashes in 2011. Unsafe speed was "
        "the leading cause, and other causes represent the rest of the total."
    )
    monkeypatch.setattr(gi, "generate_narrative", lambda prompt: text)
    assert _fresh_narrative("prompt", "Los Angeles (2011)", _CTX, 2011) == text


def test_unsupported_collision_type_is_not_written(monkeypatch):
    """A named collision type the stats never mention (the live Fresno card's
    "head-on collisions from unsafe passing") is dropped like an invented figure."""
    text = "Los Angeles County recorded 52,310 crashes in 2011, many of them head-on."
    monkeypatch.setattr(gi, "generate_narrative", lambda prompt: text)
    assert _fresh_narrative("prompt", "Los Angeles (2011)", _CTX, 2011) is None


def test_stats_parts_states_deaths_per_1000_crashes():
    parts = _stats_parts(dict(total_crashes=10_546, total_killed=142), {})
    assert "deaths_per_1000_crashes=13.5" in parts


def test_stats_parts_feeds_both_prompt_and_gate():
    """Every figure the prompt supplies is a figure the gate accepts."""
    stats = dict(total_crashes=52_310, total_killed=294, yoy_change_pct=-3.0,
                 top_cause="unsafe_speed", top_cause_pct=31.2, peak_hour=17, dui_pct=6.4)
    parts = _stats_parts(stats, {"population": 9_800_000})
    assert "total_crashes=52310" in parts
    narrative = (
        "Los Angeles County recorded 52310 crashes in 2011, 294 of them fatal; "
        "unsafe speed accounted for 31.2% and collisions peaked at 17:00."
    )
    assert gi.check_fact(narrative, parts, 2011, 2026) == []
