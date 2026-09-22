"""Why Ask AI kept answering on the third-choice model (phone audit, 2026-09-22).

Production logs for "Is it getting more dangerous to walk in Los Angeles?"
showed the same chain on every try:

1. Groq 400 ``tool_use_failed`` (the model wrote ``"severity": null``), and the
   provider was cooled for 60 s, so every other visitor lost Groq too.
2. Gemini answered round 0, then 400'd on round 1: "Function call is missing a
   thought_signature" — the replayed tool call had dropped it.
3. Nemotron (OpenRouter free) was left to answer.

The OpenAI client is faked; no provider is called.
"""

from __future__ import annotations

import json
import time
from types import SimpleNamespace

import httpx
import pytest
from openai import BadRequestError
from openai.types.chat import ChatCompletion
from openai.types.chat.chat_completion_chunk import ChoiceDeltaToolCall

from app import llm
from app.routers import ask as ask_module
from app.routers.ask import _run_with_tools

SIG = {"google": {"thought_signature": "c2lnbmF0dXJl"}}


def _provider(name: str, ptype: str) -> dict[str, str]:
    return {"name": name, "type": ptype, "base_url": "http://x/v1", "model": "m", "api_key": "k"}


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    llm._provider_cooldowns.clear()
    llm._provider_failures.clear()
    monkeypatch.setattr(llm.settings, "llm_daily_request_budget", 0)
    yield
    llm._provider_cooldowns.clear()
    llm._provider_failures.clear()


def _bad_request(code: str) -> BadRequestError:
    resp = httpx.Response(
        400,
        request=httpx.Request("POST", "http://x/v1/chat/completions"),
        json={"error": {"message": "nope", "type": "invalid_request_error", "code": code}},
    )
    return BadRequestError("nope", response=resp, body={"message": "nope", "code": code})


def test_tool_use_failed_does_not_bench_the_provider(monkeypatch):
    monkeypatch.setattr(llm, "_get_provider_chain", lambda: [_provider("Groq", "groq")])

    def boom(**kwargs):
        raise _bad_request("tool_use_failed")

    monkeypatch.setattr(llm, "_call_provider", boom)
    with pytest.raises(llm.AllProvidersExhausted):
        llm.generate_with_fallback([{"role": "user", "content": "hi"}])
    # The next request still gets the primary.
    assert llm._is_available("Groq")


def test_other_bad_requests_still_cool_the_provider(monkeypatch):
    monkeypatch.setattr(llm, "_get_provider_chain", lambda: [_provider("Groq", "groq")])

    def boom(**kwargs):
        raise _bad_request("model_not_found")

    monkeypatch.setattr(llm, "_call_provider", boom)
    with pytest.raises(llm.AllProvidersExhausted):
        llm.generate_with_fallback([{"role": "user", "content": "hi"}])
    assert not llm._is_available("Groq")


def _call(extra: dict | None = None, call_id: str = "c1") -> dict:
    c = {"id": call_id, "type": "function", "function": {"name": "f", "arguments": "{}"}}
    if extra:
        c["extra_content"] = extra
    return c


def test_messages_for_gemini_keeps_signature_and_fills_a_missing_one():
    signed = {"role": "assistant", "content": "", "tool_calls": [_call(SIG)]}
    unsigned = {"role": "assistant", "content": "", "tool_calls": [_call(), _call(call_id="c2")]}
    out = llm._messages_for("gemini", [{"role": "user", "content": "q"}, signed, unsigned])
    assert out[1]["tool_calls"][0]["extra_content"] == SIG
    # A call another provider made: the documented dummy on the first call only.
    assert out[2]["tool_calls"][0]["extra_content"] == llm._GEMINI_SKIP_SIGNATURE
    assert "extra_content" not in out[2]["tool_calls"][1]
    # The ask loop's own conversation is never mutated.
    assert "extra_content" not in unsigned["tool_calls"][0]


def test_messages_for_other_providers_strips_the_gemini_field():
    signed = {"role": "assistant", "content": "", "tool_calls": [_call(SIG)]}
    out = llm._messages_for("groq", [signed])
    assert "extra_content" not in out[0]["tool_calls"][0]
    assert signed["tool_calls"][0]["extra_content"] == SIG


def test_consume_stream_keeps_the_signature():
    delta = ChoiceDeltaToolCall.model_validate(
        {"index": 0, "id": "c1", "function": {"name": "f", "arguments": "{}"}, "extra_content": SIG}
    )
    chunk = SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=None, tool_calls=[delta]))])
    gen = llm.consume_stream([chunk])
    try:
        while True:
            next(gen)
    except StopIteration as stop:
        message = stop.value
    assert message.tool_calls[0].extra_content == SIG


def test_gemini_signature_survives_the_tool_loop(monkeypatch):
    """Round 0 on Gemini returns a signed call; round 1 must send it back."""
    monkeypatch.setattr(llm, "_get_provider_chain", lambda: [_provider("Gemini", "gemini")])
    monkeypatch.setitem(ask_module.TOOL_REGISTRY, "f", lambda db, **kw: {"value": 12345})
    sent: list[list[dict]] = []

    def completion(message: dict) -> ChatCompletion:
        return ChatCompletion.model_validate({
            "id": "x", "object": "chat.completion", "created": 0, "model": "m",
            "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", **message}}],
        })

    replies = [
        completion({"content": None, "tool_calls": [_call(SIG)]}),
        completion({"content": "Answer: 12,345."}),
    ]

    class FakeClient:
        def __init__(self, **kwargs):
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

        def create(self, **kwargs):
            sent.append(json.loads(json.dumps(kwargs["messages"])))
            return replies.pop(0)

    monkeypatch.setattr(llm, "OpenAI", FakeClient)
    answer, provider = _run_with_tools(
        SimpleNamespace(), [{"role": "user", "content": "q"}], [], [], time.monotonic() + 30
    )
    assert answer == "Answer: 12,345."
    assert provider == "Gemini"
    replayed = [m for m in sent[1] if m.get("tool_calls")]
    assert replayed[0]["tool_calls"][0]["extra_content"] == SIG
