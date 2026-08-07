"""Heavy endpoints must bound their queries with SET LOCAL statement_timeout.

/api/intersections, /api/corridors, and /api/intersections/street-concentration
aggregate the full crashes table when called statewide; /api/stats/distribution
runs the full filter set against the raw table. Without a per-query timeout a
pathological combination holds a pool connection indefinitely and requests
pile up (same rationale as /ask and /crashes include_total).
"""

from types import SimpleNamespace

from app.database import apply_statement_timeout


def test_apply_statement_timeout_issues_set_local():
    calls = []
    db = SimpleNamespace(execute=lambda stmt, *a, **k: calls.append(str(stmt)))

    apply_statement_timeout(db, 30_000)

    assert len(calls) == 1
    assert "set local statement_timeout" in calls[0].lower()
    assert "30000" in calls[0]


def test_apply_statement_timeout_coerces_ms_to_int():
    """A float (or string) budget must not produce invalid SQL."""
    calls = []
    db = SimpleNamespace(execute=lambda stmt, *a, **k: calls.append(str(stmt)))

    apply_statement_timeout(db, 1500.9)

    assert "1500" in calls[0]


def test_heavy_endpoints_call_the_timeout(monkeypatch):
    """Source-level guard: every endpoint that aggregates the raw crashes
    table statewide applies the timeout before querying.

    `_apply_scan_timeout(...)` counts: it is the intersections router's tiered
    wrapper (tighter bound for county-scoped queries, more headroom for the
    unbounded statewide scan) and it calls apply_statement_timeout itself.
    """
    import inspect

    from app.routers import changes, clusters, intersections, stats

    setters = ("apply_statement_timeout(", "_apply_scan_timeout(")

    for fn in (
        intersections.get_intersections,
        intersections.get_corridors,
        intersections.get_street_concentration,
        stats.stats_distribution,
        stats.stats_highways,
        clusters.crash_clusters,
        changes.get_yoy_changes,
    ):
        src = inspect.getsource(fn)
        assert any(s in src for s in setters), fn.__name__


def test_scan_timeout_wrapper_actually_sets_the_timeout():
    """Guard the indirection above: the wrapper must really set a timeout,
    so the source-level check can't be satisfied by a no-op helper."""
    calls = []
    db = SimpleNamespace(execute=lambda stmt, *a, **k: calls.append(str(stmt)))

    from app.routers.intersections import _apply_scan_timeout

    applied = _apply_scan_timeout(db, None)

    assert len(calls) == 1
    assert "set local statement_timeout" in calls[0].lower()
    assert str(applied) in calls[0]
