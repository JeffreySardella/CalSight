"""Tests for the Sierra precipitation-index ETL (CDEC 8SI/5SI/6SI).

The precip indices are CDEC's three regional precipitation stations — the
famous 8-Station Index (Northern Sierra) plus the San Joaquin 5-Station and
Tulare Basin 6-Station indices. Sensor 2 reports the accumulated water-year
precipitation total (inches), so the value is already cumulative; the loader
stores it as-is and the API derives percent-of-average-for-this-date the same
way reservoirs and snowpack do.

These tests pin the fetch wiring and the upsert (station filtering + dedupe)
without hitting the network or a database.
"""

from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock

from etl import cdec_api
from etl import load_precip_indices as mod
from etl.cdec_api import (
    PRECIP_INDEX_STATIONS,
    SENSOR_PRECIP_ACCUM,
    Observation,
)


class TestPrecipIndexStations:
    def test_three_regional_indices_present(self):
        assert set(PRECIP_INDEX_STATIONS) == {"8SI", "5SI", "6SI"}

    def test_each_index_has_a_region_and_name(self):
        for meta in PRECIP_INDEX_STATIONS.values():
            assert meta["region"]
            assert meta["name"]

    def test_accumulation_sensor_is_2(self):
        assert SENSOR_PRECIP_ACCUM == 2


class TestFetchWiring:
    def test_fetch_uses_the_three_index_stations_and_accum_sensor(self, monkeypatch):
        captured = {}

        def fake_fetch_sensor_data(stations, sensor, start, end, duration="D"):
            captured["stations"] = stations
            captured["sensor"] = sensor
            return []

        monkeypatch.setattr(cdec_api, "fetch_sensor_data", fake_fetch_sensor_data)
        cdec_api.fetch_precip_indices(date(2026, 1, 1), date(2026, 1, 2))

        assert set(captured["stations"]) == {"8SI", "5SI", "6SI"}
        assert captured["sensor"] == SENSOR_PRECIP_ACCUM


class TestUpsertObservations:
    def _obs(self, station, d, value):
        return Observation(station_id=station, sensor=2, date=d, value=value, units="INCHES")

    def test_filters_to_known_index_stations(self):
        db = MagicMock()
        observations = [
            self._obs("8SI", date(2026, 1, 1), 50.5),
            self._obs("ZZZ", date(2026, 1, 1), 1.0),  # unknown — dropped
        ]
        loaded = mod.upsert_observations(db, observations)
        assert loaded == 1

    def test_dedupes_duplicate_station_date(self):
        db = MagicMock()
        observations = [
            self._obs("8SI", date(2026, 1, 1), 50.5),
            self._obs("8SI", date(2026, 1, 1), 50.6),  # revised same-day reading
        ]
        loaded = mod.upsert_observations(db, observations)
        assert loaded == 1

    def test_empty_is_noop(self):
        db = MagicMock()
        assert mod.upsert_observations(db, []) == 0


def _patch_etl_run_tracking(monkeypatch):
    from etl import _utils

    monkeypatch.setattr(_utils, "SessionLocal", lambda: MagicMock())
    monkeypatch.setattr(
        _utils, "EtlRun",
        lambda **kw: SimpleNamespace(**{"id": 1, "rows_loaded": None, **kw}),
    )


class TestRun:
    def test_run_fetches_upserts_and_returns_count(self, monkeypatch):
        _patch_etl_run_tracking(monkeypatch)
        monkeypatch.setattr(mod.time, "sleep", lambda *_: None)

        db = MagicMock()
        monkeypatch.setattr(mod, "SessionLocal", lambda: db)
        monkeypatch.setattr(
            mod, "fetch_precip_indices",
            lambda s, e: [Observation("8SI", 2, date(2026, 1, 1), 50.5, "INCHES")],
        )

        total = mod.run(date(2026, 1, 1), date(2026, 1, 1))

        assert total == 1
        assert db.execute.called
        assert db.commit.called
