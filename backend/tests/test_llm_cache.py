"""Unit tests for the in-process Ask AI cache."""

from __future__ import annotations

import time

import pytest

from app.llm_cache import TTLLRUCache, make_cache_key


# ── make_cache_key ──────────────────────────────────────────────────────


def test_cache_key_is_deterministic():
    a = make_cache_key("hello", {"county": "los-angeles", "year": "2023"}, [])
    b = make_cache_key("hello", {"county": "los-angeles", "year": "2023"}, [])
    assert a == b


def test_cache_key_independent_of_filter_dict_order():
    a = make_cache_key("hi", {"a": "1", "b": "2"}, [])
    b = make_cache_key("hi", {"b": "2", "a": "1"}, [])
    assert a == b


def test_cache_key_changes_with_question():
    a = make_cache_key("crashes in la", {"year": "2023"}, [])
    b = make_cache_key("crashes in sf", {"year": "2023"}, [])
    assert a != b


def test_cache_key_changes_with_filters():
    a = make_cache_key("crashes", {"county": "los-angeles"}, [])
    b = make_cache_key("crashes", {"county": "orange"}, [])
    assert a != b


def test_cache_key_changes_with_history():
    a = make_cache_key("what about that?", {}, [{"role": "user", "content": "tell me about la"}])
    b = make_cache_key("what about that?", {}, [{"role": "user", "content": "tell me about sf"}])
    assert a != b


def test_cache_key_normalizes_whitespace_via_strip():
    a = make_cache_key("hello", {}, [])
    b = make_cache_key("  hello  ", {}, [])
    assert a == b


def test_cache_key_treats_missing_history_as_empty():
    a = make_cache_key("q", {"f": "1"}, None)
    b = make_cache_key("q", {"f": "1"}, [])
    assert a == b


# ── TTLLRUCache ─────────────────────────────────────────────────────────


def test_get_returns_none_for_unknown_key():
    cache: TTLLRUCache[str] = TTLLRUCache(max_size=10, ttl_seconds=60)
    assert cache.get("missing") is None


def test_set_then_get_round_trip():
    cache: TTLLRUCache[str] = TTLLRUCache(max_size=10, ttl_seconds=60)
    cache.set("k1", "v1")
    assert cache.get("k1") == "v1"


def test_lru_evicts_oldest_when_full():
    cache: TTLLRUCache[str] = TTLLRUCache(max_size=2, ttl_seconds=60)
    cache.set("a", "1")
    cache.set("b", "2")
    cache.set("c", "3")  # should evict "a"
    assert cache.get("a") is None
    assert cache.get("b") == "2"
    assert cache.get("c") == "3"


def test_get_promotes_to_most_recently_used():
    cache: TTLLRUCache[str] = TTLLRUCache(max_size=2, ttl_seconds=60)
    cache.set("a", "1")
    cache.set("b", "2")
    # Touch "a" so "b" becomes oldest.
    assert cache.get("a") == "1"
    cache.set("c", "3")  # evicts "b"
    assert cache.get("b") is None
    assert cache.get("a") == "1"
    assert cache.get("c") == "3"


def test_ttl_expires_entries():
    cache: TTLLRUCache[str] = TTLLRUCache(max_size=10, ttl_seconds=0.05)
    cache.set("k", "v")
    assert cache.get("k") == "v"
    time.sleep(0.1)
    assert cache.get("k") is None


def test_expired_entry_is_purged_on_get():
    cache: TTLLRUCache[str] = TTLLRUCache(max_size=10, ttl_seconds=0.05)
    cache.set("k", "v")
    time.sleep(0.1)
    cache.get("k")
    # Internal store should not retain the expired entry — verify via size.
    assert cache.size == 0


def test_overwrite_updates_value_and_expiry():
    cache: TTLLRUCache[str] = TTLLRUCache(max_size=10, ttl_seconds=60)
    cache.set("k", "v1")
    cache.set("k", "v2")
    assert cache.get("k") == "v2"
    assert cache.size == 1


def test_clear_drops_everything():
    cache: TTLLRUCache[str] = TTLLRUCache(max_size=10, ttl_seconds=60)
    cache.set("a", "1")
    cache.set("b", "2")
    cache.clear()
    assert cache.get("a") is None
    assert cache.get("b") is None
    assert cache.size == 0


def test_stats_counts_hits_and_misses():
    cache: TTLLRUCache[str] = TTLLRUCache(max_size=10, ttl_seconds=60)
    cache.set("k", "v")
    cache.get("k")        # hit
    cache.get("k")        # hit
    cache.get("missing")  # miss
    s = cache.stats()
    assert s["hits"] == 2
    assert s["misses"] == 1
    assert s["size"] == 1


def test_rejects_zero_or_negative_max_size():
    with pytest.raises(ValueError):
        TTLLRUCache(max_size=0, ttl_seconds=10)


def test_rejects_zero_or_negative_ttl():
    with pytest.raises(ValueError):
        TTLLRUCache(max_size=10, ttl_seconds=0)
