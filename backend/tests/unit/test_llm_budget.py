"""Tests for the per-worker daily LLM request budget (#293).

Covers the counter module as a pure unit and its chokepoint inside
`generate_with_fallback`: paid providers are skipped once the budget is
spent (raising AllProvidersExhausted so ask's simple-mode/degraded fallback
handles UX), free/local providers are exempt, and cache hits never touch
the counter (the counter only lives inside generate_with_fallback, which a
cache hit never reaches).
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

import app.llm as llm_module
from app import llm_budget
from app.llm import AllProvidersExhausted, generate_with_fallback


@pytest.fixture(autouse=True)
def _clean_llm_state():
    """Budget counter and provider cooldowns are process-global — isolate."""
    llm_budget.reset()
    llm_module._provider_cooldowns.clear()
    llm_module._provider_failures.clear()
    yield
    llm_budget.reset()
    llm_module._provider_cooldowns.clear()
    llm_module._provider_failures.clear()


# ── counter module ───────────────────────────────────────────────────────


def test_zero_budget_means_unlimited():
    for _ in range(50):
        assert llm_budget.try_consume(0) is True
    assert llm_budget.used_today() == 0  # unlimited mode counts nothing


def test_negative_budget_means_unlimited():
    assert llm_budget.try_consume(-1) is True


def test_budget_allows_n_then_denies():
    assert llm_budget.try_consume(2) is True
    assert llm_budget.try_consume(2) is True
    assert llm_budget.try_consume(2) is False
    assert llm_budget.try_consume(2) is False
    assert llm_budget.used_today() == 2


def test_counter_resets_on_new_day(monkeypatch):
    days = iter(["2026-07-10", "2026-07-10", "2026-07-11", "2026-07-11"])
    monkeypatch.setattr(llm_budget, "_today", lambda: next(days))
    assert llm_budget.try_consume(1) is True
    assert llm_budget.try_consume(1) is False  # day 1 spent
    assert llm_budget.try_consume(1) is True  # day 2: fresh budget
    assert llm_budget.used_today() == 1


def test_reset_clears_counter():
    llm_budget.try_consume(1)
    llm_budget.reset()
    assert llm_budget.used_today() == 0
    assert llm_budget.try_consume(1) is True


# ── generate_with_fallback chokepoint ────────────────────────────────────


def _mock_response():
    resp = MagicMock()
    resp.choices = [MagicMock()]
    resp.choices[0].message.content = "answer"
    return resp


def test_budget_spent_skips_paid_providers_and_raises(monkeypatch):
    monkeypatch.setattr(llm_module.settings, "llm_daily_request_budget", 1)

    with patch("app.llm._call_provider", return_value=_mock_response()) as mock_call:
        # First request consumes the budget.
        response, provider = generate_with_fallback(messages=[{"role": "user", "content": "q"}])
        assert provider
        assert mock_call.call_count == 1

        # Budget spent: every paid provider is skipped, nothing is called,
        # and the existing simple-mode fallback path gets its exception.
        with pytest.raises(AllProvidersExhausted, match="budget"):
            generate_with_fallback(messages=[{"role": "user", "content": "q"}])
        assert mock_call.call_count == 1, "budget exhaustion must not reach the provider"


def test_budget_counts_failed_provider_calls(monkeypatch):
    """The unit is actual provider calls — a call that raises still spends."""
    monkeypatch.setattr(llm_module.settings, "llm_daily_request_budget", 1)

    with patch("app.llm._call_provider", side_effect=RuntimeError("boom")) as mock_call:
        with pytest.raises(AllProvidersExhausted):
            generate_with_fallback(messages=[{"role": "user", "content": "q"}])
    assert mock_call.call_count == 1, "second chain entry must be budget-skipped"
    assert llm_budget.used_today() == 1


def test_unlimited_budget_never_blocks(monkeypatch):
    monkeypatch.setattr(llm_module.settings, "llm_daily_request_budget", 0)

    with patch("app.llm._call_provider", return_value=_mock_response()) as mock_call:
        for _ in range(5):
            generate_with_fallback(messages=[{"role": "user", "content": "q"}])
    assert mock_call.call_count == 5
    assert llm_budget.used_today() == 0


def test_ollama_is_exempt_from_budget(monkeypatch):
    monkeypatch.setattr(llm_module.settings, "llm_daily_request_budget", 1)
    monkeypatch.setattr(llm_module.settings, "llm_provider", "ollama")
    monkeypatch.setattr(llm_module.settings, "llm_model", "")
    monkeypatch.setattr(llm_module.settings, "llm_base_url", "")

    # Spend the whole budget first — local ollama must still be callable.
    assert llm_budget.try_consume(1) is True
    assert llm_budget.try_consume(1) is False

    with patch("app.llm._call_provider", return_value=_mock_response()) as mock_call:
        response, provider = generate_with_fallback(messages=[{"role": "user", "content": "q"}])
    assert mock_call.call_count == 1
    assert llm_budget.used_today() == 1, "free provider calls are never counted"
