"""The provider defaults must not point at retired models, and gpt-oss must
run at low reasoning effort or the 200-token narrative budget returns empty.

Summer 2026: Groq/Cerebras/OpenRouter all retired the Llama 3.x defaults;
Ask AI silently fell through to Gemini and the ETL narrative jobs failed for
four weeks before anyone noticed.
"""

from unittest.mock import MagicMock, patch

from app import llm

RETIRED = {
    "llama-3.3-70b-versatile",           # Groq, shut down 2026-08-16
    "llama3.1-8b",                        # Cerebras, retired 2026-05-27
    "meta-llama/llama-3.3-70b-instruct:free",  # OpenRouter, paid-only now
    "qwen/qwen3-next-80b-a3b-instruct:free",
    "openai/gpt-oss-120b:free",
}


def test_no_default_points_at_a_retired_model():
    configured = {d["model"] for d in llm._PROVIDER_DEFAULTS.values()}
    configured |= {m for _, m in llm.OPENROUTER_FREE_MODELS}
    assert not (configured & RETIRED)


def test_gpt_oss_gets_low_reasoning_effort_everywhere_else_untouched():
    assert llm._model_kwargs("openai/gpt-oss-120b") == {"reasoning_effort": "low"}
    assert llm._model_kwargs("gpt-oss-120b") == {"reasoning_effort": "low"}
    assert llm._model_kwargs("gemini-3.5-flash-lite") == {}
    assert llm._model_kwargs("nvidia/nemotron-3-super-120b-a12b:free") == {}


def test_call_provider_passes_reasoning_effort_for_gpt_oss():
    provider = {"name": "x", "type": "groq", "base_url": "https://example",
                "model": "openai/gpt-oss-120b", "api_key": "k"}
    with patch.object(llm, "OpenAI") as client_cls:
        client = MagicMock()
        client_cls.return_value = client
        llm._call_provider(provider, [{"role": "user", "content": "hi"}])
    kwargs = client.chat.completions.create.call_args.kwargs
    assert kwargs["reasoning_effort"] == "low"
    assert kwargs["model"] == "openai/gpt-oss-120b"
