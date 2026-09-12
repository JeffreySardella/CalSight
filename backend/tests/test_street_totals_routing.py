"""The statewide (no-county, no year/involvement filter) street reads must go
to mv_street_totals when it is populated — that is the whole point of the
view (migration 77b8d6739669). Pure unit tests: a recording fake session,
compiled SQL inspected for which relation it reads.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy.dialects import postgresql

from app.routers import intersections as mod


def _recording_db():
    """A fake Session that records every statement and returns empty results."""
    db = MagicMock()
    db.execute.return_value.all.return_value = []
    db.execute.return_value.one.return_value = SimpleNamespace(
        total_units=0, total_severe=0, total_crashes=0,
        **{f"top{p}_{k}": 0 for _l, p in mod._CONCENTRATION_POINTS for k in ("severe", "units")},
    )
    return db


def _sql(db) -> str:
    stmt = db.execute.call_args[0][0]
    return str(stmt.compile(dialect=postgresql.dialect()))


@pytest.fixture(autouse=True)
def _cold_caches():
    mod.clear_aggregate_cache()
    mod.clear_concentration_cache()
    mod.reset_mv_populated_cache()
    yield
    mod.clear_aggregate_cache()
    mod.clear_concentration_cache()
    mod.reset_mv_populated_cache()


def _aggregate_sql(populated: bool, **overrides) -> str:
    kwargs = dict(
        by_secondary=True, county_code=None, year_start=None, year_end=None,
        min_crashes=2, limit=25, pedestrian=None, cyclist=None, sort="count",
    )
    kwargs.update(overrides)
    db = _recording_db()
    with patch.object(mod, "_mv_populated", return_value=populated):
        mod._cached_aggregate(db, **kwargs)
    return _sql(db)


def test_statewide_intersections_read_the_totals_view():
    sql = _aggregate_sql(True, by_secondary=True)
    assert "mv_street_totals" in sql
    assert "FROM crashes" not in sql and "mv_street_aggregates" not in sql
    assert "GROUP BY" not in sql, "the coarse grain is pre-folded; no re-aggregation"


def test_statewide_corridors_read_the_totals_view():
    sql = _aggregate_sql(True, by_secondary=False)
    assert "mv_street_totals" in sql
    assert "GROUP BY" not in sql


def test_severity_sort_orders_by_the_stored_score():
    sql = _aggregate_sql(True, sort="severity")
    assert "mv_street_totals.severity_score DESC" in sql


@pytest.mark.parametrize(
    "overrides",
    [{"year_start": 2020}, {"year_end": 2020}, {"pedestrian": True}, {"cyclist": False}],
)
def test_filters_the_coarse_grain_cannot_answer_use_the_fine_view(overrides):
    sql = _aggregate_sql(True, **overrides)
    assert "mv_street_aggregates" in sql
    assert "mv_street_totals" not in sql


def test_county_scoped_default_state_reads_the_totals_view():
    sql = _aggregate_sql(True, county_code=19)
    assert "mv_street_totals" in sql


def test_unpopulated_totals_fall_back():
    sql = _aggregate_sql(False)
    assert "FROM crashes" in sql


def _concentration_sql(populated: bool, **overrides) -> str:
    kwargs = dict(by_secondary=False, county_code=None, county_name=None,
                  year_start=None, year_end=None)
    kwargs.update(overrides)
    db = _recording_db()
    with patch.object(mod, "_mv_populated", return_value=populated):
        mod._concentration(db, **kwargs)
    return _sql(db)


def test_statewide_concentration_reads_the_totals_view():
    sql = _concentration_sql(True)
    assert "mv_street_totals" in sql
    assert "FROM crashes" not in sql


def test_statewide_intersection_concentration_reads_the_totals_view():
    sql = _concentration_sql(True, by_secondary=True)
    assert "mv_street_totals" in sql
    assert "secondary_road !=" in sql


def test_year_bounded_concentration_stays_live():
    sql = _concentration_sql(True, year_start=2020)
    assert "FROM crashes" in sql
    assert "mv_street_totals" not in sql


def test_unpopulated_concentration_stays_live():
    sql = _concentration_sql(False)
    assert "FROM crashes" in sql
