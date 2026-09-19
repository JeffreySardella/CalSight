"""apply_year against real Postgres: folded ids, SWITRS only, idempotent."""

import sqlite3
from datetime import datetime

import pytest
from sqlalchemy import text

from app.models import Crash
from etl.backfill_switrs_ksi import apply_year, read_severe_counts
from etl.switrs_api import _fold_case_id

pytestmark = pytest.mark.integration

BIG = 9_234_567_890_123_456_789
FOLDED = _fold_case_id(BIG)


@pytest.fixture(autouse=True)
def _cleanup(db_session):
    """apply_year commits per batch, so restore the shared test DB explicitly."""
    yield
    db_session.execute(text("DELETE FROM crashes WHERE collision_id = :c"), {"c": FOLDED})
    db_session.execute(text(
        "UPDATE crashes SET number_severe_injured = 0 WHERE collision_id = 100"
    ))
    db_session.commit()


def test_update_targets_folded_id_switrs_only_and_is_idempotent(db_session):
    db_session.execute(text(
        "SELECT setval('crashes_id_seq', (SELECT COALESCE(MAX(id), 1) FROM crashes))"
    ))
    db_session.add(Crash(
        collision_id=FOLDED, data_source="switrs",
        crash_datetime=datetime(2001, 12, 31, 8, 0), crash_year=2001,
        county_code=19, number_killed=0, number_injured=2, severity="Injury",
    ))
    db_session.flush()

    archive = sqlite3.connect(":memory:")
    archive.execute("CREATE TABLE collisions (case_id TEXT, collision_date TEXT, severe_injury_count INTEGER)")
    archive.executemany("INSERT INTO collisions VALUES (?, ?, ?)", [
        (str(BIG), "2001-12-31", 2),
        ("424242", "2001-06-01", 1),  # no such crash: unmatched
    ])
    counts = read_severe_counts(archive, 2001)
    # Seeded collision_id 100 exists as BOTH switrs (2015) and ccrs (2022).
    counts[100] = 3

    written, matched, severe_sum = apply_year(db_session, counts)
    assert (written, matched, severe_sum) == (2, 2, 5)

    stored = dict(db_session.execute(text(
        "SELECT data_source, number_severe_injured FROM crashes WHERE collision_id = 100"
    )).all())
    assert stored == {"switrs": 3, "ccrs": 0}

    assert apply_year(db_session, counts) == (0, 2, 5)  # re-run writes nothing
