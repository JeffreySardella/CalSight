"""Tests for the parties & victims ETL transform functions."""

from etl.load_parties_victims import (
    transform_party,
    transform_victim,
    _safe_int,
    _safe_bool,
    PARTIES_RESOURCE_IDS,
    VICTIMS_RESOURCE_IDS,
)


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
