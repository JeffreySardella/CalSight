"""Amended-crash regression tests for the upsert's derived columns.

CHP amends CCRS records after first publication — most importantly when a
victim dies within 30 days and number_killed goes 0 -> 1. The nightly upsert
re-loads the current and previous year, but the derived columns (severity and
the crash_datetime extracts) were historically written only by NULL-guarded
backfills, so an amended row kept its stale derived values forever: a fatal
crash stayed 'Property Damage Only' in every severity filter and matview.

These tests exercise the real ON CONFLICT path against Postgres.
"""

from datetime import datetime

import pytest
from sqlalchemy import text

from app.models import Crash
from etl.load_crashes import upsert_crashes

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def _cleanup_test_crash(db_session):
    """repair_drifted_derived commits per year (module style), which ends the
    conftest's rollback-isolation transaction — so remove the test crash
    explicitly and commit, restoring the shared test DB either way."""
    yield
    db_session.execute(text(
        "DELETE FROM crashes WHERE collision_id = 999000111"
    ))
    db_session.commit()


def _loader_row(**overrides) -> dict:
    """A row shaped like the CCRS loader produces (keys = _UPSERT_COLUMNS + key)."""
    row = {
        "collision_id": 999_000_111,
        "crash_datetime": datetime(2026, 3, 14, 21, 30),
        "day_of_week": "Saturday",
        "county_code": 19,
        "city_name": None,
        "city_id": None,
        "latitude": 34.05,
        "longitude": -118.24,
        "collision_type": "Rear End",
        "primary_factor": "Speeding",
        "motor_vehicle_involved_with": "Other Motor Vehicle",
        "number_killed": 0,
        "number_injured": 0,
        "weather": "Clear",
        "road_condition": "Dry",
        "lighting": "Dark",
        "is_highway": False,
        "is_freeway": False,
        "primary_road": "MAIN ST",
        "secondary_road": "1ST ST",
        "hit_run": None,
        "pedestrian_involved": False,
        "data_source": "ccrs",
    }
    row.update(overrides)
    return row


def _seed_backfilled_crash(db_session, **overrides) -> None:
    """Insert a crash in its post-backfill state (derived columns populated)."""
    # The session-scoped seed inserts crashes with explicit ids, which leaves
    # the sequence behind — advance it so this insert doesn't collide.
    db_session.execute(text(
        "SELECT setval('crashes_id_seq', (SELECT COALESCE(MAX(id), 1) FROM crashes))"
    ))
    base = _loader_row(**overrides)
    dt = base["crash_datetime"]
    db_session.add(Crash(
        **base,
        severity="Property Damage Only",
        crash_year=dt.year,
        crash_month=dt.month,
        crash_hour=dt.hour,
        day_of_week_num=dt.weekday(),
    ))
    db_session.flush()


def _fetch(db_session, collision_id: int) -> Crash:
    db_session.expire_all()
    return (
        db_session.query(Crash)
        .filter(Crash.collision_id == collision_id, Crash.data_source == "ccrs")
        .one()
    )


class TestAmendedCrashSeverity:
    def test_death_amendment_upgrades_severity_to_fatal(self, db_session):
        _seed_backfilled_crash(db_session)

        upsert_crashes(db_session, [_loader_row(number_killed=1)])

        crash = _fetch(db_session, 999_000_111)
        assert crash.number_killed == 1
        assert crash.severity == "Fatal"

    def test_injury_amendment_upgrades_severity_to_injury(self, db_session):
        _seed_backfilled_crash(db_session)

        upsert_crashes(db_session, [_loader_row(number_injured=2)])

        crash = _fetch(db_session, 999_000_111)
        assert crash.severity == "Injury"

    def test_unamended_row_keeps_severity(self, db_session):
        _seed_backfilled_crash(db_session)

        upsert_crashes(db_session, [_loader_row()])

        crash = _fetch(db_session, 999_000_111)
        assert crash.severity == "Property Damage Only"

    def test_null_counts_mean_property_damage_only(self, db_session):
        # CCRS sometimes reports null counts; the backfill treats null as 0.
        _seed_backfilled_crash(db_session)

        upsert_crashes(
            db_session, [_loader_row(number_killed=None, number_injured=None)]
        )

        crash = _fetch(db_session, 999_000_111)
        assert crash.severity == "Property Damage Only"


class TestAmendedCrashDatetimeExtracts:
    def test_corrected_datetime_recomputes_extract_columns(self, db_session):
        _seed_backfilled_crash(db_session)

        # CHP corrects the crash to New Year's Eve 2025, 23:05 (a Wednesday).
        corrected = datetime(2025, 12, 31, 23, 5)
        upsert_crashes(db_session, [_loader_row(crash_datetime=corrected)])

        crash = _fetch(db_session, 999_000_111)
        assert crash.crash_year == 2025
        assert crash.crash_month == 12
        assert crash.crash_hour == 23
        assert crash.day_of_week_num == 2  # 0=Mon .. 2=Wed


class TestRepairDriftedDerived:
    """One-shot + nightly self-heal for rows amended BEFORE the upsert learned
    to recompute derived columns: severity and the crash_datetime extracts can
    disagree with the raw values they derive from. The repair must fix exactly
    the drifted rows and leave consistent rows untouched."""

    def test_repairs_severity_that_disagrees_with_counts(self, db_session):
        from etl.backfill_derived import repair_drifted_derived

        # Prod state left by the old upsert: killed=1 but severity still PDO.
        _seed_backfilled_crash(db_session, number_killed=1)

        repaired = repair_drifted_derived(db_session)

        crash = _fetch(db_session, 999_000_111)
        assert crash.severity == "Fatal"
        assert repaired >= 1

    def test_repairs_stale_datetime_extracts(self, db_session):
        from etl.backfill_derived import repair_drifted_derived

        # crash_datetime was corrected but the extract columns kept old values.
        _seed_backfilled_crash(db_session)
        db_session.execute(text(
            "UPDATE crashes SET crash_year = 2020, crash_month = 1, "
            "crash_hour = 4, day_of_week_num = 0 "
            "WHERE collision_id = 999000111 AND data_source = 'ccrs'"
        ))
        db_session.flush()

        repair_drifted_derived(db_session)

        crash = _fetch(db_session, 999_000_111)
        assert crash.crash_year == 2026
        assert crash.crash_month == 3
        assert crash.crash_hour == 21
        assert crash.day_of_week_num == 5  # 2026-03-14 is a Saturday

    def test_consistent_rows_are_not_rewritten(self, db_session):
        from etl.backfill_derived import repair_drifted_derived

        _seed_backfilled_crash(db_session)  # PDO with 0/0 counts — consistent

        repaired = repair_drifted_derived(db_session)

        assert repaired == 0
        crash = _fetch(db_session, 999_000_111)
        assert crash.severity == "Property Damage Only"
