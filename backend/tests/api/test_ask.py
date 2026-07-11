"""Integration tests for /api/ask — focused on the caching + Quick Facts
features added in #278.

The LLM is mocked at the `app.routers.ask.generate_with_fallback` import site
so these tests don't hit a real provider.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.llm_cache import get_ask_cache

pytestmark = pytest.mark.integration


def _fake_llm_response(content: str = "Mocked answer.\n\nSuggested: [\"q1\", \"q2\"]"):
    """Build the minimum-viable shape the ask handler expects from
    `generate_with_fallback` — a tuple of (response, provider_name)."""
    return (
        SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(content=content, tool_calls=None)
                )
            ]
        ),
        "TestProvider",
    )


@pytest.fixture(autouse=True)
def _clear_ask_cache():
    """Make every test start from an empty cache so order doesn't matter."""
    get_ask_cache().clear()
    yield
    get_ask_cache().clear()


@pytest.fixture(autouse=True)
def _disable_ask_rate_limit():
    """The /api/ask limit is 10/minute, but the cache tests need to send
    many requests back-to-back to verify HIT/MISS behavior. Disabling the
    limiter for these tests doesn't affect prod — the limiter object lives
    on the router module."""
    from app.routers.ask import limiter
    original = limiter.enabled
    limiter.enabled = False
    yield
    limiter.enabled = original


@pytest.fixture
def fake_llm(monkeypatch):
    """Patches `generate_with_fallback` to a counter we can assert against.

    Round 0 (tool_choice="required") returns a query_crashes tool call so the
    handler records a successful tool execution — answers with zero successful
    tools are treated as degraded and are deliberately NOT cached, so a
    text-only fake would make every cache-HIT assertion fail by design.
    Later rounds return the plain text answer."""
    calls: list[dict] = []

    def fake(messages, **kwargs):
        calls.append({"messages": messages, "kwargs": kwargs})
        if kwargs.get("tool_choice") == "required":
            return (
                SimpleNamespace(
                    choices=[
                        SimpleNamespace(
                            message=SimpleNamespace(
                                content="",
                                tool_calls=[
                                    SimpleNamespace(
                                        id="call_1",
                                        function=SimpleNamespace(
                                            name="query_crashes", arguments="{}"
                                        ),
                                    )
                                ],
                            )
                        )
                    ]
                ),
                "TestProvider",
            )
        return _fake_llm_response()

    monkeypatch.setattr("app.routers.ask.generate_with_fallback", fake)
    return calls


# ── X-Cache header round trip ──────────────────────────────────────────


def test_first_request_is_a_miss(client, fake_llm):
    r = client.post("/api/ask", json={"question": "hi", "filters": {}, "history": []})
    assert r.status_code == 200
    assert r.headers.get("x-cache") == "MISS"
    assert len(fake_llm) >= 1


def test_identical_request_hits_cache(client, fake_llm):
    body = {"question": "hi", "filters": {"county": "los-angeles"}, "history": []}
    r1 = client.post("/api/ask", json=body)
    assert r1.headers.get("x-cache") == "MISS"
    miss_calls = len(fake_llm)

    r2 = client.post("/api/ask", json=body)
    assert r2.headers.get("x-cache") == "HIT"
    # The hit must not have triggered another LLM call.
    assert len(fake_llm) == miss_calls
    # And the cached answer must match the original.
    assert r1.json()["answer"] == r2.json()["answer"]


def test_different_question_misses_cache(client, fake_llm):
    client.post("/api/ask", json={"question": "Q1", "filters": {}, "history": []})
    r2 = client.post("/api/ask", json={"question": "Q2", "filters": {}, "history": []})
    assert r2.headers.get("x-cache") == "MISS"


def test_different_filters_miss_cache(client, fake_llm):
    client.post("/api/ask", json={"question": "Q", "filters": {"county": "los-angeles"}, "history": []})
    r2 = client.post("/api/ask", json={"question": "Q", "filters": {"county": "orange"}, "history": []})
    assert r2.headers.get("x-cache") == "MISS"


def test_filter_dict_ordering_does_not_affect_cache(client, fake_llm):
    """Stable key serialization should treat key ordering as equivalent."""
    client.post(
        "/api/ask",
        json={"question": "Q", "filters": {"county": "la", "year": "2023"}, "history": []},
    )
    r2 = client.post(
        "/api/ask",
        json={"question": "Q", "filters": {"year": "2023", "county": "la"}, "history": []},
    )
    assert r2.headers.get("x-cache") == "HIT"


def test_history_is_part_of_cache_key(client, fake_llm):
    """A follow-up like 'what about that?' depends on prior turns. Two users
    with different histories must not collide."""
    a_history = [{"role": "user", "content": "tell me about LA"}]
    b_history = [{"role": "user", "content": "tell me about SF"}]
    client.post("/api/ask", json={"question": "what about that?", "filters": {}, "history": a_history})
    r2 = client.post("/api/ask", json={"question": "what about that?", "filters": {}, "history": b_history})
    assert r2.headers.get("x-cache") == "MISS"


# ── Quick Facts injection into system prompt ────────────────────────────


def test_quick_facts_appears_in_system_prompt_for_known_filter(client, fake_llm):
    """When filters resolve to crashes in the seed (LA in 2023, 1 row), the
    system message should contain a Quick Facts block with the count."""
    client.post(
        "/api/ask",
        json={
            "question": "how many crashes in LA?",
            "filters": {"county": "los-angeles", "year": "2023"},
            "history": [],
        },
    )
    # First message is the system prompt — assert Quick Facts block landed.
    system_msg = fake_llm[0]["messages"][0]
    assert system_msg["role"] == "system"
    content = system_msg["content"]
    assert "Quick facts" in content


def test_quick_facts_handles_zero_match_filters(client, fake_llm):
    """A filter that matches nothing should produce a 'no crashes' line, not
    fail the request. The seed has crashes only in 2014, 2015, 2022, 2023 —
    year=2001 is guaranteed empty."""
    r = client.post(
        "/api/ask",
        json={
            "question": "any crashes in 2001?",
            "filters": {"year": "2001"},
            "history": [],
        },
    )
    assert r.status_code == 200
    system_msg = fake_llm[0]["messages"][0]
    assert "no crashes match these filters" in system_msg["content"].lower()


# ── Feedback write path ─────────────────────────────────────────────────


def test_feedback_vote_persists(client, db_session):
    """POST /api/feedback is the API's only write; it must actually land.
    (In production this runs as the read-only role, which migration
    v0w1x2y3z4a5 grants the one INSERT it needs.)"""
    from app.models import ChatFeedback

    r = client.post(
        "/api/feedback",
        json={"question": "how many?", "answer": "42", "vote": "up"},
    )
    assert r.status_code == 200
    assert r.json() == {"ok": True}
    row = db_session.query(ChatFeedback).order_by(ChatFeedback.id.desc()).first()
    assert row is not None
    assert row.vote == "up"


def test_feedback_rejects_bad_vote(client):
    r = client.post(
        "/api/feedback",
        json={"question": "q", "answer": "a", "vote": "sideways"},
    )
    assert r.status_code == 422
