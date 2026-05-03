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
        mock_call.return_value = (mock_resp, "groq")
        response, provider = generate_with_fallback(
            messages=[{"role": "user", "content": "test"}]
        )
        assert provider == "groq"
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
        mock_resp2 = MagicMock()
        mock_resp2.choices = [MagicMock()]
        mock_resp2.choices[0].message.content = "fallback response"
        return (mock_resp2, kwargs.get("provider_name", "fallback"))

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
