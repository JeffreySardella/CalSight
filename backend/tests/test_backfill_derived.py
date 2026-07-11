"""Tests for the backfill derived fields script.

Covers the static data (land areas), the logic for computing severity
categories, and the SQL shape of the party-derived flag resyncs (M10).
The actual SQL backfills need a database to test end-to-end so those are
verified by running the script and spot-checking.
"""

import pytest

from etl.backfill_derived import (
    COUNTY_LAND_AREAS,
    _categorize_primary_factor as categorize,
    _resync_party_flag,
    backfill_alcohol_flags,
    backfill_at_fault_driver_age,
    backfill_cyclist_flags,
    backfill_distraction_flags,
    backfill_drug_flags,
)


class TestCountyLandAreas:
    def test_all_58_counties_have_areas(self):
        assert len(COUNTY_LAND_AREAS) == 58

    def test_codes_are_1_through_58(self):
        assert set(COUNTY_LAND_AREAS.keys()) == set(range(1, 59))

    def test_all_areas_are_positive(self):
        for code, area in COUNTY_LAND_AREAS.items():
            assert area > 0, f"County {code} has non-positive area: {area}"

    def test_san_bernardino_is_largest(self):
        """San Bernardino is the largest county in the US by area."""
        largest_code = max(COUNTY_LAND_AREAS, key=COUNTY_LAND_AREAS.get)
        assert largest_code == 36
        assert COUNTY_LAND_AREAS[36] == 20057.0

    def test_san_francisco_is_smallest(self):
        """San Francisco is the smallest CA county by land area."""
        smallest_code = min(COUNTY_LAND_AREAS, key=COUNTY_LAND_AREAS.get)
        assert smallest_code == 38
        assert COUNTY_LAND_AREAS[38] == 47.0

    def test_la_county_area(self):
        """LA is 4,058 sq mi — sanity check."""
        assert COUNTY_LAND_AREAS[19] == 4058.0


class TestSeverityLogic:
    """The actual backfill uses SQL but the logic is:
    - number_killed > 0 -> Fatal
    - number_injured > 0 -> Injury
    - both zero/null -> Property Damage Only
    """

    def test_fatal_when_killed(self):
        # If anyone died, it's fatal regardless of injuries
        assert _classify_severity(killed=1, injured=0) == "Fatal"
        assert _classify_severity(killed=3, injured=5) == "Fatal"

    def test_injury_when_hurt_not_killed(self):
        assert _classify_severity(killed=0, injured=2) == "Injury"

    def test_pdo_when_nothing(self):
        assert _classify_severity(killed=0, injured=0) == "Property Damage Only"

    def test_pdo_when_null(self):
        assert _classify_severity(killed=None, injured=None) == "Property Damage Only"


def _classify_severity(killed, injured):
    """Mirror the SQL logic from backfill_severity for testing."""
    if killed and killed > 0:
        return "Fatal"
    if injured and injured > 0:
        return "Injury"
    return "Property Damage Only"


class TestCategorizePrimaryFactor:
    """The regex-based categorizer used by backfill_canonical_cause.

    These cases come from real top-N values in the crashes table — if a
    future change breaks any of them, the dashboard filter silently
    miscategorizes millions of rows.
    """

    def test_speeding_english(self):
        assert categorize("speeding") == "speeding"

    def test_speeding_vc_22350(self):
        assert categorize("22350") == "speeding"

    def test_speeding_vc_prefix(self):
        assert categorize("VC 22350") == "speeding"

    def test_speeding_unsafe_speed(self):
        assert categorize("VC 22350 UNSAFE SPEED:PREVAIL COND") == "speeding"

    def test_dui_english(self):
        assert categorize("dui") == "dui"

    def test_dui_vc_23152(self):
        assert categorize("23152(a)") == "dui"
        assert categorize("23152A") == "dui"
        assert categorize("VC 23152(a)") == "dui"

    def test_dui_not_substring(self):
        """'dui' as a whole word only — 'fluid' shouldn't match."""
        assert categorize("brake fluid failure") == "other"

    def test_lane_change_english(self):
        assert categorize("unsafe lane change") == "lane_change"

    def test_lane_change_vc_21658(self):
        assert categorize("21658(a)") == "lane_change"
        assert categorize("21658A") == "lane_change"

    def test_lane_change_improper_passing(self):
        assert categorize("improper passing") == "lane_change"

    def test_lane_change_wrong_side(self):
        assert categorize("wrong side of road") == "lane_change"
        assert categorize("21650") == "lane_change"

    def test_other_turning(self):
        assert categorize("improper turning") == "turning"

    def test_other_right_of_way(self):
        assert categorize("automobile right of way") == "right_of_way"

    def test_other_unknown(self):
        assert categorize("unknown") == "other"

    def test_dui_wins_over_speed(self):
        """If a value mentions both DUI and speeding, DUI is the dominant signal."""
        assert categorize("dui and speeding") == "dui"

    def test_signal_violation_english(self):
        assert categorize("traffic signals and signs") == "signal_violation"

    def test_signal_violation_vc_21453(self):
        assert categorize("21453A") == "signal_violation"
        assert categorize("21453(a)") == "signal_violation"

    def test_signal_violation_stop_sign(self):
        assert categorize("22450A") == "signal_violation"
        assert categorize("22450(a)") == "signal_violation"

    def test_right_of_way_english(self):
        assert categorize("automobile right of way") == "right_of_way"

    def test_right_of_way_vc_21801(self):
        assert categorize("21801A") == "right_of_way"
        assert categorize("21801(a)") == "right_of_way"

    def test_right_of_way_vc_21804(self):
        assert categorize("21804A") == "right_of_way"

    def test_turning_english(self):
        assert categorize("improper turning") == "turning"

    def test_turning_vc_22107(self):
        assert categorize("22107") == "turning"
        assert categorize("VC 22107") == "turning"
        assert categorize("VC 22107 UNSAFE TURNING MOVEMENT") == "turning"

    def test_following_too_close_english(self):
        assert categorize("following too closely") == "following_too_close"

    def test_following_too_close_vc_21703(self):
        assert categorize("21703") == "following_too_close"

    def test_pedestrian_violation_english(self):
        assert categorize("pedestrian violation") == "pedestrian_violation"

    def test_pedestrian_violation_vc_21950(self):
        assert categorize("21950A") == "pedestrian_violation"

    def test_pedestrian_violation_vc_21954(self):
        assert categorize("21954A") == "pedestrian_violation"

    def test_pedestrian_right_of_way_goes_to_row(self):
        """'pedestrian right of way' matches right_of_way first (driver violation)."""
        assert categorize("pedestrian right of way") == "right_of_way"

    def test_unsafe_backing_english(self):
        assert categorize("unsafe starting or backing") == "unsafe_backing"

    def test_unsafe_backing_vc_22106(self):
        assert categorize("22106") == "unsafe_backing"
        assert categorize("VC 22106") == "unsafe_backing"

    def test_turning_excludes_22106(self):
        """22106 is backing (VC 22106), not turning — must not match turning regex."""
        assert categorize("22106") == "unsafe_backing"

    def test_other_unknown_new(self):
        assert categorize("unknown") == "other"

    def test_other_hazardous(self):
        assert categorize("other hazardous violation") == "other"


# ---------------------------------------------------------------------------
# M10 — party-derived flags must be ground-truth resyncs, not set-once.
#
# The old implementations set positives with an "AND <col> IS NULL" guard and
# then locked every remaining CCRS row to FALSE forever, so daily party
# amendments (parties reload current+prev year) never corrected the crash
# flag — stale-FALSE drift on DUI/drug/cyclist/distraction/at-fault-age.
# backfill_pedestrian_flags was rewritten to IS DISTINCT FROM semantics for
# exactly this bug class; these tests pin its four boolean siblings (and the
# at-fault-age variant) to the same pattern by inspecting the SQL each one
# issues against a fake session.
# ---------------------------------------------------------------------------


class _FakeExecResult:
    def __init__(self, rows=None, scalar_value=None, rowcount=0):
        self._rows = rows or []
        self._scalar = scalar_value
        self.rowcount = rowcount

    def __iter__(self):
        return iter(self._rows)

    def scalar(self):
        return self._scalar


class _FlagSyncFakeDB:
    """Session stand-in: serves the flag-resync queries, records every UPDATE.

    max_year=2016 keeps _ccrs_year_range at a single year so each pass emits
    exactly one per-year statement.
    """

    def __init__(self, positive_ids=(101, 102), max_year=2016):
        self.updates = []  # list of (normalized_sql, params)
        self._positive_ids = list(positive_ids)
        self._max_year = max_year

    def execute(self, clause, params=None):
        sql = " ".join(str(clause).split())
        low = sql.lower()
        if low.startswith("update"):
            self.updates.append((sql, params or {}))
            return _FakeExecResult(rowcount=1)
        if "select max(extract(year" in low:
            return _FakeExecResult(scalar_value=self._max_year)
        if "select distinct p.collision_id" in low:
            return _FakeExecResult(rows=[(i,) for i in self._positive_ids])
        raise AssertionError(f"Unexpected SQL in flag resync: {sql}")

    def commit(self):
        pass


_FLAG_FUNCS = [
    (backfill_alcohol_flags, "is_alcohol_involved"),
    (backfill_distraction_flags, "is_distraction_involved"),
    (backfill_cyclist_flags, "cyclist_involved"),
    (backfill_drug_flags, "is_drug_involved"),
]


class TestPartyFlagGroundTruthResync:
    @pytest.mark.parametrize("func,column", _FLAG_FUNCS)
    def test_set_once_null_guard_is_gone(self, func, column):
        """No pass may carry the old 'AND <col> IS NULL' set-once guard."""
        db = _FlagSyncFakeDB()
        func(db)
        assert db.updates, "expected UPDATE statements"
        for sql, _ in db.updates:
            assert f"{column} is null" not in sql.lower()

    @pytest.mark.parametrize("func,column", _FLAG_FUNCS)
    def test_true_pass_corrects_stale_false(self, func, column):
        """Positive pass writes wherever the value differs (IS DISTINCT FROM
        TRUE) so a stale FALSE flips when a party amendment lands."""
        db = _FlagSyncFakeDB()
        func(db)
        true_passes = [
            (sql, params) for sql, params in db.updates
            if f"set {column} = true" in sql.lower()
        ]
        assert true_passes
        for sql, params in true_passes:
            low = sql.lower()
            assert f"{column} is distinct from true" in low
            assert "data_source = 'ccrs'" in low
            assert params["ids"] == [101, 102]

    @pytest.mark.parametrize("func,column", _FLAG_FUNCS)
    def test_false_pass_is_ground_truth_not_lock_in(self, func, column):
        """Negative pass re-derives FALSE from crash_parties (NOT EXISTS) and
        only touches rows not already FALSE — never 'whatever is left'."""
        db = _FlagSyncFakeDB()
        func(db)
        false_passes = [
            sql for sql, _ in db.updates if f"set {column} = false" in sql.lower()
        ]
        assert false_passes
        for sql in false_passes:
            low = sql.lower()
            assert f"{column} is distinct from false" in low
            assert "not exists" in low
            assert "crash_parties" in low
            assert "data_source = 'ccrs'" in low

    @pytest.mark.parametrize("func,_column", _FLAG_FUNCS)
    def test_returns_negative_and_positive_counts(self, func, _column):
        """Like backfill_pedestrian_flags, each resync reports what it wrote
        so a second run over unchanged data can be asserted to write nothing."""
        db = _FlagSyncFakeDB()
        # One year in range and one id batch, each reporting rowcount=1.
        assert func(db) == (1, 1)

    def test_unknown_column_is_rejected(self):
        """The column name is interpolated into SQL — it must be allowlisted."""
        with pytest.raises(ValueError, match="unknown flag column"):
            _resync_party_flag(
                _FlagSyncFakeDB(),
                column="severity",
                party_where="p.party_type = 'Driver'",
                label="nope",
            )


class TestAtFaultDriverAgeResync:
    def _run(self):
        db = _FlagSyncFakeDB()
        result = backfill_at_fault_driver_age(db)
        return db, result

    def test_set_pass_overwrites_drifted_ages(self):
        db, _ = self._run()
        set_passes = [
            sql for sql, _ in db.updates
            if "set at_fault_driver_age = sub.age" in sql.lower()
        ]
        assert set_passes
        for sql in set_passes:
            low = sql.lower()
            # Ground truth: write on any difference, not only NULL -> value.
            assert "at_fault_driver_age is distinct from sub.age" in low
            assert "c.at_fault_driver_age is null" not in low

    def test_clear_pass_nulls_unbacked_ages(self):
        """An age no longer backed by a qualifying at-fault-driver party goes
        back to NULL (unknown) — absence of party data is not a value."""
        db, _ = self._run()
        clear_passes = [
            sql for sql, _ in db.updates
            if "set at_fault_driver_age = null" in sql.lower()
        ]
        assert clear_passes
        for sql in clear_passes:
            low = sql.lower()
            assert "not exists" in low
            assert "at_fault_driver_age is not null" in low
            assert "crash_parties" in low

    def test_both_passes_share_the_qualifying_predicate(self):
        """Set and clear passes must agree on what 'qualifying party' means,
        or a row could be set and cleared on alternating runs."""
        db, _ = self._run()
        for sql, _params in db.updates:
            low = sql.lower()
            assert "p.at_fault = true" in low
            assert "p.party_type = 'driver'" in low
            assert "p.age between 1 and 120" in low

    def test_returns_cleared_and_set_counts(self):
        _, result = self._run()
        assert result == (1, 1)
