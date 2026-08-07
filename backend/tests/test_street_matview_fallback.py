"""The street endpoints must degrade to the live query, never to an error.

mv_street_aggregates is created WITH NO DATA and populated by the nightly
refresh, so between a deploy and that refresh it is unpopulated. The
endpoints have to notice and fall back — and a broken catalog probe must not
be able to take the endpoint down with it.
"""

from unittest.mock import MagicMock, patch

from app.routers import intersections as mod


def _db(populated: bool | None, *, raises: bool = False) -> MagicMock:
    db = MagicMock()
    if raises:
        db.execute.side_effect = RuntimeError("catalog unavailable")
    else:
        db.execute.return_value.scalar.return_value = populated
    return db


def setup_function():
    mod.reset_mv_populated_cache()


def teardown_function():
    mod.reset_mv_populated_cache()


def test_reports_populated_when_the_catalog_says_so():
    assert mod._mv_populated(_db(True)) is True


def test_reports_unpopulated_for_a_view_with_no_data():
    assert mod._mv_populated(_db(False)) is False


def test_missing_view_is_treated_as_unpopulated():
    """Before the migration runs there is no matching pg_class row at all."""
    assert mod._mv_populated(_db(None)) is False


def test_probe_failure_falls_back_instead_of_raising():
    assert mod._mv_populated(_db(None, raises=True)) is False


def test_probe_result_is_cached():
    db = _db(True)
    mod._mv_populated(db)
    mod._mv_populated(db)
    assert db.execute.call_count == 1, "the catalog probe should not run per request"


def test_cache_reset_forces_a_fresh_probe():
    db = _db(True)
    mod._mv_populated(db)
    mod.reset_mv_populated_cache()
    mod._mv_populated(db)
    assert db.execute.call_count == 2


def _run_cached_aggregate(populated: bool):
    """Drive _cached_aggregate and report which implementation it chose."""
    mod.clear_aggregate_cache()
    with (
        patch.object(mod, "_mv_populated", return_value=populated),
        patch.object(mod, "_aggregate_from_mv", return_value=["mv"]) as from_mv,
        patch.object(mod, "_aggregate", return_value=["raw"]) as from_raw,
    ):
        result = mod._cached_aggregate(
            MagicMock(), by_secondary=False, county_code=None, year_start=None,
            year_end=None, min_crashes=1, limit=25, pedestrian=None,
            cyclist=None, sort="count",
        )
    mod.clear_aggregate_cache()
    return result, from_mv, from_raw


def test_populated_view_serves_the_fast_path():
    result, from_mv, from_raw = _run_cached_aggregate(True)
    assert result == ["mv"]
    from_mv.assert_called_once()
    from_raw.assert_not_called()


def test_unpopulated_view_falls_back_to_the_live_query():
    result, from_mv, from_raw = _run_cached_aggregate(False)
    assert result == ["raw"]
    from_raw.assert_called_once()
    from_mv.assert_not_called()
