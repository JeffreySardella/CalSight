from types import SimpleNamespace

from app.routers.ask import _apply_statement_timeout, _STATEMENT_TIMEOUT_MS


def test_apply_statement_timeout_issues_set_local():
    """The /ask session must bound each query so a runaway aggregation can't
    hold a pool connection past the 60s request deadline."""
    calls = []
    db = SimpleNamespace(execute=lambda stmt, *a, **k: calls.append(str(stmt)))

    _apply_statement_timeout(db)

    assert len(calls) == 1
    assert "statement_timeout" in calls[0].lower()
    assert str(_STATEMENT_TIMEOUT_MS) in calls[0]


def test_statement_timeout_is_below_the_request_deadline():
    from app.routers.ask import _ASK_TIMEOUT_SECONDS
    assert _STATEMENT_TIMEOUT_MS < _ASK_TIMEOUT_SECONDS * 1000
