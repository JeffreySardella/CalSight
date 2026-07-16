"""Tests for the snowpack ETL — station sync, FK filtering, dedup, batching.
Mocked session, matching the other loader suites."""

from datetime import date, timedelta
from unittest.mock import MagicMock

from etl.cdec_api import MAJOR_SNOW_STATIONS, SENSOR_SNOW_WATER_CONTENT, Observation
from etl.load_snowpack import BATCH_SIZE, upsert_observations, upsert_stations


def _obs(station="CSL", day=1, value=12.5):
    return Observation(
        station_id=station,
        sensor=SENSOR_SNOW_WATER_CONTENT,
        date=date(2026, 3, day),
        value=value,
        units="INCHES",
    )


class TestUpsertStations:
    def test_syncs_all_stations(self):
        db = MagicMock()
        assert upsert_stations(db) == len(MAJOR_SNOW_STATIONS)
        assert db.execute.call_count == 1

    def test_metadata_is_well_formed(self):
        for code, meta in MAJOR_SNOW_STATIONS.items():
            assert code == code.upper()
            assert meta["name"]
            assert meta["elevation_ft"] > 0
            assert meta["region"]

    def test_covers_all_three_regions(self):
        regions = {m["region"] for m in MAJOR_SNOW_STATIONS.values()}
        assert len(regions) == 3


class TestUpsertObservations:
    def test_upserts_known_stations(self):
        db = MagicMock()
        assert upsert_observations(db, [_obs(day=1), _obs(day=2)]) == 2
        assert db.execute.call_count == 1

    def test_drops_unknown_stations(self):
        db = MagicMock()
        assert upsert_observations(db, [_obs(station="ZZZ"), _obs()]) == 1

    def test_dedupes_same_station_day_keeping_last(self):
        db = MagicMock()
        count = upsert_observations(db, [_obs(day=1, value=10.0), _obs(day=1, value=20.0)])
        assert count == 1
        values = db.execute.call_args.args[0].compile().params
        assert 20.0 in values.values()
        assert 10.0 not in values.values()

    def test_clamps_negative_swe_to_zero(self):
        # Bare snow pillows drift slightly negative (live CDEC returns e.g.
        # -0.1 in July); the loader stores 0.0, never negative snow.
        db = MagicMock()
        assert upsert_observations(db, [_obs(day=1, value=-2.4)]) == 1
        values = db.execute.call_args.args[0].compile().params
        assert 0.0 in values.values()
        assert -2.4 not in values.values()

    def test_no_execute_for_empty_input(self):
        db = MagicMock()
        assert upsert_observations(db, []) == 0
        db.execute.assert_not_called()

    def test_batches_large_inputs(self):
        db = MagicMock()
        observations = [
            Observation("CSL", SENSOR_SNOW_WATER_CONTENT, date(2000, 1, 1) + timedelta(days=i), float(i), "INCHES")
            for i in range(BATCH_SIZE + 1)
        ]
        upsert_observations(db, observations)
        assert db.execute.call_count == 2
