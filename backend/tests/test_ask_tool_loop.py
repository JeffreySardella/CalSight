"""Tool-loop resilience for /api/ask (audit M13 + L6).

One failed tool query used to poison the whole ask transaction: no rollback,
so every later tool call died with PendingRollbackError; `tools_called` was
appended before execution so grounded=true even when every tool failed; and
the degraded answer was cached for an hour.

The DB session and the LLM are both faked — no live Postgres.
"""

from __future__ import annotations

import time
from types import SimpleNamespace

import pytest

from app.llm import AllProvidersExhausted
from app.routers import ask as ask_module
from app.routers.ask import (
    _STATEMENT_TIMEOUT_MS,
    AskRequest,
    _handle_ask_inner,
    _run_with_tools,
)


class FakeResult:
    def __init__(self, rows=None):
        self._rows = rows or []

    def fetchall(self):
        return self._rows

    def fetchone(self):
        return self._rows[0] if self._rows else None


class FakeDB:
    """Records statements + rollbacks; returns empty result sets."""

    def __init__(self):
        self.rollbacks = 0
        self.statements: list[str] = []

    def execute(self, stmt, *args, **kwargs):
        self.statements.append(str(stmt))
        return FakeResult()

    def rollback(self):
        self.rollbacks += 1


def _tool_call(name: str, call_id: str = "call_1", arguments: str = "{}"):
    return SimpleNamespace(
        id=call_id,
        function=SimpleNamespace(name=name, arguments=arguments),
    )


def _llm_response(content: str | None = None, tool_calls: list | None = None):
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content, tool_calls=tool_calls))]
    )


def _scripted_llm(monkeypatch, responses: list):
    """generate_with_fallback returning (or raising) each item in order."""
    remaining = list(responses)

    def fake(messages, **kwargs):
        item = remaining.pop(0)
        if isinstance(item, Exception):
            raise item
        return item, "TestProvider"

    monkeypatch.setattr(ask_module, "generate_with_fallback", fake)


def _deadline() -> float:
    return time.monotonic() + 60.0


# ── rollback + timeout re-application after a failed tool ───────────────


def test_failed_tool_rolls_back_and_reapplies_timeout(monkeypatch):
    """A raising tool must not leave the session in an aborted transaction:
    the loop rolls back and re-issues SET LOCAL statement_timeout so the next
    tool in the same round still runs bounded."""
    db = FakeDB()

    def boom(session, **kwargs):
        raise RuntimeError("query exploded")

    def ok(session, **kwargs):
        return {"crash_count": 7}

    monkeypatch.setitem(ask_module.TOOL_REGISTRY, "boom_tool", boom)
    monkeypatch.setitem(ask_module.TOOL_REGISTRY, "ok_tool", ok)
    _scripted_llm(monkeypatch, [
        _llm_response(tool_calls=[_tool_call("boom_tool", "c1"), _tool_call("ok_tool", "c2")]),
        _llm_response(content="final answer"),
    ])

    tools_called: list[str] = []
    tools_succeeded: list[str] = []
    answer, provider = _run_with_tools(
        db, [{"role": "user", "content": "q"}], tools_called, tools_succeeded, _deadline()
    )

    assert answer == "final answer"
    assert db.rollbacks == 1
    assert any("statement_timeout" in s.lower() for s in db.statements), (
        "SET LOCAL dies with the rolled-back transaction and must be re-applied"
    )
    assert tools_called == ["boom_tool", "ok_tool"]
    assert tools_succeeded == ["ok_tool"]


def test_successful_tools_track_into_succeeded(monkeypatch):
    db = FakeDB()
    monkeypatch.setitem(ask_module.TOOL_REGISTRY, "ok_tool", lambda session, **kw: {"n": 1})
    _scripted_llm(monkeypatch, [
        _llm_response(tool_calls=[_tool_call("ok_tool")]),
        _llm_response(content="answer"),
    ])

    tools_called: list[str] = []
    tools_succeeded: list[str] = []
    _run_with_tools(db, [], tools_called, tools_succeeded, _deadline())

    assert tools_called == ["ok_tool"]
    assert tools_succeeded == ["ok_tool"]
    assert db.rollbacks == 0


def test_unknown_tool_does_not_count_as_succeeded(monkeypatch):
    db = FakeDB()
    _scripted_llm(monkeypatch, [
        _llm_response(tool_calls=[_tool_call("no_such_tool")]),
        _llm_response(content="answer"),
    ])

    tools_called: list[str] = []
    tools_succeeded: list[str] = []
    _run_with_tools(db, [], tools_called, tools_succeeded, _deadline())

    assert tools_called == ["no_such_tool"]
    assert tools_succeeded == []


# ── grounded / cacheable semantics ──────────────────────────────────────


def _body(question: str = "how many crashes?") -> AskRequest:
    return AskRequest(question=question, filters={}, history=[])


def test_all_tools_failed_means_not_grounded_and_not_cacheable(monkeypatch):
    db = FakeDB()

    def boom(session, **kwargs):
        raise RuntimeError("nope")

    monkeypatch.setitem(ask_module.TOOL_REGISTRY, "boom_tool", boom)
    _scripted_llm(monkeypatch, [
        _llm_response(tool_calls=[_tool_call("boom_tool")]),
        _llm_response(content="I could not retrieve data."),
    ])

    result, cacheable = _handle_ask_inner(_body(), db, _deadline())

    assert result.tools_called == ["boom_tool"]
    assert result.grounded is False, "an answer whose every tool failed is not data-backed"
    assert cacheable is False


def test_successful_tool_means_grounded_and_cacheable(monkeypatch):
    db = FakeDB()
    monkeypatch.setitem(ask_module.TOOL_REGISTRY, "ok_tool", lambda session, **kw: {"n": 2})
    _scripted_llm(monkeypatch, [
        _llm_response(tool_calls=[_tool_call("ok_tool")]),
        _llm_response(content="grounded answer"),
    ])

    result, cacheable = _handle_ask_inner(_body(), db, _deadline())

    assert result.grounded is True
    assert cacheable is True
    assert result.answer == "grounded answer"


def test_simple_mode_fallback_is_degraded_and_not_cacheable(monkeypatch):
    """AllProvidersExhausted drops to simple mode; the answer may be served
    but must not be cached for an hour (audit L6)."""
    db = FakeDB()
    _scripted_llm(monkeypatch, [
        AllProvidersExhausted("all providers busy"),
        _llm_response(content="simple-mode answer"),
    ])

    result, cacheable = _handle_ask_inner(_body(), db, _deadline())

    assert result.answer == "simple-mode answer"
    assert result.grounded is False
    assert cacheable is False


def test_grounded_downgraded_when_answer_ignores_tool_numbers(monkeypatch):
    """Calling a tool is not citing it: an answer that shares no distinctive
    number with the tool results is downgraded to grounded=false (#293).

    We assert the observable pair (grounded=False, cacheable=True) rather than
    scraping the warning log line. That pair *is* the proof: a successful tool
    run sets cacheable=True and tool_grounded=True, and the ONLY code path that
    then flips grounded to False is the numeric-mismatch branch. Asserting on
    the log instead was brittle — caplog and even a directly-attached handler
    missed the record in CI when sibling DB-backed tests perturbed logging
    state — and redundant, since the behavior is fully pinned without it."""
    db = FakeDB()
    monkeypatch.setitem(
        ask_module.TOOL_REGISTRY, "ok_tool", lambda session, **kw: {"crash_count": 8234}
    )
    _scripted_llm(monkeypatch, [
        _llm_response(tool_calls=[_tool_call("ok_tool")]),
        _llm_response(content="Rain is associated with roughly 99,999 crashes."),
    ])

    result, cacheable = _handle_ask_inner(_body(), db, _deadline())

    # cacheable=True proves a tool succeeded (tool_grounded); grounded=False
    # then can only come from the numeric-mismatch downgrade.
    assert cacheable is True
    assert result.grounded is False, "answer cites none of the tool's distinctive numbers"


def test_grounded_kept_when_answer_cites_tool_numbers(monkeypatch):
    db = FakeDB()
    monkeypatch.setitem(
        ask_module.TOOL_REGISTRY, "ok_tool", lambda session, **kw: {"crash_count": 8234}
    )
    _scripted_llm(monkeypatch, [
        _llm_response(tool_calls=[_tool_call("ok_tool")]),
        _llm_response(content="There were 8,234 crashes in the rain."),
    ])

    result, cacheable = _handle_ask_inner(_body(), db, _deadline())

    assert result.grounded is True
    assert cacheable is True


def test_grounded_kept_when_tool_results_have_no_distinctive_numbers(monkeypatch):
    """Small ints and years never trigger a downgrade — nothing distinctive
    to cross-check, so the conservative default is to trust tool success."""
    db = FakeDB()
    monkeypatch.setitem(
        ask_module.TOOL_REGISTRY, "ok_tool", lambda session, **kw: {"n": 3, "year": 2023}
    )
    _scripted_llm(monkeypatch, [
        _llm_response(tool_calls=[_tool_call("ok_tool")]),
        _llm_response(content="Very few crashes matched."),
    ])

    result, cacheable = _handle_ask_inner(_body(), db, _deadline())

    assert result.grounded is True
    assert cacheable is True


def test_failed_tool_results_do_not_feed_grounding_check(monkeypatch):
    """Error payloads from failed tools carry no citable data; only the
    successful tool's numbers participate in the cross-check."""
    db = FakeDB()

    def boom(session, **kwargs):
        raise RuntimeError("query exploded")

    monkeypatch.setitem(ask_module.TOOL_REGISTRY, "boom_tool", boom)
    monkeypatch.setitem(
        ask_module.TOOL_REGISTRY, "ok_tool", lambda session, **kw: {"crash_count": 8234}
    )
    _scripted_llm(monkeypatch, [
        _llm_response(tool_calls=[_tool_call("boom_tool", "c1"), _tool_call("ok_tool", "c2")]),
        _llm_response(content="The database recorded 8,234 crashes."),
    ])

    result, _ = _handle_ask_inner(_body(), db, _deadline())

    assert result.grounded is True


def test_chart_numbers_keep_answer_grounded(monkeypatch):
    """The raw answer (chart block included) is what gets cross-checked."""
    db = FakeDB()
    monkeypatch.setitem(
        ask_module.TOOL_REGISTRY, "ok_tool", lambda session, **kw: {"rain": 8234}
    )
    answer = (
        "Rain sees far more crashes.\n---\n"
        'Chart: {"type": "bar", "title": "t", "xKey": "label", "yKey": "value", '
        '"data": [{"label": "Rain", "value": 8234}]}'
    )
    _scripted_llm(monkeypatch, [
        _llm_response(tool_calls=[_tool_call("ok_tool")]),
        _llm_response(content=answer),
    ])

    result, _ = _handle_ask_inner(_body(), db, _deadline())

    assert result.grounded is True
    assert result.chart is not None


# ── simple-mode fallback must itself fail gracefully (#293) ──────────────


def test_simple_mode_provider_exhaustion_returns_degraded_answer(monkeypatch):
    """When simple mode's own LLM call also exhausts every provider, the
    handler returns a graceful degraded response — not a 500 — and it is
    never cached."""
    db = FakeDB()
    _scripted_llm(monkeypatch, [
        AllProvidersExhausted("all providers busy"),  # tool loop
        AllProvidersExhausted("still busy"),  # simple mode
    ])

    result, cacheable = _handle_ask_inner(_body(), db, _deadline())

    assert "temporarily unavailable" in result.answer.lower()
    assert result.provider == "none"
    assert result.grounded is False
    assert cacheable is False, "the very next attempt may succeed — never cache this"


def test_simple_mode_db_error_returns_degraded_answer(monkeypatch):
    """A DB failure inside simple mode (query_crashes) must degrade the same
    way instead of escaping as a 500."""
    db = FakeDB()

    def db_boom(session, **kwargs):
        raise RuntimeError("db down")

    monkeypatch.setattr(ask_module, "query_crashes", db_boom)
    _scripted_llm(monkeypatch, [AllProvidersExhausted("all providers busy")])

    result, cacheable = _handle_ask_inner(_body(), db, _deadline())

    assert "temporarily unavailable" in result.answer.lower()
    assert result.provider == "none"
    assert result.grounded is False
    assert cacheable is False


# ── Quick Facts must not poison the session either ──────────────────────


def test_quick_facts_failure_rolls_back_and_restores_timeout():
    from app.ai_prompt import build_quick_facts

    class PoisonedDB(FakeDB):
        def execute(self, stmt, *args, **kwargs):
            if "statement_timeout" in str(stmt).lower():
                return super().execute(stmt, *args, **kwargs)
            raise RuntimeError("aborted transaction")

    db = PoisonedDB()
    out = build_quick_facts(db, {}, statement_timeout_ms=_STATEMENT_TIMEOUT_MS)

    assert out == ""
    assert db.rollbacks == 1
    assert any(str(_STATEMENT_TIMEOUT_MS) in s for s in db.statements)


def test_quick_facts_failure_without_timeout_arg_still_rolls_back():
    from app.ai_prompt import build_quick_facts

    class PoisonedDB(FakeDB):
        def execute(self, stmt, *args, **kwargs):
            raise RuntimeError("aborted transaction")

    db = PoisonedDB()
    out = build_quick_facts(db, {})

    assert out == ""
    assert db.rollbacks == 1


# ── endpoint: degraded answers skip the cache ───────────────────────────


@pytest.fixture()
def ask_client(monkeypatch):
    from fastapi.testclient import TestClient

    from app.llm_cache import get_ask_cache
    from app.main import app

    get_ask_cache().clear()
    monkeypatch.setattr(ask_module.limiter, "enabled", False)
    with TestClient(app) as client:
        yield client
    get_ask_cache().clear()


def _ask_response(answer: str) -> ask_module.AskResponse:
    return ask_module.AskResponse(answer=answer, provider="TestProvider")


def test_endpoint_caches_good_answers(ask_client, monkeypatch):
    monkeypatch.setattr(ask_module, "_handle_ask", lambda body: (_ask_response("good"), True))

    r1 = ask_client.post("/api/ask", json={"question": "cache me"})
    r2 = ask_client.post("/api/ask", json={"question": "cache me"})

    assert r1.headers["x-cache"] == "MISS"
    assert r2.headers["x-cache"] == "HIT"


def test_endpoint_skips_cache_for_degraded_answers(ask_client, monkeypatch):
    calls = {"n": 0}

    def degraded(body):
        calls["n"] += 1
        return _ask_response("degraded"), False

    monkeypatch.setattr(ask_module, "_handle_ask", degraded)

    r1 = ask_client.post("/api/ask", json={"question": "do not cache me"})
    r2 = ask_client.post("/api/ask", json={"question": "do not cache me"})

    assert r1.headers["x-cache"] == "MISS"
    assert r2.headers["x-cache"] == "MISS", "degraded answer must not be served from cache"
    assert calls["n"] == 2
