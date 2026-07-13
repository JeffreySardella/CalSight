"""LLM provider cooldown must distinguish transient API errors from our own
code bugs. A genuine programming error (e.g. a TypeError in our request-building
code) must NOT put a healthy provider on cooldown — it should surface so the bug
gets fixed. A real APIConnectionError SHOULD cool the provider. See audit L5.
"""

import httpx
import pytest
from openai import APIConnectionError

from app import llm


def _single_provider_chain():
    # A free provider type so the daily-budget backstop never skips it.
    return [{
        "name": "test-provider",
        "type": "ollama",
        "base_url": "http://localhost:0/v1",
        "model": "test-model",
        "api_key": "test-key",
    }]


@pytest.fixture(autouse=True)
def _reset_cooldowns(monkeypatch):
    monkeypatch.setattr(llm, "_get_provider_chain", _single_provider_chain)
    llm._provider_cooldowns.clear()
    llm._provider_failures.clear()
    yield
    llm._provider_cooldowns.clear()
    llm._provider_failures.clear()


def test_programming_error_does_not_cool_provider(monkeypatch):
    def boom(**kwargs):
        raise TypeError("bug in our own request-building code")

    monkeypatch.setattr(llm, "_call_provider", boom)

    # The bug should surface (re-raised), not be swallowed into
    # AllProvidersExhausted.
    with pytest.raises(TypeError):
        llm.generate_with_fallback([{"role": "user", "content": "hi"}])

    # The healthy provider must NOT have been benched.
    assert "test-provider" not in llm._provider_cooldowns
    assert llm._is_available("test-provider")


def test_api_connection_error_cools_provider(monkeypatch):
    def boom(**kwargs):
        raise APIConnectionError(request=httpx.Request("POST", "http://localhost:0/v1"))

    monkeypatch.setattr(llm, "_call_provider", boom)

    # A real transient error exhausts the (single-provider) chain.
    with pytest.raises(llm.AllProvidersExhausted):
        llm.generate_with_fallback([{"role": "user", "content": "hi"}])

    # And the provider IS cooled down.
    assert "test-provider" in llm._provider_cooldowns
    assert not llm._is_available("test-provider")
