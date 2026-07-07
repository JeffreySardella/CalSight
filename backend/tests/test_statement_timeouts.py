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
    """Source-level guard: the three intersections endpoints and
    stats_distribution each apply the timeout before querying."""
    import inspect

    from app.routers import intersections, stats

    for fn in (
        intersections.get_intersections,
        intersections.get_corridors,
        intersections.get_street_concentration,
        stats.stats_distribution,
    ):
        src = inspect.getsource(fn)
        assert "apply_statement_timeout(" in src, fn.__name__
