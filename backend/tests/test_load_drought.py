"""Tests for the drought ETL — FIPS mapping and upsert batching,
with a mocked session, matching the other loader test suites."""

from datetime import date
from unittest.mock import MagicMock

from etl.load_drought import BATCH_SIZE, upsert_drought_weeks
from etl.usdm_api import DroughtWeek


def _week(fips="06067", week=date(2026, 6, 30)):
    return DroughtWeek(fips, week, 10.0, 40.0, 30.0, 20.0, 0.0, 0.0)


def _db(counties=(("06067", 34), ("06037", 19))):
    db = MagicMock()
    db.query.return_value = list(counties)
    return db


class TestUpsertDroughtWeeks:
    def test_maps_fips_to_county_code(self):
        db = _db()
        count = upsert_drought_weeks(db, [_week("06067"), _week("06037")])
        assert count == 2
        assert db.execute.call_count == 1

    def test_drops_unknown_fips(self):
        db = _db()
        count = upsert_drought_weeks(db, [_week("48201"), _week("06067")])
        assert count == 1

    def test_no_execute_for_empty_input(self):
        db = _db()
        assert upsert_drought_weeks(db, []) == 0
        db.execute.assert_not_called()

    def test_skips_counties_with_null_fips(self):
        # A County row with fips=None must not blow up the lookup build.
        db = _db(counties=((None, 1), ("06067", 34)))
        assert upsert_drought_weeks(db, [_week("06067")]) == 1

    def test_batches_large_inputs(self):
        db = _db()
        weeks = [
            _week("06067", date(2005 + i // 52, 1, 1 + (i % 28)))
            for i in range(BATCH_SIZE + 1)
        ]
        upsert_drought_weeks(db, weeks)
        assert db.execute.call_count == 2
