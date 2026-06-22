"""Provider-agnostic LLM wrapper with multi-provider fallback and cooldown tracking.

Supports: groq, openrouter, together, cerebras, ollama, gemini.
On rate limit (429), marks the provider as cooled down and skips it for future requests.
OpenRouter free models are automatically expanded into the fallback chain so each
model gets its own rate-limit cooldown.
"""

import itertools
import logging
import threading
import time
from typing import Any

from openai import APIConnectionError, APITimeoutError, BadRequestError, OpenAI, RateLimitError

from app.settings import settings

logger = logging.getLogger(__name__)

_PROVIDER_DEFAULTS: dict[str, dict[str, str]] = {
    "groq": {
        "base_url": "https://api.groq.com/openai/v1",
        "model": "llama-3.3-70b-versatile",
        "display_name": "Llama 3.3 70B (Groq)",
    },
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1",
        "model": "meta-llama/llama-3.3-70b-instruct:free",
        "display_name": "Llama 3.3 70B",
    },
    "together": {
        "base_url": "https://api.together.xyz/v1",
        "model": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        "display_name": "Llama 3.3 70B (Together)",
    },
    "cerebras": {
        "base_url": "https://api.cerebras.ai/v1",
        "model": "llama3.1-8b",
        "display_name": "Llama 3.1 8B (Cerebras)",
    },
    "ollama": {
        "base_url": "http://host.docker.internal:11434/v1",
        "model": "mistral-small3.2",
        "display_name": "Mistral Small (Local)",
    },
    "gemini": {
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "model": "gemini-2.5-flash",
        "display_name": "Gemini 2.5 Flash",
    },
}

OPENROUTER_FREE_MODELS: list[tuple[str, str]] = [
    ("Nemotron 120B", "nvidia/nemotron-3-super-120b-a12b:free"),
    ("Gemma 4 31B", "google/gemma-4-31b-it:free"),
    ("Qwen3 80B", "qwen/qwen3-next-80b-a3b-instruct:free"),
    ("GPT-OSS 120B", "openai/gpt-oss-120b:free"),
    ("Gemma 4 26B", "google/gemma-4-26b-a4b-it:free"),
]

SUPPORTS_TOOL_USE = {"groq", "gemini", "openrouter", "ollama"}

# In-memory cooldown tracker: provider_name -> timestamp when cooldown expires
_cooldown_lock = threading.Lock()
_provider_cooldowns: dict[str, float] = {}
_provider_failures: dict[str, int] = {}
_BASE_COOLDOWN_SECONDS = 30
_DAILY_COOLDOWN_SECONDS = 1800  # 30 min for daily token limits


class AllProvidersExhausted(Exception):
    pass


def _mark_cooled_down(provider_name: str, seconds: int | None = None):
    """Mark a provider as rate-limited with exponential backoff."""
    with _cooldown_lock:
        _provider_failures[provider_name] = _provider_failures.get(provider_name, 0) + 1
        if seconds is None:
            failures = _provider_failures[provider_name]
            seconds = min(_BASE_COOLDOWN_SECONDS * (2 ** (failures - 1)), 300)
        _provider_cooldowns[provider_name] = time.time() + seconds
        failure_count = _provider_failures.get(provider_name, 0)
    logger.info("Provider %s cooled down for %ds (failure #%d)", provider_name, seconds, failure_count)


def _mark_success(provider_name: str):
    """Reset failure count on successful call."""
    with _cooldown_lock:
        _provider_failures.pop(provider_name, None)


def _is_available(provider_name: str) -> bool:
    """Check if a provider is past its cooldown period."""
    with _cooldown_lock:
        cooldown_until = _provider_cooldowns.get(provider_name, 0)
        if time.time() >= cooldown_until:
            _provider_cooldowns.pop(provider_name, None)
            return True
        remaining = int(cooldown_until - time.time())
    logger.debug("Provider %s still cooling down (%ds left)", provider_name, remaining)
    return False


def get_provider_status() -> dict[str, str]:
    """Return status of all providers (for the frontend)."""
    chain = _get_provider_chain()
    status = {}
    for p in chain:
        name = p["name"]
        if _is_available(name):
            status[name] = "available"
        else:
            remaining = int(_provider_cooldowns.get(name, 0) - time.time())
            status[name] = f"cooldown ({remaining}s)"
    return status


def get_available_provider_count() -> int:
    """Return how many providers are currently available (not in cooldown)."""
    chain = _get_provider_chain()
    return sum(1 for p in chain if _is_available(p["name"]))


def _get_provider_chain() -> list[dict[str, str]]:
    """Build the ordered provider chain with OpenRouter free models expanded.

    Each entry has: name (unique display label), type (base provider for
    headers/tool-use), base_url, model, api_key.
    """
    chain: list[dict[str, str]] = []
    primary = settings.llm_provider.lower()
    defaults = _PROVIDER_DEFAULTS.get(primary, {})
    chain.append({
        "name": defaults.get("display_name", primary),
        "type": primary,
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
        ptype = provider_name.lower()
        defaults = _PROVIDER_DEFAULTS.get(ptype, {})

        if ptype == "openrouter":
            chain.append({
                "name": defaults.get("display_name", "Llama 3.3 70B"),
                "type": "openrouter",
                "base_url": defaults.get("base_url", ""),
                "model": defaults.get("model", ""),
                "api_key": api_key,
            })
            for display_name, model_id in OPENROUTER_FREE_MODELS:
                chain.append({
                    "name": display_name,
                    "type": "openrouter",
                    "base_url": "https://openrouter.ai/api/v1",
                    "model": model_id,
                    "api_key": api_key,
                })
        else:
            chain.append({
                "name": defaults.get("display_name", ptype),
                "type": ptype,
                "base_url": defaults.get("base_url", ""),
                "model": defaults.get("model", ""),
                "api_key": api_key,
            })

    if len(chain) == 1:
        fallback_entry = chain[0].copy()
        fallback_entry["name"] = f'{fallback_entry["name"]} (fallback)'
        chain.append(fallback_entry)

    return chain


def _call_provider(
    provider: dict[str, str],
    messages: list[dict[str, str]],
    tools: list[dict] | None = None,
    tool_choice: str | None = None,
    max_tokens: int = 500,
    temperature: float = 0.7,
) -> Any:
    ptype = provider.get("type", provider["name"])
    extra_headers = {}
    if ptype == "openrouter":
        extra_headers = {
            "HTTP-Referer": "https://calsight.org",
            "X-Title": "CalSight",
        }
    client = OpenAI(
        base_url=provider["base_url"],
        api_key=provider["api_key"],
        max_retries=0,
        timeout=30,
        default_headers=extra_headers,
    )
    kwargs: dict[str, Any] = {
        "model": provider["model"],
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    if tools and ptype in SUPPORTS_TOOL_USE:
        kwargs["tools"] = tools
        if tool_choice:
            kwargs["tool_choice"] = tool_choice

    return client.chat.completions.create(**kwargs)


def generate_with_fallback(
    messages: list[dict[str, str]],
    tools: list[dict] | None = None,
    tool_choice: str | None = None,
    max_tokens: int = 500,
    temperature: float = 0.7,
) -> tuple[Any, str]:
    chain = _get_provider_chain()
    last_error = None
    tried = 0

    for provider in chain:
        name = provider["name"]
        ptype = provider.get("type", name)

        if not _is_available(name):
            logger.info("Skipping %s (cooling down)", name)
            continue

        if tools and tool_choice == "required" and ptype not in SUPPORTS_TOOL_USE:
            logger.info("Skipping %s (no tool support)", name)
            continue

        tried += 1
        try:
            logger.info("Trying LLM provider: %s [%s]", name, provider["model"])
            response = _call_provider(
                provider=provider,
                messages=messages,
                tools=tools,
                tool_choice=tool_choice,
                max_tokens=max_tokens,
                temperature=temperature,
            )
            _mark_success(name)
            return response, name

        except RateLimitError as e:
            error_msg = str(e)
            if "tokens per day" in error_msg.lower() or "tpd" in error_msg.lower():
                _mark_cooled_down(name, _DAILY_COOLDOWN_SECONDS)
            else:
                retry_after = None
                if hasattr(e, "response") and e.response is not None:
                    retry_after_str = e.response.headers.get("retry-after")
                    if retry_after_str and retry_after_str.isdigit():
                        retry_after = int(retry_after_str)
                _mark_cooled_down(name, retry_after)
            logger.warning("Provider %s rate limited: %s", name, e)
            last_error = e
            continue

        except BadRequestError as e:
            _mark_cooled_down(name, 60)
            logger.warning("Provider %s bad request: %s", name, e)
            last_error = e
            continue

        except (APIConnectionError, APITimeoutError, Exception) as e:
            _mark_cooled_down(name, 30)
            logger.warning("Provider %s connection/timeout error: %s", name, e)
            last_error = e
            continue

    raise AllProvidersExhausted(
        f"All providers exhausted ({tried} tried, {len(chain)} configured). Last error: {last_error}"
    )


_narrative_call_counter = itertools.count()


def generate_narrative(prompt: str) -> str:
    """ETL narrative generator with automatic key rotation.

    When LLM_API_KEY_2 is set, alternates between the two keys so each
    key handles half the calls and stays under per-key rate limits.
    """
    call_num = next(_narrative_call_counter)

    provider = settings.llm_provider.lower()
    defaults = _PROVIDER_DEFAULTS.get(provider, {})

    base_url = settings.llm_base_url or defaults.get("base_url")
    model = settings.llm_model or defaults.get("model")

    keys = [k for k in [settings.llm_api_key, settings.llm_api_key_2] if k]
    if not keys:
        keys = ["ollama"] if provider == "ollama" else []
    if not keys:
        raise ValueError(f"No API key configured for provider {provider!r}.")
    api_key = keys[call_num % len(keys)]

    if not base_url:
        raise ValueError(f"Unknown LLM provider {provider!r} and no LLM_BASE_URL set.")
    if not model:
        raise ValueError(f"No model configured for provider {provider!r}.")

    logger.info("generate_narrative using key #%d of %d", call_num % len(keys) + 1, len(keys))
    client = OpenAI(base_url=base_url, api_key=api_key, max_retries=0, timeout=30)
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=200,
        temperature=0.7,
    )
    return (resp.choices[0].message.content or "").strip()
