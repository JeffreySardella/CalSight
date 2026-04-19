"""Integration-test fixtures: dedicated Postgres DB, seed data, FastAPI client."""

import os
from datetime import datetime
from pathlib import Path

# CRITICAL: override DATABASE_URL BEFORE importing anything from `app`.
# app.settings reads it at import time (pydantic-settings), and
# app.database.engine is constructed from that value — so if we import
# app before setting this, the tests would run against the default URL
# (Azure) instead of the local test DB.
TEST_DB_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql://calsight:calsight_dev@localhost:5433/calsight_test",
)
ADMIN_URL = os.environ.get(
    "TEST_DATABASE_ADMIN_URL",
    "postgresql://calsight:calsight_dev@localhost:5433/postgres",
)
os.environ["DATABASE_URL"] = TEST_DB_URL

import pytest  # noqa: E402
from alembic import command as alembic_command  # noqa: E402
from alembic.config import Config as AlembicConfig  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import Session, sessionmaker  # noqa: E402

from app.database import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import (  # noqa: E402
    CalenviroScreen,
    County,
    Crash,
    CrashParty,
    CrashVictim,
    DataQualityStat,
    Demographic,
    EtlRun,
    Hospital,
    LicensedDriver,
    RoadMile,
    SchoolLocation,
    SpeedLimit,
    TrafficVolume,
    UnemploymentRate,
    VehicleRegistration,
)


def _create_test_db() -> None:
    admin = create_engine(ADMIN_URL, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text("DROP DATABASE IF EXISTS calsight_test"))
        conn.execute(text("CREATE DATABASE calsight_test"))
    admin.dispose()


def _run_alembic_migrations() -> None:
    cfg_path = Path(__file__).parents[2] / "alembic.ini"
    cfg = AlembicConfig(str(cfg_path))
    cfg.set_main_option("sqlalchemy.url", TEST_DB_URL)
    alembic_command.upgrade(cfg, "head")


def _seed(session: Session) -> None:
    # 5 counties
    counties = [
        County(code=1, name="Alameda", fips="06001", latitude=37.65, longitude=-121.91, population=1650000, land_area_sq_miles=738.0, geojson="{}"),
        County(code=19, name="Los Angeles", fips="06037", latitude=34.31, longitude=-118.22, population=9861000, land_area_sq_miles=4058.0, geojson="{}"),
        County(code=30, name="Orange", fips="06059", latitude=33.70, longitude=-117.76, population=3186000, land_area_sq_miles=791.0, geojson="{}"),
        County(code=34, name="Sacramento", fips="06067", latitude=38.47, longitude=-121.34, population=1555000, land_area_sq_miles=964.0, geojson="{}"),
        County(code=38, name="San Francisco", fips="06075", latitude=37.77, longitude=-122.45, population=873965, land_area_sq_miles=46.9, geojson="{}"),
    ]
    session.add_all(counties)
    session.flush()

    # 5 crashes: 2 SWITRS pre-2016, 3 CCRS with alcohol/distraction flags.
    # IMPORTANT: include a SWITRS and CCRS crash with the SAME collision_id
    # to lock in the (collision_id, data_source) join-safety test.
    crashes = [
        Crash(id=1, collision_id=100, data_source="switrs",
              crash_datetime=datetime(2015, 6, 1, 14, 0), county_code=19,
              crash_year=2015, crash_hour=14, severity="Fatal",
              canonical_cause="dui", number_killed=1, number_injured=0,
              county_name="Los Angeles", latitude=34.0, longitude=-118.0,
              is_alcohol_involved=None, is_distraction_involved=None),
        Crash(id=2, collision_id=200, data_source="switrs",
              crash_datetime=datetime(2014, 1, 15, 9, 0), county_code=19,
              crash_year=2014, crash_hour=9, severity="Injury",
              canonical_cause="speeding", number_killed=0, number_injured=2,
              county_name="Los Angeles", latitude=34.1, longitude=-118.1,
              is_alcohol_involved=None, is_distraction_involved=None),
        Crash(id=3, collision_id=100, data_source="ccrs",
              crash_datetime=datetime(2022, 3, 10, 22, 0), county_code=19,
              crash_year=2022, crash_hour=22, severity="Fatal",
              canonical_cause="dui", number_killed=1, number_injured=1,
              county_name="Los Angeles", latitude=34.05, longitude=-118.05,
              is_alcohol_involved=True, is_distraction_involved=False),
        Crash(id=4, collision_id=300, data_source="ccrs",
              crash_datetime=datetime(2023, 7, 4, 16, 30), county_code=30,
              crash_year=2023, crash_hour=16, severity="Injury",
              canonical_cause="lane_change", number_killed=0, number_injured=3,
              county_name="Orange", latitude=33.7, longitude=-117.8,
              is_alcohol_involved=False, is_distraction_involved=True),
        Crash(id=5, collision_id=400, data_source="ccrs",
              crash_datetime=datetime(2023, 12, 31, 23, 45), county_code=38,
              crash_year=2023, crash_hour=23, severity="Property Damage Only",
              canonical_cause="other", number_killed=0, number_injured=0,
              county_name="San Francisco", latitude=37.77, longitude=-122.45,
              is_alcohol_involved=False, is_distraction_involved=False),
    ]
    session.add_all(crashes)

    session.add_all([
        Demographic(county_code=19, year=2023, population=9861000,
                    median_age=37.5, median_income=82000, poverty_rate=13.4,
                    population_density=2431.0),
        Demographic(county_code=30, year=2023, population=3186000,
                    median_age=38.9, median_income=102000, poverty_rate=9.8,
                    population_density=4028.0),
    ])

    session.add_all([
        Hospital(facility_id="HSP001", facility_name="UCLA Medical",
                 facility_type="General Acute Care Hospital", county_code=19,
                 city="Los Angeles", trauma_center="Level I", status="OPEN",
                 latitude=34.07, longitude=-118.45),
        SchoolLocation(cds_code="19000000000001", school_name="Venice High",
                       county_code=19, city="Los Angeles", school_type="High",
                       status="Active", latitude=33.99, longitude=-118.47),
        CalenviroScreen(county_code=19, ces_score=45.0, ces_percentile=78.0,
                        pollution_burden=60.0, pop_characteristics=55.0,
                        ozone_score=7.0, diesel_pm_score=6.0,
                        pesticide_score=2.0, traffic_score=9.0),
        TrafficVolume(county_code=19, total_aadt=1500000, segment_count=250,
                      avg_aadt_per_segment=6000),
        SpeedLimit(county_code=19, speed_limit=55, segment_count=40,
                   avg_lanes=3.5, total_aadt=450000),
        RoadMile(county_code=19, f_system=1, segment_count=20, total_miles=75.5),
        UnemploymentRate(county_code=19, year=2023, month=6,
                         unemployment_rate=4.7),
        VehicleRegistration(county_code=19, year=2023,
                            total_vehicles=6200000, ev_vehicles=310000),
        LicensedDriver(county_code=19, year=2023, driver_count=5800000),
        DataQualityStat(county_code=19, year=2023, total_crashes=500000,
                        crashes_with_coords=480000, coords_pct=96.0),
        DataQualityStat(county_code=19, year=None, total_crashes=4200000,
                        crashes_with_coords=4000000, coords_pct=95.2),
    ])

    session.add_all([
        EtlRun(source="ccrs", status="success", rows_loaded=4350202,
               started_at=datetime(2026, 4, 15, 3, 0),
               finished_at=datetime(2026, 4, 15, 4, 0)),
        EtlRun(source="switrs", status="success", rows_loaded=6779445,
               started_at=datetime(2026, 4, 15, 3, 0),
               finished_at=datetime(2026, 4, 15, 3, 45)),
    ])

    # Crash parties — only for CCRS crashes (3, 4, 5). SWITRS has no party data.
    # Crash 3 (collision_id=100, ccrs): 2 parties — at-fault drunk male, female passenger driver
    # Crash 4 (collision_id=300, ccrs): 1 party — distracted male driver, at-fault
    # Crash 5 (collision_id=400, ccrs): 1 party — sober female driver
    session.add_all([
        CrashParty(party_id=1001, collision_id=100, data_source="ccrs",
                   party_number=1, party_type="Driver", at_fault=True,
                   gender="M", age=42, sobriety="HBD", vehicle_type="Sedan",
                   movement="Proceeding Straight"),
        CrashParty(party_id=1002, collision_id=100, data_source="ccrs",
                   party_number=2, party_type="Driver", at_fault=False,
                   gender="F", age=29, sobriety="Not Impaired",
                   vehicle_type="SUV", movement="Stopped"),
        CrashParty(party_id=1003, collision_id=300, data_source="ccrs",
                   party_number=1, party_type="Driver", at_fault=True,
                   gender="M", age=22, sobriety="Not Impaired",
                   cell_phone_use="In Use", vehicle_type="Sedan",
                   movement="Changing Lanes"),
        CrashParty(party_id=1004, collision_id=400, data_source="ccrs",
                   party_number=1, party_type="Driver", at_fault=False,
                   gender="F", age=55, sobriety="Not Impaired",
                   vehicle_type="Pickup", movement="Backing"),
    ])

    # Crash victims — same scope (CCRS only).
    # Crash 3: 1 fatal driver, 1 injured passenger
    # Crash 4: 3 injured passengers
    # Crash 5: no victims (PDO crash had no injuries)
    session.add_all([
        CrashVictim(victim_id=2001, collision_id=100, data_source="ccrs",
                    party_number=1, age=42, gender="M",
                    injury_severity="Fatal", person_type="Driver",
                    safety_equipment="None", ejected="NotEjected"),
        CrashVictim(victim_id=2002, collision_id=100, data_source="ccrs",
                    party_number=2, age=33, gender="F",
                    injury_severity="Severe", person_type="Passenger",
                    safety_equipment="Lap+Shoulder Belt", ejected="NotEjected"),
        CrashVictim(victim_id=2003, collision_id=300, data_source="ccrs",
                    party_number=1, age=18, gender="F",
                    injury_severity="Possible", person_type="Passenger",
                    safety_equipment="Lap+Shoulder Belt"),
        CrashVictim(victim_id=2004, collision_id=300, data_source="ccrs",
                    party_number=1, age=20, gender="M",
                    injury_severity="Possible", person_type="Passenger",
                    safety_equipment="Lap+Shoulder Belt"),
        CrashVictim(victim_id=2005, collision_id=300, data_source="ccrs",
                    party_number=1, age=45, gender="M",
                    injury_severity="Severe", person_type="Pedestrian",
                    safety_equipment=None),
    ])

    session.commit()

    # Refresh the materialized views so /api/stats tests see data.
    session.execute(text("REFRESH MATERIALIZED VIEW mv_crashes_by_year"))
    session.execute(text("REFRESH MATERIALIZED VIEW mv_crashes_by_cause"))
    session.execute(text("REFRESH MATERIALIZED VIEW mv_crashes_by_hour"))
    session.execute(text("REFRESH MATERIALIZED VIEW mv_crash_victims_by_demographics"))
    session.commit()


@pytest.fixture(scope="session")
def test_engine():
    _create_test_db()
    _run_alembic_migrations()
    engine = create_engine(TEST_DB_URL)

    SessionLocal = sessionmaker(bind=engine)
    session = SessionLocal()
    _seed(session)
    session.close()

    yield engine
    engine.dispose()


@pytest.fixture()
def db_session(test_engine):
    """Per-test transactional session, rolled back at teardown."""
    connection = test_engine.connect()
    trans = connection.begin()
    SessionLocal = sessionmaker(bind=connection)
    session = SessionLocal()
    yield session
    session.close()
    trans.rollback()
    connection.close()


@pytest.fixture()
def client(db_session):
    """TestClient with get_db overridden to use the transactional session."""
    def override_get_db():
        try:
            yield db_session
        finally:
            pass
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
