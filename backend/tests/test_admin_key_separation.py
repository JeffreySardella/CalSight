"""Tests for the ADMIN_API_KEY / ETL_API_KEY split (issue #300)."""

from app.settings import Settings


def test_admin_key_falls_back_to_etl_key():
    s = Settings(etl_api_key="etl-secret", admin_api_key="")
    assert s.effective_admin_key == "etl-secret"


def test_distinct_admin_key_wins():
    s = Settings(etl_api_key="etl-secret", admin_api_key="admin-secret")
    assert s.effective_admin_key == "admin-secret"


def test_no_keys_configured():
    s = Settings(etl_api_key="", admin_api_key="")
    assert s.effective_admin_key == ""
