"""AI answer-correctness guards for ai_tools (audit M13).

Covers:
  * pct_of_total is the share of the FILTERED TOTAL (window SUM over all
    groups), not of the top-N rows that survive the LIMIT.
  * rank_counties / get_trend reject unknown metrics with an explicit error
    instead of silently substituting crash_count under the requested label.

No live Postgres: the session is faked at db.execute, the same style as the
other unit tests (SimpleNamespace / recorded statements).
"""

from types import SimpleNamespace

from app.ai_tools import _CRASH_METRICS, get_trend, query_crashes, rank_counties


class FakeRow(SimpleNamespace):
    """Duck-types a SQLAlchemy Row: attribute access + ._mapping."""

    @property
    def _mapping(self):
        return dict(self.__dict__)


class FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return self._rows

    def all(self):
        return self._rows


class FakeDB:
    """Records every statement; returns canned rows from execute()."""

    def __init__(self, rows=None):
        self.rows = rows or []
        self.statements = []

    def execute(self, stmt, *args, **kwargs):
        self.statements.append(stmt)
        return FakeResult(self.rows)


# ── query_crashes pct_of_total ──────────────────────────────────────────


def test_pct_of_total_uses_filtered_total_not_limited_rows():
    """Two returned rows carry 30 + 10 = 40 crashes, but the filtered total
    (grand_total, computed by the window SUM before the LIMIT) is 100.
    pct_of_total must read 30% / 10% — not 75% / 25%."""
    rows = [
        FakeRow(county_name="Los Angeles", crash_count=30, total_killed=3,
                total_injured=12, grand_total=100),
        FakeRow(county_name="Orange", crash_count=10, total_killed=0,
                total_injured=4, grand_total=100),
    ]
    db = FakeDB(rows)

    results = query_crashes(db, group_by="county_name", limit=2)

    assert results[0]["pct_of_total"] == 30.0
    assert results[1]["pct_of_total"] == 10.0
    # The window total is an implementation detail — never expose it to the
    # model (it would cite it as a row value).
    assert all("grand_total" not in r for r in results)


def test_pct_of_total_query_computes_total_with_window_sum():
    """The denominator must come from SQL (SUM(count) OVER ()), evaluated
    over every group before the LIMIT — not from summing returned rows."""
    db = FakeDB([])
    query_crashes(db, group_by="severity")

    grouped_sql = str(db.statements[-1])
    assert "OVER ()" in grouped_sql
    assert "grand_total" in grouped_sql


def test_grouped_rows_keep_fatality_rate():
    rows = [
        FakeRow(severity="Fatal", crash_count=50, total_killed=55,
                total_injured=10, grand_total=200),
    ]
    results = query_crashes(FakeDB(rows), group_by="severity")
    assert results[0]["fatality_rate_pct"] == 110.0
    assert results[0]["pct_of_total"] == 25.0


def test_grouped_zero_total_adds_no_pct():
    rows = [
        FakeRow(severity="Fatal", crash_count=0, total_killed=0,
                total_injured=0, grand_total=0),
    ]
    results = query_crashes(FakeDB(rows), group_by="severity")
    assert "pct_of_total" not in results[0]


# ── rank_counties metric validation ─────────────────────────────────────


def test_rank_counties_unknown_metric_returns_error():
    db = FakeDB()
    result = rank_counties(db, metric="hit_run_pct")
    assert result == [{"error": f"Unknown metric: hit_run_pct. Valid: {', '.join(_CRASH_METRICS)}."}]
    # It must not have run any query.
    assert db.statements == []


def test_rank_counties_valid_metric_still_works():
    rows = [FakeRow(county_name="Los Angeles", county_code=19, value=123)]
    result = rank_counties(FakeDB(rows), metric="fatal_crashes")
    assert result == [
        {"county_name": "Los Angeles", "county_code": 19,
         "metric": "fatal_crashes", "value": 123}
    ]


def test_rank_counties_accepts_the_advertised_total_crashes_alias():
    """TOOL_DEFINITIONS advertises 'total_crashes' for this tool; rejecting
    the enum the model is instructed to send would break every ranking ask."""
    rows = [FakeRow(county_name="Orange", county_code=30, value=10)]
    result = rank_counties(FakeDB(rows), metric="total_crashes")
    assert result[0]["value"] == 10


# ── get_trend metric validation ─────────────────────────────────────────


def test_get_trend_unknown_metric_returns_error():
    db = FakeDB()
    result = get_trend(db, metric="bogus")
    assert result == [{"error": f"Unknown metric: bogus. Valid: {', '.join(_CRASH_METRICS)}."}]
    assert db.statements == []


def test_get_trend_valid_metric_still_works():
    rows = [FakeRow(year=2022, value=5), FakeRow(year=2023, value=7)]
    result = get_trend(FakeDB(rows), metric="total_killed")
    assert result == [
        {"year": 2022, "metric": "total_killed", "value": 5},
        {"year": 2023, "metric": "total_killed", "value": 7},
    ]
