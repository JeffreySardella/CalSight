"""Provider-agnostic LLM wrapper with multi-provider fallback.

Supports: groq, openrouter, together, cerebras, ollama, gemini.
On rate limit (429), rotates to the next configured provider.
"""

import logging
from typing import Any

from openai import BadRequestError, OpenAI, RateLimitError

from app.settings import settings

logger = logging.getLogger(__name__)

_PROVIDER_DEFAULTS: dict[str, dict[str, str]] = {
    "groq": {
        "base_url": "https://api.groq.com/openai/v1",
        "model": "llama-3.3-70b-versatile",
    },
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1",
        "model": "meta-llama/llama-3.3-70b-instruct:free",
    },
    "together": {
        "base_url": "https://api.together.xyz/v1",
        "model": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    },
    "cerebras": {
        "base_url": "https://api.cerebras.ai/v1",
        "model": "llama3.1-8b",
    },
    "ollama": {
        "base_url": "http://localhost:11434/v1",
        "model": "llama3.3",
    },
    "gemini": {
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "model": "gemini-2.5-flash",
    },
}

SUPPORTS_TOOL_USE = {"groq", "gemini", "openrouter"}


class AllProvidersExhausted(Exception):
    pass


def _get_provider_chain() -> list[dict[str, str]]:
    chain = []
    primary = settings.llm_provider.lower()
    defaults = _PROVIDER_DEFAULTS.get(primary, {})
    chain.append({
        "name": primary,
        "base_url": settings.llm_base_url or defaults.get("base_url", ""),
        "model": settings.llm_model or defaults.get("model", ""),
        "api_key": settings.llm_api_key,
    })

    fallbacks = [
        (settings.llm_fallback_1_provider, settings.llm_fallback_1_key),
        (settings.llm_fallback_2_provider, settings.llm_fallback_2_key),
        (settings.llm_fallback_3_provider, settings.llm_fallback_3_key),
    ]
    for provider_name, api_key in fallbacks:
        if not provider_name or not api_key:
            continue
        name = provider_name.lower()
        defaults = _PROVIDER_DEFAULTS.get(name, {})
        chain.append({
            "name": name,
            "base_url": defaults.get("base_url", ""),
            "model": defaults.get("model", ""),
            "api_key": api_key,
        })

    return chain


def _call_provider(
    provider_name: str,
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    tools: list[dict] | None = None,
    tool_choice: str | None = None,
    max_tokens: int = 500,
    temperature: float = 0.7,
) -> tuple[Any, str]:
    extra_headers = {}
    if provider_name == "openrouter":
        extra_headers = {
            "HTTP-Referer": "https://calsight.org",
            "X-Title": "CalSight",
        }
    client = OpenAI(base_url=base_url, api_key=api_key, max_retries=0, timeout=30, default_headers=extra_headers)
    kwargs: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    if tools and provider_name in SUPPORTS_TOOL_USE:
        kwargs["tools"] = tools
        if tool_choice:
            kwargs["tool_choice"] = tool_choice

    response = client.chat.completions.create(**kwargs)
    return response, provider_name


def generate_with_fallback(
    messages: list[dict[str, str]],
    tools: list[dict] | None = None,
    tool_choice: str | None = None,
    max_tokens: int = 500,
    temperature: float = 0.7,
) -> tuple[Any, str]:
    chain = _get_provider_chain()
    last_error = None

    for provider in chain:
        if tools and tool_choice == "required" and provider["name"] not in SUPPORTS_TOOL_USE:
            logger.info("Skipping %s (no tool support)", provider["name"])
            continue
        try:
            logger.info("Trying LLM provider: %s", provider["name"])
            response, name = _call_provider(
                provider_name=provider["name"],
                base_url=provider["base_url"],
                api_key=provider["api_key"],
                model=provider["model"],
                messages=messages,
                tools=tools,
                tool_choice=tool_choice,
                max_tokens=max_tokens,
                temperature=temperature,
            )
            return response, name
        except (RateLimitError, BadRequestError) as e:
            logger.warning("Provider %s failed: %s", provider["name"], e)
            last_error = e
            continue

    raise AllProvidersExhausted(
        f"All {len(chain)} providers exhausted. Last error: {last_error}"
    )


def generate_narrative(prompt: str) -> str:
    """Backwards-compatible wrapper for ETL scripts (single provider only)."""
    provider = settings.llm_provider.lower()
    defaults = _PROVIDER_DEFAULTS.get(provider, {})

    base_url = settings.llm_base_url or defaults.get("base_url")
    model = settings.llm_model or defaults.get("model")
    api_key = settings.llm_api_key or ("ollama" if provider == "ollama" else "")

    if not base_url:
        raise ValueError(f"Unknown LLM provider {provider!r} and no LLM_BASE_URL set.")
    if not model:
        raise ValueError(f"No model configured for provider {provider!r}.")

    client = OpenAI(base_url=base_url, api_key=api_key, max_retries=0, timeout=30)
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=200,
        temperature=0.7,
    )
    return resp.choices[0].message.content.strip()
