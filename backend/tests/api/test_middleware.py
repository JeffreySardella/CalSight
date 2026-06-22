"""Integration tests for middleware: null-byte sanitization, security headers, CORS."""

import pytest

pytestmark = pytest.mark.integration


# --- NullByteSanitizationMiddleware ---


def test_null_byte_percent_encoded_in_path_returns_400(client):
    response = client.get("/api/health%00")
    assert response.status_code == 400
    body = response.json()
    assert "null byte" in body["detail"].lower()


def test_null_byte_in_query_returns_400(client):
    response = client.get("/api/health?county=%00evil")
    assert response.status_code == 400


def test_clean_request_passes_through(client):
    response = client.get("/api/health")
    assert response.status_code == 200


# --- SecurityHeadersMiddleware ---


def test_x_content_type_options_present(client):
    response = client.get("/api/health")
    assert response.headers.get("X-Content-Type-Options") == "nosniff"


def test_x_frame_options_present(client):
    response = client.get("/api/health")
    assert response.headers.get("X-Frame-Options") == "DENY"


def test_referrer_policy_present(client):
    response = client.get("/api/health")
    assert response.headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"


def test_security_headers_on_error_response(client):
    response = client.get("/api/stats?group_by=nonexistent_field")
    assert response.status_code == 422
    assert response.headers.get("X-Content-Type-Options") == "nosniff"


# --- CORS ---


def test_cors_preflight_returns_allow_headers(client):
    response = client.options(
        "/api/health",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Content-Type",
        },
    )
    assert response.status_code == 200
    assert "GET" in response.headers.get("Access-Control-Allow-Methods", "")


def test_cors_allows_configured_origin(client):
    response = client.get(
        "/api/health",
        headers={"Origin": "http://localhost:5173"},
    )
    assert response.headers.get("Access-Control-Allow-Origin") == "http://localhost:5173"


def test_cors_rejects_unconfigured_origin(client):
    response = client.get(
        "/api/health",
        headers={"Origin": "http://evil.example.com"},
    )
    assert response.headers.get("Access-Control-Allow-Origin") != "http://evil.example.com"
