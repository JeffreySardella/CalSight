"""Shared rate-limit key function for every slowapi Limiter in the app.

Why not slowapi's ``get_remote_address``: in production all public traffic
ingresses through the cloudflared tunnel container, so ``request.client.host``
is the tunnel's Docker-network IP for *every* request. Keying limits on it
collapses all users into a single shared bucket — one busy (or hostile)
client exhausts ``/api/ask`` or locks out ``/admin/verify`` for the whole
site (audit H3). Cloudflare sets ``CF-Connecting-IP`` to the real client IP
on each proxied request, so we key on that header when present and fall back
to the socket address otherwise (local dev, tests, direct calls).

Why trusting the header is safe here: production ingress is tunnel-only —
the backend publishes no host port in docker-compose.prod.yml, so the only
path to the API is via Cloudflare's edge, which overwrites any
client-supplied ``CF-Connecting-IP`` with the connecting IP it observed.
External clients therefore cannot spoof the key.

Residual risk: if the backend were ever exposed directly (a misconfigured
compose file, a dev port binding reachable from outside), a direct client
could rotate the header to dodge per-IP limits. That is no weaker than
today's behavior for such a client (fresh source IPs achieve the same), but
it is the trade-off accepted by trusting the header without validating that
the peer is actually the tunnel.
"""

from __future__ import annotations

from starlette.requests import Request


def rate_limit_key(request: Request) -> str:
    """Real-client rate-limit key: CF-Connecting-IP, else the socket address."""
    cf_ip = request.headers.get("CF-Connecting-IP")
    if cf_ip:
        return cf_ip.strip()
    # Mirror slowapi.util.get_remote_address's None fallback.
    return request.client.host if request.client else "127.0.0.1"
