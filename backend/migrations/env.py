"""Alembic environment configuration.

This file tells Alembic:
1. How to connect to the database (uses the ETL URL — alembic needs DDL,
   so it can't use the read-only API role)
2. Where to find your models (app.models via Base.metadata)

Alembic compares Base.metadata (what your models say) against the actual
database schema and generates migration files for any differences.
"""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.database import Base
from app.settings import settings

# Import all models so Base.metadata knows about them.
# Without this, autogenerate would see an empty metadata and
# generate a migration that drops all your tables.
import app.models  # noqa: F401

config = context.config
# Use the ETL URL because alembic runs DDL (CREATE TABLE etc.) and the
# API URL points at a read-only role in production. Falls back to the
# API URL locally — see settings.effective_etl_database_url.
config.set_main_option("sqlalchemy.url", settings.effective_etl_database_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Generate SQL without connecting to the database.

    Useful for reviewing migration SQL before applying it.
    Run with: alembic upgrade head --sql
    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations against a live database connection."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            # Give each migration its own transaction so a revision can opt
            # out of transactional DDL via `revision_is_non_transactional`.
            # Without this, Alembic wraps the whole upgrade in one transaction
            # and CREATE INDEX CONCURRENTLY fails with "cannot run inside a
            # transaction block". Non-transactional revisions run in AUTOCOMMIT.
            transaction_per_migration=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
