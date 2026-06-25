"""Tests for etl.alerts.send_heartbeat — the dead-man's-switch ping.

httpx.get is monkeypatched so no real network calls are made.
"""

import httpx

from etl import alerts


def test_heartbeat_noop_when_unset(monkeypatch):
    """No URL configured → no ping, returns False."""
    monkeypatch.delenv("HEARTBEAT_URL", raising=False)
    from app.settings import settings
    monkeypatch.setattr(settings, "heartbeat_url", "", raising=False)

    calls = []
    monkeypatch.setattr(httpx, "get", lambda *a, **k: calls.append(a))

    assert alerts.send_heartbeat() is False
    assert calls == []


def test_heartbeat_success_pings_base_url(monkeypatch):
    monkeypatch.setenv("HEARTBEAT_URL", "https://hc.example/abc")
    pinged = {}

    def fake_get(url, **kwargs):
        pinged["url"] = url
        return httpx.Response(200, request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx, "get", fake_get)

    assert alerts.send_heartbeat(success=True) is True
    assert pinged["url"] == "https://hc.example/abc"


def test_heartbeat_failure_appends_fail(monkeypatch):
    """On failure the healthchecks.io '/fail' suffix is used (trailing slash trimmed)."""
    monkeypatch.setenv("HEARTBEAT_URL", "https://hc.example/abc/")
    pinged = {}

    def fake_get(url, **kwargs):
        pinged["url"] = url
        return httpx.Response(200, request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx, "get", fake_get)

    assert alerts.send_heartbeat(success=False) is True
    assert pinged["url"] == "https://hc.example/abc/fail"


def test_heartbeat_never_raises(monkeypatch):
    """A network error must be swallowed — the pipeline must not crash."""
    monkeypatch.setenv("HEARTBEAT_URL", "https://hc.example/abc")

    def boom(*a, **k):
        raise httpx.ConnectError("monitor unreachable")

    monkeypatch.setattr(httpx, "get", boom)

    assert alerts.send_heartbeat() is False
