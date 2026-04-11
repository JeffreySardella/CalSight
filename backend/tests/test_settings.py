from app.settings import Settings


def test_settings_has_census_api_key_field():
    """Settings class should accept a CENSUS_API_KEY env var."""
    s = Settings(census_api_key="test-key-123")
    assert s.census_api_key == "test-key-123"


def test_census_api_key_defaults_to_empty_without_env(monkeypatch):
    """Key is optional so the app doesn't crash without it."""
    monkeypatch.delenv("CENSUS_API_KEY", raising=False)
    s = Settings(_env_file=None)
    assert s.census_api_key == ""
