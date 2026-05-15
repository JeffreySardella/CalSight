"""Application settings powered by pydantic-settings.

How it works:
  1. BaseSettings reads values from environment variables automatically.
     A field named `database_url` maps to the env var `DATABASE_URL`.
  2. If a .env file exists, values are loaded from it (via python-dotenv).
  3. Real environment variables always override .env file values — so
     Docker/Azure env vars win over local .env defaults.
  4. If a required variable is missing AND has no default, the app crashes
     at startup with a clear validation error instead of failing later.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # Look for .env file in the backend/ directory (one level up from app/)
        env_file=".env",
        # If a real env var exists, it beats the .env file value
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # -- Database --
    database_url: str = "postgresql://calsight:calsight_dev@localhost:5433/calsight"

    # Azure connection string. If set in .env, we use this instead of
    # the local default above. The shared .env is posted in Discord so
    # everyone queries the same loaded 25M-row dataset. If it's missing
    # (or empty) the app falls back to the local Postgres URL so a fresh
    # clone of the repo still boots against `docker compose up db`.
    #
    # In production both DATABASE_URL and DATABASE_URL_AZURE point at a
    # read-only Postgres role — ETL/alembic use ETL_DATABASE_URL[_AZURE]
    # below, which carries DDL + write permissions. See
    # backend/sql/create_readonly_role.sql.
    database_url_azure: str = ""

    # ETL connection: full read/write/DDL access. Used by every ETL
    # loader (via app.database.EtlSessionLocal) and by alembic
    # migrations. The API never touches this engine — it stays on the
    # read-only `database_url[_azure]` pair so a compromised dependency
    # can't run destructive SQL.
    #
    # Both fields are optional: if neither is set we fall back to the
    # API URL. That keeps local dev and integration tests one-URL
    # simple — the split only matters in production where the API role
    # is genuinely read-only.
    etl_database_url: str = ""
    etl_database_url_azure: str = ""

    # -- CORS --
    # Comma-separated origins, e.g. "http://localhost:5173,https://calsight.example.com"
    cors_origins: str = "http://localhost:5173"

    # -- Census --
    census_api_key: str = ""

    # -- NOAA --
    noaa_api_token: str = ""

    # -- BLS (Bureau of Labor Statistics) --
    bls_api_key: str = ""

    # -- App --
    debug: bool = False
    etl_api_key: str = ""

    # -- LLM (AI insight card generation) --
    # Supports: groq | openrouter | together | cerebras | ollama
    # Leave llm_model / llm_base_url empty to use provider defaults.
    # For ollama over Tailscale, set llm_base_url to the Tailscale IP.
    llm_provider: str = "together"
    llm_api_key: str = ""
    llm_api_key_2: str = ""
    llm_model: str = ""
    llm_base_url: str = ""
    llm_fallback_1_provider: str = ""
    llm_fallback_1_key: str = ""
    llm_fallback_2_provider: str = ""
    llm_fallback_2_key: str = ""
    llm_fallback_3_provider: str = ""
    llm_fallback_3_key: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        """Parse the comma-separated CORS_ORIGINS string into a list."""
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def effective_database_url(self) -> str:
        """Pick which database URL to actually connect to.

        If DATABASE_URL_AZURE is set in .env, we use that (team default —
        everyone queries the shared 25M-row dataset). If it's missing or
        empty, we fall back to DATABASE_URL so `docker compose up db` and
        fresh clones still boot without extra setup.
        """
        if self.database_url_azure:
            return self.database_url_azure
        return self.database_url

    @property
    def effective_etl_database_url(self) -> str:
        """Pick the URL ETL + alembic should use.

        Priority: ETL_DATABASE_URL_AZURE > ETL_DATABASE_URL > the API
        URL. The fallback to the API URL means local dev / tests work
        without setting a second variable — the split only matters in
        prod where the API role is read-only and ETL needs DDL.
        """
        if self.etl_database_url_azure:
            return self.etl_database_url_azure
        if self.etl_database_url:
            return self.etl_database_url
        return self.effective_database_url


# Single instance — import this everywhere instead of creating new Settings()
settings = Settings()
