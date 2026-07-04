"""Tests for the parties & victims ETL transform functions."""

import pytest

from etl.load_parties_victims import (
    transform_party,
    transform_victim,
    effective_start_year,
    _safe_int,
    _safe_bool,
    PARTIES_RESOURCE_IDS,
    VICTIMS_RESOURCE_IDS,
)


class TestEffectiveStartYear:
    """Incremental default vs --force full reload (OOM-prevention)."""

    def test_incremental_narrows_to_recent_years(self):
        # Daily run (not force): start from current_year - 1 even though the
        # requested start is 2016 — historical years are static & already loaded.
        assert effective_start_year(2016, force=False, current_year=2026) == 2025

    def test_force_uses_full_requested_range(self):
        assert effective_start_year(2016, force=True, current_year=2026) == 2016

    def test_incremental_respects_a_later_requested_start(self):
        # Never widen the range: an explicit recent start wins over the window.
        assert effective_start_year(2026, force=False, current_year=2026) == 2026


class TestSafeInt:
    def test_valid_int(self):
        assert _safe_int(42) == 42

    def test_valid_string(self):
        assert _safe_int("100") == 100

    def test_none(self):
        assert _safe_int(None) is None

    def test_empty_string(self):
        assert _safe_int("") is None

    def test_invalid(self):
        assert _safe_int("abc") is None


class TestSafeBool:
    def test_true_string(self):
        assert _safe_bool("TRUE") is True

    def test_y_string(self):
        assert _safe_bool("Y") is True

    def test_false_string(self):
        assert _safe_bool("FALSE") is False

    def test_none(self):
        assert _safe_bool(None) is None

    def test_bool_passthrough(self):
        assert _safe_bool(True) is True
        assert _safe_bool(False) is False


class TestTransformParty:
    def test_basic_party(self):
        rec = {
            "PartyId": 12345,
            "CollisionId": 99999,
            "PartyNumber": 1,
            "PartyType": "Driver",
            "IsAtFault": "TRUE",
            "GenderCode": "M",
            "StatedAge": 25,
            "SobrietyDrugPhysicalDescription1": "HAD NOT BEEN DRINKING",
            "Vehicle1TypeDesc": "Passenger Car",
            "Vehicle1Year": 2020,
            "Vehicle1Make": "TOYOTA",
            "SpeedLimit": 35,
            "MovementPrecCollDescription": "Proceeding Straight",
            "SafetyEquipmentDescription": "Lap/Shoulder Belt Used",
            "Special Information": "",
        }
        result = transform_party(rec)

        assert result["party_id"] == 12345
        assert result["collision_id"] == 99999
        assert result["gender"] == "M"
        assert result["age"] == 25
        assert result["at_fault"] is True
        assert result["sobriety"] == "HAD NOT BEEN DRINKING"
        assert result["data_source"] == "ccrs"

    def test_extracts_cell_phone_from_special_info(self):
        rec = {
            "PartyId": 1,
            "CollisionId": 2,
            "Special Information": "CELL PHONE HANDHELD IN USE",
        }
        result = transform_party(rec)
        assert result["cell_phone_use"] == "CELL PHONE HANDHELD IN USE"

    def test_no_cell_phone_when_absent(self):
        rec = {
            "PartyId": 1,
            "CollisionId": 2,
            "Special Information": "HAZARDOUS MATERIAL",
        }
        result = transform_party(rec)
        assert result["cell_phone_use"] is None

    def test_handles_null_gender(self):
        rec = {"PartyId": 1, "CollisionId": 2, "GenderCode": None}
        result = transform_party(rec)
        assert result["gender"] is None

    def test_invalid_gender_becomes_none(self):
        rec = {"PartyId": 1, "CollisionId": 2, "GenderCode": "X"}
        result = transform_party(rec)
        assert result["gender"] is None


class TestTransformVictim:
    def test_basic_victim(self):
        rec = {
            "InjuredWitPassId": 555,
            "CollisionId": 99999,
            "PartyNumber": 1,
            "StatedAge": 30,
            "Gender": "F",
            "ExtentOfInjuryCode": "Severe Injury",
            "InjuredPersonType": "Driver",
            "SeatPosition": "Driver Seat",
            "SafetyEquipmentDescription": "Lap/Shoulder Belt Used",
            "Ejected": "Not Ejected",
        }
        result = transform_victim(rec)

        assert result["victim_id"] == 555
        assert result["collision_id"] == 99999
        assert result["age"] == 30
        assert result["gender"] == "F"
        assert result["injury_severity"] == "Severe Injury"
        assert result["data_source"] == "ccrs"

    def test_handles_alternate_id_field(self):
        """Some years use InjWitPassId instead of InjuredWitPassId."""
        rec = {"InjWitPassId": 777, "CollisionId": 2}
        result = transform_victim(rec)
        assert result["victim_id"] == 777


class TestResourceIds:
    def test_parties_cover_2016_to_2026(self):
        for year in range(2016, 2027):
            assert year in PARTIES_RESOURCE_IDS

    def test_victims_cover_2016_to_2026(self):
        for year in range(2016, 2027):
            assert year in VICTIMS_RESOURCE_IDS

    def test_no_duplicate_resource_ids(self):
        all_ids = list(PARTIES_RESOURCE_IDS.values()) + list(VICTIMS_RESOURCE_IDS.values())
        assert len(all_ids) == len(set(all_ids))


class TestLoadTableMemoryCleanup:
    """Verify the OOM-prevention changes: gc.collect() per batch, expunge_all, del."""

    def test_gc_collect_called_per_batch(self, monkeypatch):
        """gc.collect() should fire after every batch, not just per year."""
        import gc as gc_mod
        from unittest.mock import MagicMock, patch
        from etl import load_parties_victims as mod

        gc_calls = []
        original_collect = gc_mod.collect
        def tracking_collect(*a, **kw):
            gc_calls.append(1)
            return original_collect(*a, **kw)

        fake_db = MagicMock()

        page1 = {
            "total": 3,
            "records": [
                {"PartyId": 1, "CollisionId": 10, "PartyNumber": 1},
                {"PartyId": 2, "CollisionId": 20, "PartyNumber": 1},
            ],
        }
        page2 = {
            "total": 3,
            "records": [
                {"PartyId": 3, "CollisionId": 30, "PartyNumber": 1},
            ],
        }
        page3 = {"total": 3, "records": []}

        pages = iter([page1, page2, page3])
        monkeypatch.setattr(mod, "_fetch_page", lambda rid, off: next(pages))
        monkeypatch.setattr(mod, "SessionLocal", lambda: fake_db)

        with patch.object(gc_mod, "collect", side_effect=tracking_collect):
            mod.load_table(
                table_type="parties",
                resource_ids={2026: "fake-id"},
                model_class=MagicMock(),
                transform_fn=mod.transform_party,
                upsert_cols=["collision_id"],
                constraint_name="uq_parties_party_source",
                id_field="party_id",
                start_year=2026,
                end_year=2026,
                force=False,
            )

        assert len(gc_calls) >= 2, (
            f"gc.collect() should fire per batch (expected >=2, got {len(gc_calls)})"
        )
        fake_db.expunge_all.assert_called()


class TestPartialFailureIsLoud:
    """M-B9: a page-fetch failure must not be recorded as a silent success."""

    def test_load_table_reports_failure_when_a_page_fetch_raises(self, monkeypatch):
        from unittest.mock import MagicMock
        from etl import load_parties_victims as mod

        def boom(_rid, _off):
            raise RuntimeError("CKAN 500")

        monkeypatch.setattr(mod, "_fetch_page", boom)
        monkeypatch.setattr(mod, "SessionLocal", lambda: MagicMock())

        had_failure = mod.load_table(
            table_type="parties",
            resource_ids={2026: "fake-id"},
            model_class=MagicMock(),
            transform_fn=mod.transform_party,
            upsert_cols=["collision_id"],
            constraint_name="uq_parties_party_source",
            id_field="party_id",
            start_year=2026,
            end_year=2026,
            force=False,
        )

        assert had_failure is True

    def test_run_exits_nonzero_when_a_table_had_a_fetch_failure(self, monkeypatch):
        from etl import load_parties_victims as mod

        monkeypatch.setattr(mod, "load_table", lambda **kw: True)

        with pytest.raises(SystemExit) as exc:
            mod.run(table="parties")

        assert exc.value.code != 0


class TestNoSelfTracking:
    """M-B8: the orchestrator owns EtlRun; the loader must not create its own
    (double-tracking that inflates run history + phantom /api/freshness sources)."""

    def test_run_does_not_open_its_own_etl_run(self, monkeypatch):
        from etl import load_parties_victims as mod

        calls = []
        monkeypatch.setattr(mod, "load_table", lambda **kw: calls.append(kw["table_type"]) or False)

        assert not hasattr(mod, "etl_run"), (
            "loader should not self-track EtlRun; run_job is the single source of truth"
        )
        mod.run(table="victims")
        assert calls == ["victims"]
