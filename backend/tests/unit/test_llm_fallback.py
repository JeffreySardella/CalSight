"""Tests for multi-provider LLM rotation."""

from unittest.mock import patch, MagicMock
import pytest
from openai import RateLimitError


def test_generate_with_fallback_uses_primary_first():
    from app.llm import generate_with_fallback

    with patch("app.llm._call_provider") as mock_call:
        mock_resp = MagicMock()
        mock_resp.choices = [MagicMock()]
        mock_resp.choices[0].message.content = "test response"
        mock_call.return_value = mock_resp
        response, provider = generate_with_fallback(
            messages=[{"role": "user", "content": "test"}]
        )
        assert provider
        assert mock_call.call_count == 1


def test_generate_with_fallback_rotates_on_rate_limit():
    from app.llm import generate_with_fallback

    call_count = {"n": 0}

    def side_effect(*args, **kwargs):
        call_count["n"] += 1
        if call_count["n"] == 1:
            mock_resp = MagicMock()
            mock_resp.status_code = 429
            mock_resp.headers = {}
            raise RateLimitError(
                message="rate limited",
                response=mock_resp,
                body={"error": {"message": "rate limited"}},
            )
        mock_resp = MagicMock()
        mock_resp.choices = [MagicMock()]
        mock_resp.choices[0].message.content = "fallback response"
        return mock_resp

    with patch("app.llm._call_provider", side_effect=side_effect):
        response, provider = generate_with_fallback(
            messages=[{"role": "user", "content": "test"}]
        )
        assert call_count["n"] == 2


def test_generate_with_fallback_raises_when_all_fail():
    from app.llm import generate_with_fallback, AllProvidersExhausted

    mock_resp = MagicMock()
    mock_resp.status_code = 429
    mock_resp.headers = {}

    with patch("app.llm._call_provider") as mock_call:
        mock_call.side_effect = RateLimitError(
            message="rate limited",
            response=mock_resp,
            body={"error": {"message": "rate limited"}},
        )
        with pytest.raises(AllProvidersExhausted):
            generate_with_fallback(
                messages=[{"role": "user", "content": "test"}]
            )


# ── generate_narrative (ETL path) must ride the same chain ───────────────
#
# Groq retired llama-3.3-70b on 2026-08-16: Ask AI fell through to Gemini,
# but the primary-only narrative path failed for four weeks. These pin the
# ETL path to the shared provider loop.


@pytest.fixture
def _fresh_chain_state():
    import app.llm as llm_module
    from app import llm_budget

    llm_budget.reset()
    llm_module._provider_cooldowns.clear()
    llm_module._provider_failures.clear()
    yield
    llm_budget.reset()
    llm_module._provider_cooldowns.clear()
    llm_module._provider_failures.clear()


def _narrative_response(text):
    resp = MagicMock()
    resp.choices = [MagicMock()]
    resp.choices[0].message.content = text
    return resp


def _rate_limit():
    resp = MagicMock()
    resp.status_code = 429
    resp.headers = {}
    return RateLimitError(message="rate limited", response=resp, body=None)


def test_generate_narrative_falls_back_when_primary_fails(_fresh_chain_state):
    from app.llm import generate_narrative

    def side_effect(*args, **kwargs):
        if mock_call.call_count == 1:
            raise _rate_limit()
        return _narrative_response("  Fresno saw 1,200 crashes in 2019, up 4% on 2018.  ")

    with patch("app.llm._call_provider", side_effect=side_effect) as mock_call:
        out = generate_narrative("Write a narrative")

    assert out == "Fresno saw 1,200 crashes in 2019, up 4% on 2018."
    assert mock_call.call_count == 2
    kwargs = mock_call.call_args.kwargs
    assert kwargs["max_tokens"] == 200
    assert kwargs["messages"] == [{"role": "user", "content": "Write a narrative"}]


def test_generate_narrative_raises_when_all_fail(_fresh_chain_state):
    from app.llm import AllProvidersExhausted, generate_narrative

    with patch("app.llm._call_provider", side_effect=_rate_limit()):
        with pytest.raises(AllProvidersExhausted):
            generate_narrative("Write a narrative")


def test_generate_narrative_rotates_primary_key(_fresh_chain_state, monkeypatch):
    import app.llm as llm_module
    from app.llm import generate_narrative

    monkeypatch.setattr(llm_module.settings, "llm_api_key", "key-one")
    monkeypatch.setattr(llm_module.settings, "llm_api_key_2", "key-two")

    with patch("app.llm._call_provider", return_value=_narrative_response("x" * 60)) as mock_call:
        generate_narrative("a")
        generate_narrative("b")

    keys = [c.kwargs["provider"]["api_key"] for c in mock_call.call_args_list]
    assert sorted(keys) == ["key-one", "key-two"]


def test_generate_narrative_does_not_spend_ask_budget(_fresh_chain_state, monkeypatch):
    """ETL narratives never counted against LLM_DAILY_REQUEST_BUDGET before;
    routing through the chain must not start spending it (a full all-years
    backfill is ~1,450 calls)."""
    import app.llm as llm_module
    from app import llm_budget
    from app.llm import generate_narrative

    monkeypatch.setattr(llm_module.settings, "llm_daily_request_budget", 1)

    with patch("app.llm._call_provider", return_value=_narrative_response("x" * 60)):
        generate_narrative("a")
        generate_narrative("b")

    assert llm_budget.used_today() == 0
