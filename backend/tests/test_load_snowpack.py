"""Tests for the snowpack ETL — station sync, FK filtering, dedup, batching.
Mocked session, matching the other loader suites."""

import logging
from collections import Counter
from datetime import date, timedelta
from unittest import mock
from unittest.mock import MagicMock

from etl.cdec_api import (
    MAJOR_SNOW_STATIONS,
    SENSOR_SNOW_WATER_CONTENT,
    SNOW_REGION_CENTRAL,
    SNOW_REGION_NORTH,
    SNOW_REGION_SOUTH,
    Observation,
)
from etl import load_snowpack as mod
from etl.load_snowpack import (
    BATCH_SIZE,
    MAX_PLAUSIBLE_SWE_IN,
    delete_implausible,
    upsert_observations,
    upsert_stations,
)


class TestDeleteImplausible:
    def test_deletes_stored_spikes_and_commits(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.delete.return_value = 3
        assert delete_implausible(db) == 3
        db.query.return_value.filter.return_value.delete.assert_called_once_with(
            synchronize_session=False
        )
        db.commit.assert_called_once()


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

    def test_carries_station_coordinates(self):
        # CSL's staMeta coordinates travel with the upsert row, same as the
        # reservoir loader's.
        db = MagicMock()
        upsert_stations(db)
        values = db.execute.call_args.args[0].compile().params
        csl = MAJOR_SNOW_STATIONS["CSL"]
        assert csl["lat"] in values.values()
        assert csl["lon"] in values.values()

    def test_station_without_coordinates_loads_as_null_and_warns(self, caplog):
        # A future map entry added without staMeta coordinates must not fail
        # the job — it stores NULLs and logs one warning naming the station.
        db = MagicMock()
        patched = dict(MAJOR_SNOW_STATIONS)
        patched["ZZZ"] = {
            "name": "No Coords",
            "elevation_ft": 1234,
            "region": SNOW_REGION_NORTH,
        }
        with mock.patch.dict(mod.MAJOR_SNOW_STATIONS, patched, clear=True):
            with caplog.at_level(logging.WARNING):
                count = upsert_stations(db)

        assert count == len(MAJOR_SNOW_STATIONS) + 1
        assert "ZZZ" in caplog.text and "NULL" in caplog.text
        # Only the coordinate-less station is warned about.
        assert caplog.text.count("no staMeta coordinates") == 1

    def test_every_station_has_plausible_coordinates(self):
        # Coordinates come from each station's CDEC staMeta page; a typo'd
        # or swapped lat/lon would drop a marker into the ocean or Utah.
        # The east edge is generous on purpose: DWR tracks three Tahoe-basin
        # sensors (BMW, MRL, MSK) that sit just inside Nevada.
        for station_id, meta in MAJOR_SNOW_STATIONS.items():
            lat, lon = meta["lat"], meta["lon"]
            assert 32.5 <= lat <= 42.0, f"{station_id}: lat {lat} implausible"
            assert -124.5 <= lon <= -118.0, f"{station_id}: lon {lon} implausible"

    def test_matches_dwr_official_station_lists(self):
        # Pinned to CDEC's sweq.action "Stations included" as of 2026-09-12
        # (LVT counted once, in CENTRAL). If DWR changes its list, update
        # the map AND this test together — the percents are only comparable
        # to DWR's published figures while the station sets agree.
        counts = Counter(m["region"] for m in MAJOR_SNOW_STATIONS.values())
        assert counts == {SNOW_REGION_NORTH: 32, SNOW_REGION_CENTRAL: 54, SNOW_REGION_SOUTH: 24}
        for code, meta in MAJOR_SNOW_STATIONS.items():
            assert len(code) == 3 and code == code.upper()
            assert meta["name"].strip()


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

    def test_drops_swe_above_plausibility_ceiling(self):
        # CDEC's historical feed contains sensor spikes (hundreds of inches);
        # they are dropped entirely, not clamped — there is no true value.
        db = MagicMock()
        count = upsert_observations(
            db, [_obs(day=1, value=MAX_PLAUSIBLE_SWE_IN + 1), _obs(day=2, value=90.0)]
        )
        assert count == 1
        values = db.execute.call_args.args[0].compile().params
        assert 90.0 in values.values()
        assert MAX_PLAUSIBLE_SWE_IN + 1 not in values.values()

    def test_no_execute_for_empty_input(self):
        db = MagicMock()
        assert upsert_observations(db, []) == 0
        db.execute.assert_not_called()

    def test_batches_large_inputs(self):
        db = MagicMock()
        # Values must stay under MAX_PLAUSIBLE_SWE_IN or the ceiling guard
        # drops them and the batch never fills.
        observations = [
            Observation("CSL", SENSOR_SNOW_WATER_CONTENT, date(2000, 1, 1) + timedelta(days=i), float(i % 100), "INCHES")
            for i in range(BATCH_SIZE + 1)
        ]
        upsert_observations(db, observations)
        assert db.execute.call_count == 2
