"""Provider-agnostic LLM wrapper using the OpenAI-compatible SDK.

All five supported providers (groq, openrouter, together, cerebras, ollama)
expose OpenAI-compatible chat completion endpoints. Only ``base_url``,
``api_key``, and ``model`` differ between them — the rest of the call is
identical.

This module is intentionally synchronous. ETL scripts run in a plain Python
process without asyncio, so we use ``openai.OpenAI`` (sync client), not
``openai.AsyncOpenAI``.

Provider defaults
-----------------
The ``_PROVIDER_DEFAULTS`` dict stores base URLs and sensible default models
for each provider. Settings override these — set ``LLM_MODEL`` or
``LLM_BASE_URL`` in .env to force a specific value.

Note on Ollama
--------------
The Proxmox server has no GPU. When using Ollama, it runs on Jeff's local PC.
The ETL script can reach it over Tailscale by setting::

    LLM_BASE_URL=http://<tailscale-ip>:11434/v1

Or run ``python -m etl.generate_insights`` directly on the local PC.

Usage
-----
::

    from app.llm import generate_narrative
    text = generate_narrative("Your prompt here")
"""

import logging

from openai import OpenAI

from app.settings import settings

logger = logging.getLogger(__name__)

# Provider defaults: base_url and a sensible default model.
# These are overridden by LLM_BASE_URL / LLM_MODEL in .env.
_PROVIDER_DEFAULTS: dict[str, dict[str, str]] = {
    "groq": {
        "base_url": "https://api.groq.com/openai/v1",
        "model": "llama-3.3-70b-versatile",
    },
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1",
        "model": "meta-llama/llama-3.3-70b",
    },
    "together": {
        "base_url": "https://api.together.xyz/v1",
        "model": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    },
    "cerebras": {
        "base_url": "https://api.cerebras.ai/v1",
        "model": "llama-3.3-70b",
    },
    "ollama": {
        "base_url": "http://localhost:11434/v1",
        "model": "llama3.3",
    },
}


def generate_narrative(prompt: str) -> str:
    """Call the configured LLM provider and return the response text.

    Synchronous — ETL scripts don't use asyncio.

    Raises any OpenAI SDK exception on failure so the ETL caller can catch,
    log, and skip the county rather than crashing the whole pipeline.

    Parameters
    ----------
    prompt:
        The full user prompt to send to the model.

    Returns
    -------
    str
        The model's response text, stripped of leading/trailing whitespace.
    """
    provider = settings.llm_provider.lower()
    defaults = _PROVIDER_DEFAULTS.get(provider, {})

    base_url = settings.llm_base_url or defaults.get("base_url")
    model = settings.llm_model or defaults.get("model")
    # Ollama doesn't require a real API key; other providers do.
    api_key = settings.llm_api_key or ("ollama" if provider == "ollama" else "")

    if not base_url:
        raise ValueError(
            f"Unknown LLM provider {provider!r} and no LLM_BASE_URL set. "
            f"Supported providers: {', '.join(_PROVIDER_DEFAULTS)}"
        )
    if not model:
        raise ValueError(
            f"No model configured for provider {provider!r}. "
            "Set LLM_MODEL in .env or use a supported provider."
        )

    logger.debug("LLM call: provider=%s model=%s", provider, model)

    client = OpenAI(base_url=base_url, api_key=api_key)
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=200,
        temperature=0.7,
    )
    return resp.choices[0].message.content.strip()
