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
    _all_years,
    _build_update_dict,
    _fresh_narrative,
    _latest_year,
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


# ── write-time junk guard ────────────────────────────────────────────────
#
# A junk reply from the model must not overwrite a good stored narrative:
# _fresh_narrative returns None, and _build_update_dict omits the column.

_STATS = dict(total_crashes=1, total_killed=0, total_injured=0, crash_rate_per_capita=0.0,
              top_cause="dui", top_cause_pct=0.0, yoy_change_pct=None, peak_hour=0, dui_pct=0.0)


@pytest.mark.parametrize("reply", ["Here is a 2-3 sentence summary", "", "**Los Angeles County**"])
def test_junk_reply_keeps_stored_narrative(monkeypatch, reply):
    monkeypatch.setattr(gi, "generate_narrative", lambda prompt: reply)
    narrative = _fresh_narrative("prompt", "Los Angeles (2025)")
    assert narrative is None
    assert "narrative" not in _build_update_dict(_STATS, narrative, None)


def test_real_reply_is_written(monkeypatch):
    monkeypatch.setattr(gi, "generate_narrative", lambda prompt: _REAL)
    narrative = _fresh_narrative("prompt", "Los Angeles (2025)")
    assert narrative == _REAL
    assert _build_update_dict(_STATS, narrative, None)["narrative"] == _REAL
