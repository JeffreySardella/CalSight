"""A single matview refresh failure must not strand every later view.

The refresh loop used to fail fast: if view N raised, views N+1.. were left at
their old vintage while 1..N-1 were fresh — a large, silent cross-view
inconsistency. It now refreshes every view independently and raises an
aggregated error at the end, so a failure isolates to the offending view and
still fails the "matviews" etl_run.
"""

from unittest.mock import MagicMock, patch


import etl.refresh_materialized_views as R


def _run_with_failing_views(failing: set[str]):
    """Drive R.run() with a fake AUTOCOMMIT connection.

    Returns (refreshed_views, raised_error) — the refreshed list is captured
    even when run() raises its aggregated error at the end.
    """
    refreshed: list[str] = []

    def execute(clause, params=None):
        sql = str(clause)
        if sql.startswith("REFRESH MATERIALIZED VIEW"):
            view = sql.split()[-1]
            if view in failing:
                raise RuntimeError(f"boom refreshing {view}")
            refreshed.append(view)
            return MagicMock()
        # _has_data probe -> populated; COUNT(*) -> a number.
        result = MagicMock()
        result.scalar.return_value = 1 if "relispopulated" in sql else 100
        return result

    conn = MagicMock()
    conn.execute.side_effect = execute
    ctx = MagicMock()
    ctx.__enter__.return_value = conn
    engine = MagicMock()
    engine.connect.return_value.execution_options.return_value = ctx

    raised: Exception | None = None
    with patch.object(R, "engine", engine):
        try:
            R.run()
        except Exception as exc:  # noqa: BLE001 — inspected by the tests
            raised = exc
    return refreshed, raised


def test_all_views_refresh_when_none_fail():
    refreshed, raised = _run_with_failing_views(set())
    assert raised is None
    assert refreshed == list(R._VIEWS)


def test_one_failure_does_not_strand_later_views():
    target = R._VIEWS[0]
    refreshed, raised = _run_with_failing_views({target})

    assert isinstance(raised, RuntimeError)
    assert target in str(raised)
    assert target not in refreshed
    assert set(R._VIEWS[1:]).issubset(set(refreshed)), "later views were stranded"


def test_aggregated_error_names_all_failures():
    failing = {R._VIEWS[0], R._VIEWS[-1]}
    _refreshed, raised = _run_with_failing_views(failing)

    assert isinstance(raised, RuntimeError)
    assert R._VIEWS[0] in str(raised) and R._VIEWS[-1] in str(raised)
