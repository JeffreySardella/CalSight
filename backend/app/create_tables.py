"""Create all database tables and seed county data."""

from app.database import engine
from app.models import Base
from app.seed_counties import seed


def create_all():
    print("Creating tables...")
    Base.metadata.create_all(engine)
    print("Tables created.")
    seed()


if __name__ == "__main__":
    create_all()
