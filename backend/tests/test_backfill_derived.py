"""Tests for the backfill derived fields script.

Covers the static data (land areas) and the logic for computing
severity categories. The actual SQL backfills need a database to
test so those are verified by running the script and spot-checking.
"""

from etl.backfill_derived import COUNTY_LAND_AREAS, _categorize_primary_factor as categorize


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
        assert categorize("improper turning") == "other"

    def test_other_right_of_way(self):
        assert categorize("automobile right of way") == "other"

    def test_other_unknown(self):
        assert categorize("unknown") == "other"

    def test_dui_wins_over_speed(self):
        """If a value mentions both DUI and speeding, DUI is the dominant signal."""
        assert categorize("dui and speeding") == "dui"
