"""SSE streaming for /api/ask/stream.

Everything is faked — no live Postgres and no provider calls. The three
behaviours pinned here are the ones that differ from the JSON endpoint:
a provider that dies *before* its first token must fall through to the next
one, a provider that dies *mid*-stream must surface as an SSE `error` event
(there is nobody left to fail over to once the client has partial text), and
the closing `done` event must carry the same metadata the JSON response does.
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import httpx
import pytest
from openai import APIConnectionError

from app import llm
from app.llm_cache import TTLLRUCache
from app.routers import ask as ask_module
from app.routers.ask import AskRequest, _stream_ask


def _chunk(content: str | None = None, tool_calls: list | None = None):
    return SimpleNamespace(
        choices=[SimpleNamespace(delta=SimpleNamespace(content=content, tool_calls=tool_calls))]
    )


def _tool_delta(index: int, call_id: str, name: str, arguments: str):
    return SimpleNamespace(
        index=index,
        id=call_id,
        function=SimpleNamespace(name=name, arguments=arguments),
    )


def _response(content: str | None = None, tool_calls: list | None = None):
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content, tool_calls=tool_calls))]
    )


def _call(name: str, call_id: str = "call_1", arguments: str = "{}"):
    return SimpleNamespace(id=call_id, function=SimpleNamespace(name=name, arguments=arguments))


def _events(frames: list[bytes]) -> list[tuple[str, dict]]:
    """Parse the SSE wire format back into (event, payload) pairs."""
    out = []
    for frame in frames:
        text = frame.decode()
        assert text.endswith("\n\n"), text
        lines = text.strip().split("\n")
        event = lines[0].removeprefix("event: ")
        data = json.loads(lines[1].removeprefix("data: "))
        out.append((event, data))
    return out


@pytest.fixture
def stream_env(monkeypatch):
    """Isolate _stream_ask from the DB, the answer cache and the tool registry."""
    monkeypatch.setattr(ask_module, "SessionLocal", lambda: SimpleNamespace(close=lambda: None))
    monkeypatch.setattr(ask_module, "_apply_statement_timeout", lambda db, ms=0: None)
    monkeypatch.setattr(ask_module, "build_quick_facts", lambda db, filters, **kw: "")
    monkeypatch.setattr(ask_module, "build_filters_summary", lambda filters: "none")
    monkeypatch.setattr(ask_module, "get_ask_cache", lambda: TTLLRUCache(max_size=8, ttl_seconds=60))
    monkeypatch.setattr(ask_module, "TOOL_REGISTRY", {"query_crashes": lambda db, **kw: {"total": 41234}})


def _scripted(monkeypatch, responses: list):
    """generate_with_fallback returning each scripted item in order.

    Streamed rounds get an iterator of chunks; non-streamed rounds get a
    completed response object, exactly like the real provider wrapper.
    """
    remaining = list(responses)

    def fake(messages, stream=False, **kwargs):
        item = remaining.pop(0)
        if isinstance(item, Exception):
            raise item
        return item, "TestProvider"

    monkeypatch.setattr(ask_module, "generate_with_fallback", fake)


# --- app.llm.consume_stream / first-token fallback -------------------------


def test_consume_stream_yields_deltas_and_assembles_tool_calls():
    chunks = [
        _chunk("Hel"),
        _chunk("lo"),
        _chunk(tool_calls=[_tool_delta(0, "call_1", "query_crashes", '{"coun')]),
        _chunk(tool_calls=[_tool_delta(0, "", "", 'ty": "Kern"}')]),
        _chunk(),
    ]
    gen = llm.consume_stream(iter(chunks))
    tokens = []
    try:
        while True:
            tokens.append(next(gen))
    except StopIteration as stop:
        message = stop.value

    assert tokens == ["Hel", "lo"]
    assert message.content == "Hello"
    assert len(message.tool_calls) == 1
    assert message.tool_calls[0].id == "call_1"
    assert message.tool_calls[0].function.name == "query_crashes"
    assert json.loads(message.tool_calls[0].function.arguments) == {"county": "Kern"}


def test_provider_failing_before_its_first_token_falls_through(monkeypatch):
    llm._provider_cooldowns.clear()
    llm._provider_failures.clear()
    chain = [
        {"name": "dead", "type": "ollama", "base_url": "", "model": "m", "api_key": "k"},
        {"name": "alive", "type": "ollama", "base_url": "", "model": "m", "api_key": "k"},
    ]

    def fake_call(**kwargs):
        assert kwargs["stream"] is True
        if kwargs["provider"]["name"] == "dead":
            def boom():
                raise APIConnectionError(request=httpx.Request("POST", "http://localhost:0/v1"))
                yield  # pragma: no cover - unreachable, makes this a generator
            return boom()
        return iter([_chunk("from the second provider")])

    monkeypatch.setattr(llm, "_call_provider", fake_call)

    chunks, name = llm._generate_over_chain(
        chain, [{"role": "user", "content": "hi"}], stream=True
    )

    assert name == "alive"
    assert list(llm.consume_stream(chunks)) == ["from the second provider"]
    llm._provider_cooldowns.clear()
    llm._provider_failures.clear()


# --- /api/ask/stream -------------------------------------------------------


def test_done_event_carries_the_same_metadata_as_the_json_endpoint(monkeypatch, stream_env):
    answer = (
        'Kern County saw 41234 crashes.\n\n'
        'Chart: {"type": "bar", "data": [{"label": "2023", "value": 41234}]}\n'
        'Suggested: ["And in 2024?"]'
    )
    _scripted(monkeypatch, [
        _response(tool_calls=[_call("query_crashes")]),          # round 0, not streamed
        iter([_chunk(part) for part in (answer[:20], answer[20:])]),  # round 1, streamed
    ])

    events = _events(list(_stream_ask(AskRequest(question="How many crashes in Kern?"))))

    tokens = [d["t"] for e, d in events if e == "token"]
    assert "".join(tokens) == answer
    assert [e for e, _ in events][-1] == "done"

    done = events[-1][1]
    assert done["provider"] == "TestProvider"
    assert done["answer"] == "Kern County saw 41234 crashes."
    assert done["chart"] == {"type": "bar", "data": [{"label": "2023", "value": 41234}]}
    assert done["suggestions"] == ["And in 2024?"]
    assert done["tools_called"] == ["query_crashes"]
    assert done["grounded"] is True


def test_mid_stream_provider_failure_emits_an_error_event(monkeypatch, stream_env):
    def dying_stream():
        yield _chunk("Kern County saw ")
        yield _chunk("41")
        raise APIConnectionError(request=httpx.Request("POST", "http://localhost:0/v1"))

    _scripted(monkeypatch, [
        _response(tool_calls=[_call("query_crashes")]),
        dying_stream(),
    ])

    events = _events(list(_stream_ask(AskRequest(question="How many crashes in Kern?"))))

    assert [e for e, _ in events] == ["token", "token", "error"]
    assert events[-1][1]["message"]


def test_all_providers_exhausted_still_ends_with_a_done_payload(monkeypatch, stream_env):
    from app.llm import AllProvidersExhausted

    _scripted(monkeypatch, [AllProvidersExhausted("no providers")])
    monkeypatch.setattr(
        ask_module, "_run_simple_mode", lambda db, filters, messages: (_ for _ in ()).throw(RuntimeError("down"))
    )

    events = _events(list(_stream_ask(AskRequest(question="How many crashes in Kern?"))))

    assert [e for e, _ in events] == ["done"]
    assert events[0][1]["provider"] == "none"
    assert "temporarily unavailable" in events[0][1]["answer"]


def test_route_is_post_and_sets_the_no_buffering_headers(monkeypatch):
    """POST (a Cloudflare rule caches API GETs) + the anti-buffering headers."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    monkeypatch.setattr(ask_module, "_stream_ask", lambda body: iter([_sse_frame()]))

    app = FastAPI()
    app.state.limiter = ask_module.limiter
    app.include_router(ask_module.router, prefix="/api")
    client = TestClient(app)

    assert client.get("/api/ask/stream").status_code == 405

    resp = client.post("/api/ask/stream", json={"question": "How many crashes in Kern?"})
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    assert resp.headers["cache-control"] == "no-cache"
    assert resp.headers["x-accel-buffering"] == "no"


def _sse_frame() -> bytes:
    return b'event: done\ndata: {}\n\n'


def test_a_cached_answer_streams_in_one_token_then_done(monkeypatch, stream_env):
    cache = TTLLRUCache(max_size=8, ttl_seconds=60)
    monkeypatch.setattr(ask_module, "get_ask_cache", lambda: cache)
    _scripted(monkeypatch, [
        _response(tool_calls=[_call("query_crashes")]),
        iter([_chunk("41234 crashes.")]),
    ])
    body = AskRequest(question="How many crashes in Kern?")

    first = _events(list(_stream_ask(body)))
    assert first[-1][1]["cached"] is False

    second = _events(list(_stream_ask(body)))
    assert [e for e, _ in second] == ["token", "done"]
    assert second[0][1]["t"] == "41234 crashes."
    assert second[1][1]["cached"] is True
