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
from collections.abc import Iterator
from types import SimpleNamespace
from typing import Any

from openai import (
    APIConnectionError,
    APIError,
    APITimeoutError,
    BadRequestError,
    OpenAI,
    RateLimitError,
)

from app import llm_budget
from app.settings import settings

logger = logging.getLogger(__name__)

# Default sampling temperature for all LLM calls. Low by design — CalSight's AI
# reports facts from the database, so consistency beats creativity. Configurable
# via LLM_TEMPERATURE (settings.llm_temperature).
DEFAULT_TEMPERATURE = settings.llm_temperature

# Model roster, re-verified against each provider's live /models on 2026-09-12
# after the summer-2026 Llama shutdowns silently took out the whole chain:
#   - Groq retired llama-3.3-70b-versatile on 2026-08-16 (free/dev tiers);
#     the model now 404s, so Ask AI had been running on the Gemini fallback
#     and the ETL narrative jobs (primary-only) had been failing since then.
#   - Cerebras retired llama3.1-8b (2026-05-27); gpt-oss-120b is its
#     replacement but needs billing enabled on the account (402 otherwise).
#   - OpenRouter moved llama-3.3-70b, qwen3-next and gpt-oss-120b to paid-only.
#   - Gemini 2.5 Flash still answers but Google has floated an Oct-2026
#     retirement; 3.5 Flash-Lite is GA, on the free tier, and doesn't spend the
#     token budget on hidden thinking.
_PROVIDER_DEFAULTS: dict[str, dict[str, str]] = {
    "groq": {
        "base_url": "https://api.groq.com/openai/v1",
        "model": "openai/gpt-oss-120b",
        "display_name": "GPT-OSS 120B (Groq)",
    },
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1",
        "model": "nvidia/nemotron-3-super-120b-a12b:free",
        "display_name": "Nemotron 3 Super 120B",
    },
    "together": {
        "base_url": "https://api.together.xyz/v1",
        "model": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        "display_name": "Llama 3.3 70B (Together)",
    },
    "cerebras": {
        "base_url": "https://api.cerebras.ai/v1",
        "model": "gpt-oss-120b",
        "display_name": "GPT-OSS 120B (Cerebras)",
    },
    "ollama": {
        "base_url": "http://host.docker.internal:11434/v1",
        "model": "mistral-small3.2",
        "display_name": "Mistral Small (Local)",
    },
    "gemini": {
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "model": "gemini-3.5-flash-lite",
        "display_name": "Gemini 3.5 Flash-Lite",
    },
}

# Extra free OpenRouter models tried after the default one. Only slugs that
# still resolve as :free on 2026-09-12 — the paid-only ones return 404.
OPENROUTER_FREE_MODELS: list[tuple[str, str]] = [
    ("Gemma 4 31B", "google/gemma-4-31b-it:free"),
    ("Gemma 4 26B", "google/gemma-4-26b-a4b-it:free"),
]


def _model_kwargs(model: str) -> dict[str, Any]:
    """Per-model request extras.

    gpt-oss is a reasoning model: at its default effort it spends the whole
    200-token narrative budget thinking and returns EMPTY content (2 of 3
    calls in testing). Low effort answers in ~60 tokens with the same tool
    calls, so every gpt-oss call pins it.
    """
    return {"reasoning_effort": "low"} if "gpt-oss" in model else {}

SUPPORTS_TOOL_USE = {"groq", "gemini", "openrouter", "ollama"}

# Providers that cost nothing to call (self-hosted) and are therefore exempt
# from the LLM_DAILY_REQUEST_BUDGET spending backstop (see app.llm_budget).
_FREE_PROVIDER_TYPES = {"ollama"}

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
                "name": defaults.get("display_name", "OpenRouter"),
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


# Gemini 3 rejects a replayed tool call without its thought signature (400
# "Function call is missing a thought_signature"), which benched Gemini on
# every round after its first tool call. Its OpenAI-compatible API returns
# the signature as tool_calls[i].extra_content and wants it sent back there;
# a call another provider made has none, and Google documents this dummy
# value for exactly that case. Other providers get the field stripped.
_GEMINI_SKIP_SIGNATURE = {"google": {"thought_signature": "skip_thought_signature_validator"}}


def _messages_for(ptype: str, messages: list[dict]) -> list[dict]:
    """Messages with tool-call ``extra_content`` fitted to ``ptype``.

    Returns new dicts wherever a tool call changes; the caller's list (the
    conversation the ask loop keeps appending to) is never mutated.
    """
    out = []
    for msg in messages:
        calls = msg.get("tool_calls") if isinstance(msg, dict) else None
        if not calls:
            out.append(msg)
            continue
        if ptype == "gemini":
            fitted = [dict(c) for c in calls]
            # Gemini signs only the first call of a parallel set.
            if not any(c.get("extra_content") for c in fitted):
                fitted[0]["extra_content"] = _GEMINI_SKIP_SIGNATURE
        else:
            fitted = [{k: v for k, v in c.items() if k != "extra_content"} for c in calls]
        out.append({**msg, "tool_calls": fitted})
    return out


def _is_bad_generation(e: Exception) -> bool:
    """A 400 about one generation, not about the provider.

    Groq validates a tool call against its schema and 400s with
    ``tool_use_failed`` when the model writes, say, ``"severity": null``.
    That is this request's bad luck; cooling Groq for 60 s over it sent every
    other visitor to the fallback models as well.
    """
    return getattr(e, "code", None) == "tool_use_failed"


def _call_provider(
    provider: dict[str, str],
    messages: list[dict[str, str]],
    tools: list[dict] | None = None,
    tool_choice: str | None = None,
    max_tokens: int = 500,
    temperature: float = DEFAULT_TEMPERATURE,
    stream: bool = False,
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
        "messages": _messages_for(ptype, messages),
        "max_tokens": max_tokens,
        "temperature": temperature,
        **_model_kwargs(provider["model"]),
    }
    if tools and ptype in SUPPORTS_TOOL_USE:
        kwargs["tools"] = tools
        if tool_choice:
            kwargs["tool_choice"] = tool_choice
    if stream:
        kwargs["stream"] = True

    return client.chat.completions.create(**kwargs)


def generate_with_fallback(
    messages: list[dict[str, str]],
    tools: list[dict] | None = None,
    tool_choice: str | None = None,
    max_tokens: int = 500,
    temperature: float = DEFAULT_TEMPERATURE,
    stream: bool = False,
) -> tuple[Any, str]:
    """Return ``(response, provider_name)``.

    With ``stream=True`` the first element is an iterator of streaming chunks
    instead of a completed response — feed it to :func:`consume_stream`.
    """
    return _generate_over_chain(
        _get_provider_chain(),
        messages,
        tools=tools,
        tool_choice=tool_choice,
        max_tokens=max_tokens,
        temperature=temperature,
        budget=settings.llm_daily_request_budget,
        stream=stream,
    )


def _close_quietly(stream: Any) -> None:
    """Release a provider's HTTP stream without letting teardown mask the error."""
    close = getattr(stream, "close", None)
    if close is None:
        return
    try:
        close()
    except Exception:
        logger.debug("Failed to close a provider stream", exc_info=True)


def _peek_stream(chunks: Any) -> Iterator[Any]:
    """Pull the first chunk eagerly, then re-attach it.

    Called inside the chain walk's try/except so a provider that dies before
    emitting a single token falls through to the next provider exactly like a
    non-streaming failure. Once the first chunk is in hand the provider has
    committed, and later errors surface to the caller instead.

    The returned generator closes the underlying provider stream on every exit
    — exhaustion, error, or the caller being closed when the client hangs up —
    so an abandoned response never waits on the garbage collector.
    """
    it = iter(chunks)
    try:
        first = next(it, None)
    except BaseException:
        _close_quietly(chunks)
        raise

    def rest() -> Iterator[Any]:
        try:
            if first is not None:
                yield first
            yield from it
        finally:
            _close_quietly(chunks)

    return rest()


def consume_stream(chunks: Any) -> Iterator[str]:
    """Yield content deltas from a streaming completion as they arrive.

    Returns (via ``StopIteration.value``, i.e. ``yield from``) the assembled
    message in the same shape the non-streaming path reads:
    ``.content`` and ``.tool_calls[i].function.{name,arguments}``.
    """
    content: list[str] = []
    calls: dict[int, dict[str, str]] = {}

    try:
        for chunk in chunks:
            choices = getattr(chunk, "choices", None)
            if not choices:
                continue
            delta = getattr(choices[0], "delta", None)
            if delta is None:
                continue
            text = getattr(delta, "content", None)
            if text:
                content.append(text)
                yield text
            for tc in getattr(delta, "tool_calls", None) or []:
                # Every field is optional per provider — a missing `index`
                # used to raise mid-stream, where there is no failover left.
                slot = calls.setdefault(
                    getattr(tc, "index", 0) or 0, {"id": "", "name": "", "arguments": ""}
                )
                if getattr(tc, "id", None):
                    slot["id"] = tc.id
                if getattr(tc, "extra_content", None):
                    slot["extra_content"] = tc.extra_content
                fn = getattr(tc, "function", None)
                if fn is None:
                    continue
                slot["name"] += getattr(fn, "name", None) or ""
                slot["arguments"] += getattr(fn, "arguments", None) or ""
    finally:
        _close_quietly(chunks)

    tool_calls = [
        SimpleNamespace(
            id=c["id"],
            type="function",
            function=SimpleNamespace(name=c["name"], arguments=c["arguments"] or "{}"),
            extra_content=c.get("extra_content"),
        )
        for _idx, c in sorted(calls.items())
    ]
    return SimpleNamespace(content="".join(content) or None, tool_calls=tool_calls or None)


def _generate_over_chain(
    chain: list[dict[str, str]],
    messages: list[dict[str, str]],
    tools: list[dict] | None = None,
    tool_choice: str | None = None,
    max_tokens: int = 500,
    temperature: float = DEFAULT_TEMPERATURE,
    budget: int = 0,
    stream: bool = False,
) -> tuple[Any, str]:
    """Walk ``chain`` in order, honouring cooldowns and the daily ``budget``
    (0 = unlimited), returning the first successful (response, provider name)."""
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

        # Spending backstop: consume from the daily budget only for paid
        # providers, and only once we know the call will actually be made
        # (cooldown/tool-support skips above never touch the counter).
        if ptype not in _FREE_PROVIDER_TYPES and not llm_budget.try_consume(budget):
            logger.warning(
                "Skipping %s (daily LLM request budget of %d spent for this worker)",
                name,
                budget,
            )
            if last_error is None:
                last_error = RuntimeError("daily LLM request budget exhausted")
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
                stream=stream,
            )
            if stream:
                response = _peek_stream(response)
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
            if not _is_bad_generation(e):
                _mark_cooled_down(name, 60)
            logger.warning("Provider %s bad request: %s", name, e)
            last_error = e
            continue

        except (APIConnectionError, APITimeoutError) as e:
            _mark_cooled_down(name, 30)
            logger.warning("Provider %s connection/timeout error: %s", name, e)
            last_error = e
            continue

        except APIError as e:
            # Any other provider-side API error (5xx, auth, unexpected status,
            # etc.). Still a transient/provider problem, not our bug — cool the
            # provider and fall through to the next one.
            _mark_cooled_down(name, 30)
            logger.warning("Provider %s API error: %s", name, e)
            last_error = e
            continue

        except Exception:
            # A non-API exception is almost certainly a bug in *our* code
            # (e.g. a TypeError building the request), not a provider outage.
            # Cooling the provider here would wrongly bench a healthy provider
            # and silently hide the bug. Log distinctly and re-raise so it
            # surfaces immediately instead of degrading into AllProvidersExhausted.
            logger.exception(
                "Unexpected non-API error while calling provider %s; "
                "re-raising without cooldown (likely a code bug, not an outage)",
                name,
            )
            raise

    raise AllProvidersExhausted(
        f"All providers exhausted ({tried} tried, {len(chain)} configured). Last error: {last_error}"
    )


_narrative_call_counter = itertools.count()


def generate_narrative(prompt: str) -> str:
    """ETL narrative generator: same provider chain as Ask AI, plus key rotation.

    When LLM_API_KEY_2 is set, the primary provider alternates between the two
    keys so each handles half the calls and stays under per-key rate limits.
    Fallback providers are tried in order if the primary fails (a primary-only
    version of this function silently failed for four weeks after Groq retired
    its Llama model). ETL calls are exempt from LLM_DAILY_REQUEST_BUDGET — that
    backstop guards the public /api/ask, not a ~1,450-call nightly backfill.
    Raises AllProvidersExhausted when every provider fails.
    """
    chain = _get_provider_chain()
    keys = [k for k in (settings.llm_api_key, settings.llm_api_key_2) if k]
    if keys:
        call_num = next(_narrative_call_counter)
        chain[0]["api_key"] = keys[call_num % len(keys)]
        logger.info("generate_narrative using key #%d of %d", call_num % len(keys) + 1, len(keys))

    resp, _provider = _generate_over_chain(
        chain,
        [{"role": "user", "content": prompt}],
        max_tokens=200,
        budget=0,
    )
    return (resp.choices[0].message.content or "").strip()
