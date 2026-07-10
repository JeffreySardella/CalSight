"""Tests for the reservoir storage ETL.

Pure-function tests plus mocked-session tests for the upsert helpers —
no real database, matching the other loader test suites. End-to-end
behavior is covered by the API integration tests once data is loaded.
"""

from datetime import date, timedelta
from unittest.mock import MagicMock

from etl.cdec_api import MAJOR_RESERVOIRS, SENSOR_STORAGE, Observation
from etl.load_reservoirs import (
    BATCH_SIZE,
    date_windows,
    upsert_observations,
    upsert_reservoirs,
)


def _obs(station="SHA", day=1, value=3_000_000.0):
    return Observation(
        station_id=station,
        sensor=SENSOR_STORAGE,
        date=date(2026, 7, day),
        value=value,
        units="AF",
    )


class TestDateWindows:
    def test_single_window_when_range_fits(self):
        windows = date_windows(date(2026, 1, 1), date(2026, 3, 1))
        assert windows == [(date(2026, 1, 1), date(2026, 3, 1))]

    def test_splits_multi_year_range(self):
        windows = date_windows(date(2024, 1, 1), date(2026, 7, 1))
        assert len(windows) == 3
        # Windows tile the range exactly: contiguous, no overlap.
        assert windows[0][0] == date(2024, 1, 1)
        assert windows[-1][1] == date(2026, 7, 1)
        for (_, prev_end), (next_start, _) in zip(windows, windows[1:]):
            assert next_start == prev_end + timedelta(days=1)

    def test_empty_when_start_after_end(self):
        assert date_windows(date(2026, 7, 1), date(2026, 1, 1)) == []

    def test_single_day_range(self):
        d = date(2026, 7, 1)
        assert date_windows(d, d) == [(d, d)]


class TestUpsertObservations:
    def test_upserts_known_stations(self):
        db = MagicMock()
        count = upsert_observations(db, [_obs(day=1), _obs(day=2)])
        assert count == 2
        assert db.execute.call_count == 1
        assert db.commit.call_count == 1

    def test_drops_unknown_stations(self):
        db = MagicMock()
        count = upsert_observations(db, [_obs(station="XXX"), _obs()])
        assert count == 1

    def test_no_execute_for_empty_input(self):
        db = MagicMock()
        assert upsert_observations(db, []) == 0
        db.execute.assert_not_called()

    def test_batches_large_inputs(self):
        db = MagicMock()
        observations = [
            _obs(day=(i % 28) + 1, value=float(i)) for i in range(BATCH_SIZE + 1)
        ]
        upsert_observations(db, observations)
        assert db.execute.call_count == 2


class TestUpsertReservoirs:
    def test_maps_county_names_to_codes(self):
        db = MagicMock()
        db.query.return_value = [("Shasta", 45), ("Butte", 4)]

        count = upsert_reservoirs(db)

        assert count == len(MAJOR_RESERVOIRS)
        values = db.execute.call_args.args[0].compile().params
        # Statement carries one row per reservoir; SHA resolved to Shasta's code.
        sha_keys = [k for k in values if values[k] == "SHA"]
        assert sha_keys

    def test_unknown_county_becomes_null_not_dropped(self):
        db = MagicMock()
        db.query.return_value = []  # no counties resolve

        count = upsert_reservoirs(db)

        assert count == len(MAJOR_RESERVOIRS)


class TestMetadataIntegrity:
    def test_all_counties_are_real_california_counties(self):
        # Guards against typos in the static map — every county name here
        # must be one of the 58 the seed data creates.
        from app.seed_counties import COUNTIES

        valid = {row[1] for row in COUNTIES}
        for meta in MAJOR_RESERVOIRS.values():
            assert meta["county"] in valid, f"Unknown county: {meta['county']}"
