from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
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
    population = Column(Integer)
    geojson = Column(Text)


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
    county_code = Column(
        SmallInteger, ForeignKey("counties.code"), nullable=False
    )
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

    # Hit and run — null = no, "M" = misdemeanor, "F" = felony
    hit_run = Column(String(1))

    # Pedestrian
    pedestrian_involved = Column(Boolean, default=False)

    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("ix_crashes_county_code", "county_code"),
        Index("ix_crashes_crash_datetime", "crash_datetime"),
        Index("ix_crashes_primary_factor", "primary_factor"),
        Index("ix_crashes_county_datetime", "county_code", "crash_datetime"),
    )


class Demographic(Base):
    """Year-versioned Census Bureau ACS data per county."""

    __tablename__ = "demographics"

    id = Column(Integer, primary_key=True)
    county_code = Column(
        SmallInteger, ForeignKey("counties.code"), nullable=False
    )
    year = Column(SmallInteger, nullable=False)
    population = Column(Integer)
    median_age = Column(Float)
    median_income = Column(Integer)
    commute_drive_alone_pct = Column(Float)
    commute_carpool_pct = Column(Float)
    commute_transit_pct = Column(Float)
    commute_walk_pct = Column(Float)
    commute_bike_pct = Column(Float)
    commute_wfh_pct = Column(Float)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("county_code", "year"),
        Index("ix_demographics_year", "year"),
    )


class CountyInsight(Base):
    """Pre-computed summary stats and AI narrative per county per year."""

    __tablename__ = "county_insights"

    id = Column(Integer, primary_key=True)
    county_code = Column(
        SmallInteger, ForeignKey("counties.code"), nullable=False
    )
    year = Column(SmallInteger, nullable=False)
    total_crashes = Column(Integer)
    total_killed = Column(SmallInteger)
    total_injured = Column(Integer)
    crash_rate_per_capita = Column(Float)
    top_cause = Column(String(100))
    top_cause_pct = Column(Float)
    yoy_change_pct = Column(Float)
    peak_hour = Column(SmallInteger)
    dui_pct = Column(Float)
    narrative = Column(Text)
    generated_at = Column(DateTime)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (UniqueConstraint("county_code", "year"),)


class CountyInsightDetail(Base):
    """Granular breakdowns per county/year by category (collision type, cause, etc.)."""

    __tablename__ = "county_insight_details"

    id = Column(Integer, primary_key=True)
    county_code = Column(
        SmallInteger, ForeignKey("counties.code"), nullable=False
    )
    year = Column(SmallInteger, nullable=False)
    category = Column(String(30), nullable=False)
    label = Column(String(100), nullable=False)
    count = Column(Integer)
    pct_of_total = Column(Float)
    yoy_change_pct = Column(Float)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("county_code", "year", "category", "label"),
    )


class EtlRun(Base):
    """Tracks ETL pipeline execution — one row per source per run."""

    __tablename__ = "etl_runs"

    id = Column(Integer, primary_key=True)
    source = Column(String(20), nullable=False)
    status = Column(String(20), nullable=False)
    started_at = Column(DateTime, nullable=False)
    finished_at = Column(DateTime)
    rows_loaded = Column(Integer)
    error_message = Column(Text)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("ix_etl_runs_source_started_at", "source", "started_at"),
    )
