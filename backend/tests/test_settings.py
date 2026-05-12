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


def test_effective_etl_database_url_prefers_azure(monkeypatch):
    """ETL_DATABASE_URL_AZURE wins over every other URL."""
    monkeypatch.delenv("ETL_DATABASE_URL", raising=False)
    monkeypatch.delenv("ETL_DATABASE_URL_AZURE", raising=False)
    s = Settings(
        _env_file=None,
        database_url="postgresql://api/db",
        database_url_azure="postgresql://api-azure/db",
        etl_database_url="postgresql://etl/db",
        etl_database_url_azure="postgresql://etl-azure/db",
    )
    assert s.effective_etl_database_url == "postgresql://etl-azure/db"


def test_effective_etl_database_url_falls_back_to_local_etl(monkeypatch):
    """Without an azure ETL URL, the local ETL_DATABASE_URL wins."""
    monkeypatch.delenv("ETL_DATABASE_URL", raising=False)
    monkeypatch.delenv("ETL_DATABASE_URL_AZURE", raising=False)
    s = Settings(
        _env_file=None,
        database_url="postgresql://api/db",
        database_url_azure="postgresql://api-azure/db",
        etl_database_url="postgresql://etl/db",
    )
    assert s.effective_etl_database_url == "postgresql://etl/db"


def test_effective_etl_database_url_falls_back_to_api_url(monkeypatch):
    """With no ETL URL set at all, ETL reuses the API URL.

    Lets local dev / integration tests get away with a single URL —
    the split only matters in prod where the API role is read-only.
    """
    monkeypatch.delenv("ETL_DATABASE_URL", raising=False)
    monkeypatch.delenv("ETL_DATABASE_URL_AZURE", raising=False)
    s = Settings(
        _env_file=None,
        database_url="postgresql://api/db",
        database_url_azure="postgresql://api-azure/db",
    )
    # effective_database_url already prefers azure → that's what ETL gets
    assert s.effective_etl_database_url == "postgresql://api-azure/db"


def test_effective_etl_database_url_pure_local(monkeypatch):
    """When nothing azure is set, ETL falls all the way back to DATABASE_URL."""
    monkeypatch.delenv("ETL_DATABASE_URL", raising=False)
    monkeypatch.delenv("ETL_DATABASE_URL_AZURE", raising=False)
    monkeypatch.delenv("DATABASE_URL_AZURE", raising=False)
    s = Settings(
        _env_file=None,
        database_url="postgresql://local/db",
    )
    assert s.effective_etl_database_url == "postgresql://local/db"
