"""In-process LRU cache for /api/ask responses.

The Ask AI endpoint forwards a question + the user's active filters + recent
history to one or more LLM providers. Identical inputs produce identical
outputs (modulo provider non-determinism), so caching them saves the LLM
round trip — both the dollar cost and the 2-5 second latency.

Design notes:
  * Pure-stdlib `OrderedDict` LRU. We don't pull in cachetools for this
    one use site; the wheel is small but the maintenance surface is real.
  * TTL is per-entry, evaluated lazily on `get()`. We don't run a
    background sweeper — the LRU eviction policy keeps memory bounded.
  * Thread-safe via a single `threading.Lock`. Reads and writes both lock;
    the cache is small (~500 entries by default) so the contention cost is
    negligible compared to the LLM call we're avoiding.
  * `history` is part of the cache key — a chat follow-up like "what about
    that?" depends on prior context, so two users' histories should NOT
    collide on a single cached body. This narrows hit rate to "fresh
    sessions asking the same first question," which the issue's 10-20%
    dedup estimate is built on.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from collections import OrderedDict
from typing import Any, Generic, TypeVar

V = TypeVar("V")


def make_cache_key(
    question: str,
    filters: dict[str, Any],
    history: list[dict[str, Any]] | None = None,
) -> str:
    """SHA-256 of a stable serialization of (question, filters, history).

    `filters` and `history` may contain anything JSON-serializable; we
    sort dict keys so cache keys don't depend on iteration order.
    """
    payload = {
        "q": question.strip(),
        "f": filters or {},
        "h": history or [],
    }
    serialized = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


class TTLLRUCache(Generic[V]):
    """LRU cache with per-entry TTL.

    `get(key)` returns the stored value if present and unexpired, else None
    (and removes the expired entry). `set(key, value)` evicts the oldest
    entry past `max_size`. `clear()` drops everything; useful in tests.
    """

    def __init__(self, *, max_size: int = 500, ttl_seconds: float = 3600.0) -> None:
        if max_size <= 0:
            raise ValueError("max_size must be positive")
        if ttl_seconds <= 0:
            raise ValueError("ttl_seconds must be positive")
        self._max_size = max_size
        self._ttl = ttl_seconds
        self._lock = threading.Lock()
        # Maps key -> (expires_at_monotonic, value)
        self._store: OrderedDict[str, tuple[float, V]] = OrderedDict()
        # Counters — handy for /healthz and tests.
        self._hits = 0
        self._misses = 0

    def get(self, key: str) -> V | None:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                self._misses += 1
                return None
            expires_at, value = entry
            if time.monotonic() >= expires_at:
                # Expired — drop it so memory doesn't pile up.
                del self._store[key]
                self._misses += 1
                return None
            # LRU touch.
            self._store.move_to_end(key)
            self._hits += 1
            return value

    def set(self, key: str, value: V) -> None:
        expires_at = time.monotonic() + self._ttl
        with self._lock:
            self._store[key] = (expires_at, value)
            self._store.move_to_end(key)
            while len(self._store) > self._max_size:
                self._store.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._store.clear()
            self._hits = 0
            self._misses = 0

    @property
    def size(self) -> int:
        with self._lock:
            return len(self._store)

    def stats(self) -> dict[str, int]:
        """Snapshot of hit/miss counters. Reset by `clear()`."""
        with self._lock:
            return {"size": len(self._store), "hits": self._hits, "misses": self._misses}


# Process-wide cache instance, used by the /api/ask handler. Tunables live
# here rather than in settings.py — they're operational parameters that
# rarely need per-env override, and exposing them as env vars invites
# accidental misconfiguration (e.g. ttl=0 disabling caching silently).
_ASK_CACHE: TTLLRUCache[Any] = TTLLRUCache(max_size=500, ttl_seconds=3600.0)


def get_ask_cache() -> TTLLRUCache[Any]:
    return _ASK_CACHE
