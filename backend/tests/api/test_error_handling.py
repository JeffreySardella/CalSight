"""Exception-handler behavior tests."""

import pytest

from app.filters import FilterError

pytestmark = pytest.mark.integration


def test_filter_error_returns_422(client):
    from app.main import app as main_app

    @main_app.get("/api/_test_filter_error")
    def raise_filter_error():
        raise FilterError("severity", "Unknown severity 'foo'.")

    try:
        response = client.get("/api/_test_filter_error")
        assert response.status_code == 422
        assert response.json() == {
            "detail": "Unknown severity 'foo'.",
            "filter": "severity",
        }
    finally:
        main_app.router.routes = [
            r for r in main_app.router.routes
            if getattr(r, "path", "") != "/api/_test_filter_error"
        ]
