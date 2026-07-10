"""M12 — generate_insights must build cards from complete years only.

The >= 50-crash gate alone let the partial current calendar year win the
"latest year" query (any real county clears 50 crashes by February), which
made yoy_change_pct divide a partial year by a full prior year (~-50% for
every county in July) and defeated the skip-if-unchanged guard (current-year
counts churn daily → 58 LLM calls/day). The year queries now exclude the
current calendar year exactly like generate_llm_cards' "latest" mode.
"""

from etl.generate_insights import (
    _EXCLUDE_CURRENT_YEAR_SQL,
    _all_years,
    _latest_year,
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
