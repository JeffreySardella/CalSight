from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.settings import settings

engine = create_engine(
    settings.effective_database_url,
    pool_size=20,
    max_overflow=20,
    pool_recycle=3600,
    pool_pre_ping=True,
)
SessionLocal = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
