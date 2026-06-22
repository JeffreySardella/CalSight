from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.settings import settings

# API engine. In production this points at a read-only Postgres role
# (see backend/sql/create_readonly_role.sql). Sized for the FastAPI
# request load — every router shares this pool via get_db().
engine = create_engine(
    settings.effective_database_url,
    pool_size=20,
    max_overflow=20,
    pool_recycle=3600,
    pool_pre_ping=True,
)
SessionLocal = sessionmaker(bind=engine)

# ETL / alembic engine. Carries DDL + write permissions in production.
# Falls back to the API URL when ETL_DATABASE_URL* aren't set (local
# dev, integration tests) — see settings.effective_etl_database_url.
# Smaller pool because ETL is single-threaded; one connection at a
# time.
etl_engine = create_engine(
    settings.effective_etl_database_url,
    pool_size=1,
    max_overflow=1,
    pool_recycle=3600,
    pool_pre_ping=True,
)
EtlSessionLocal = sessionmaker(bind=etl_engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
