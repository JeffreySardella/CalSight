"""backfill_severe_injured against real Postgres (CCRS KSI derivation)."""

from datetime import datetime

import pytest
from sqlalchemy import text

from app.models import Crash, CrashVictim
from etl.backfill_derived import backfill_severe_injured

pytestmark = pytest.mark.integration

CID = 999_000_222


@pytest.fixture(autouse=True)
def _cleanup(db_session):
    """The backfill commits per year, so remove the test rows explicitly."""
    yield
    db_session.execute(text("DELETE FROM crash_victims WHERE collision_id = :c"), {"c": CID})
    db_session.execute(text("DELETE FROM crashes WHERE collision_id = :c"), {"c": CID})
    db_session.commit()


def _seed(db_session):
    db_session.execute(text(
        "SELECT setval('crashes_id_seq', (SELECT COALESCE(MAX(id), 1) FROM crashes))"
    ))
    db_session.add(Crash(
        collision_id=CID, data_source="ccrs",
        crash_datetime=datetime(2019, 5, 1, 12, 0), crash_year=2019,
        county_code=19, number_killed=1, number_injured=3, severity="Fatal",
    ))
    for victim_id, sev in [
        (3001, "SuspectSerious"),
        (3002, "SevereInactive"),
        (3003, "SuspectMinor"),
        (3004, "Fatal"),
    ]:
        db_session.add(CrashVictim(
            victim_id=victim_id, collision_id=CID, data_source="ccrs", injury_severity=sev,
        ))
    db_session.flush()


def _stored(db_session) -> int:
    return db_session.execute(text(
        "SELECT number_severe_injured FROM crashes WHERE collision_id = :c AND data_source = 'ccrs'"
    ), {"c": CID}).scalar()


def test_counts_suspect_serious_and_severe_inactive_only(db_session):
    _seed(db_session)
    backfill_severe_injured(db_session)
    assert _stored(db_session) == 2  # SuspectMinor and Fatal excluded


def test_second_run_writes_nothing(db_session):
    _seed(db_session)
    first = backfill_severe_injured(db_session)
    assert first[0] >= 1
    assert backfill_severe_injured(db_session) == (0, 0)


def test_victim_downgraded_from_serious_resets_to_zero(db_session):
    _seed(db_session)
    backfill_severe_injured(db_session)
    db_session.execute(text(
        "UPDATE crash_victims SET injury_severity = 'SuspectMinor' "
        "WHERE collision_id = :c AND injury_severity IN ('SuspectSerious', 'SevereInactive')"
    ), {"c": CID})
    assert backfill_severe_injured(db_session) == (0, 1)
    assert _stored(db_session) == 0


def test_since_year_skips_older_years(db_session):
    _seed(db_session)
    backfill_severe_injured(db_session, since_year=2020)
    assert _stored(db_session) == 0
