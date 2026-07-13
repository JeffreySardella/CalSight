"""Middleware ordering: CORS must wrap the inner middleware so that early
error responses (e.g. a 400 from null-byte sanitization) still carry the
Access-Control-Allow-Origin header. Otherwise a browser sees an opaque CORS
failure instead of the real status/body. See audit L4.

These tests need no database: null-byte requests short-circuit in middleware
before reaching any route.
"""

from fastapi.testclient import TestClient

from app.main import app
from app.settings import settings

client = TestClient(app)

CONFIGURED_ORIGIN = settings.cors_origin_list[0]


def test_null_byte_400_carries_cors_headers():
    """A 400 from NullByteSanitizationMiddleware must include CORS headers when
    an allowed Origin is sent — proving CORS is the outermost middleware."""
    resp = client.get(
        "/api/health?county=%00evil",
        headers={"Origin": CONFIGURED_ORIGIN},
    )
    assert resp.status_code == 400
    assert "null byte" in resp.json()["detail"].lower()
    assert resp.headers.get("access-control-allow-origin") == CONFIGURED_ORIGIN


def test_null_byte_400_still_has_security_headers():
    """SecurityHeaders behavior must be preserved on the early 400."""
    resp = client.get(
        "/api/health?county=%00evil",
        headers={"Origin": CONFIGURED_ORIGIN},
    )
    assert resp.status_code == 400
    assert resp.headers.get("X-Content-Type-Options") == "nosniff"
    assert resp.headers.get("X-Frame-Options") == "DENY"


def test_null_byte_still_returns_400_without_origin():
    """Sanity: the null-byte guard itself is unchanged."""
    resp = client.get("/api/health?county=%00evil")
    assert resp.status_code == 400
    assert "null byte" in resp.json()["detail"].lower()
