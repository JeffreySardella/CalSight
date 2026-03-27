from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    Float,
    Index,
    SmallInteger,
    String,
)

from app.database import Base


class County(Base):
    """California county lookup table — 58 counties."""

    __tablename__ = "counties"

    code = Column(SmallInteger, primary_key=True)
    name = Column(String(50), nullable=False, unique=True)
    fips = Column(String(5))
    latitude = Column(Float)
    longitude = Column(Float)


class Crash(Base):
    """
    One row per crash from CCRS data.
    Subset of fields relevant to the dashboard — we skip admin/internal columns.
    """

    __tablename__ = "crashes"

    id = Column(BigInteger, primary_key=True)
    collision_id = Column(BigInteger, nullable=False, unique=True)
    crash_datetime = Column(DateTime, nullable=False)
    day_of_week = Column(String(10))
    county_code = Column(SmallInteger, nullable=False)
    city_name = Column(String(100))
    latitude = Column(Float)
    longitude = Column(Float)

    # What happened
    collision_type = Column(String(50))
    primary_factor = Column(String(100))
    motor_vehicle_involved_with = Column(String(50))

    # Severity
    number_killed = Column(SmallInteger, default=0)
    number_injured = Column(SmallInteger, default=0)

    # Conditions
    weather = Column(String(30))
    road_condition = Column(String(50))
    lighting = Column(String(30))

    # Road info
    is_highway = Column(Boolean, default=False)
    is_freeway = Column(Boolean, default=False)
    primary_road = Column(String(100))
    secondary_road = Column(String(100))

    # Hit and run
    hit_run = Column(Boolean, default=False)

    # Pedestrian
    pedestrian_involved = Column(Boolean, default=False)

    __table_args__ = (
        Index("ix_crashes_county_code", "county_code"),
        Index("ix_crashes_crash_datetime", "crash_datetime"),
        Index("ix_crashes_primary_factor", "primary_factor"),
        Index("ix_crashes_county_datetime", "county_code", "crash_datetime"),
    )
