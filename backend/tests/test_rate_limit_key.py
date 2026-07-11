"""Rate-limit keying must survive the cloudflared tunnel (audit H3).

In production every request reaches the backend from the tunnel container's
Docker-network IP, so keying limits on `request.client.host` merges all users
into one bucket. `app.rate_limit.rate_limit_key` keys on CF-Connecting-IP
(set by Cloudflare's edge, unspoofable because prod ingress is tunnel-only)
and falls back to the socket address for local/dev traffic.
"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from starlette.requests import Request as StarletteRequest

from app.rate_limit import rate_limit_key


def _make_request(headers: dict[str, str] | None = None, client: tuple | None = ("10.0.0.5", 51000)):
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "query_string": b"",
        "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
    }
    if client is not None:
        scope["client"] = client
    return StarletteRequest(scope)


# ── key function unit behavior ──────────────────────────────────────────


def test_prefers_cf_connecting_ip_header():
    request = _make_request(headers={"CF-Connecting-IP": "203.0.113.7"})
    assert rate_limit_key(request) == "203.0.113.7"


def test_strips_whitespace_from_header():
    request = _make_request(headers={"CF-Connecting-IP": " 203.0.113.7 "})
    assert rate_limit_key(request) == "203.0.113.7"


def test_falls_back_to_remote_address_without_header():
    request = _make_request()
    assert rate_limit_key(request) == "10.0.0.5"


def test_falls_back_to_loopback_without_client():
    # Mirrors slowapi.util.get_remote_address's None handling.
    request = _make_request(client=None)
    assert rate_limit_key(request) == "127.0.0.1"


# ── functional: different client IPs get independent buckets ────────────


def _make_limited_app() -> FastAPI:
    limiter = Limiter(key_func=rate_limit_key)
    app = FastAPI()
    app.state.limiter = limiter

    @app.exception_handler(RateLimitExceeded)
    async def _handler(request: Request, exc: RateLimitExceeded):
        return JSONResponse(status_code=429, content={"error": "rate_limited"})

    @app.get("/ping")
    @limiter.limit("1/minute")
    def ping(request: Request):
        return {"ok": True}

    return app


def test_distinct_cf_ips_get_independent_buckets():
    """Two clients behind the same tunnel IP must not share a limit bucket.
    With a 1/minute limit, a second request from the SAME CF IP is 429 but a
    request from a DIFFERENT CF IP still succeeds."""
    client = TestClient(_make_limited_app())

    r1 = client.get("/ping", headers={"CF-Connecting-IP": "198.51.100.1"})
    assert r1.status_code == 200

    r2 = client.get("/ping", headers={"CF-Connecting-IP": "198.51.100.2"})
    assert r2.status_code == 200, "second client was throttled by the first client's traffic"

    r3 = client.get("/ping", headers={"CF-Connecting-IP": "198.51.100.1"})
    assert r3.status_code == 429, "same client's second request should be limited"


# ── guard: every Limiter in the app uses the shared key function ────────


def test_every_app_limiter_keys_on_real_client_ip():
    """Any Limiter constructed with slowapi's get_remote_address reintroduces
    the shared-bucket bug; this walks main + every router module."""
    import importlib
    import pkgutil

    import app.main as main_module
    import app.routers as routers_pkg

    modules = [main_module]
    for info in pkgutil.iter_modules(routers_pkg.__path__):
        modules.append(importlib.import_module(f"app.routers.{info.name}"))

    found = 0
    for module in modules:
        for value in vars(module).values():
            if isinstance(value, Limiter):
                assert value._key_func is rate_limit_key, (
                    f"{module.__name__} builds a Limiter without rate_limit_key"
                )
                found += 1
    # main.py + every router that throttles; keep a floor so an import
    # refactor that hides the limiters doesn't silently pass.
    assert found >= 20
