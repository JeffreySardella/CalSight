"""Tests for the condition-canonicalization backfill.

Covers the regex categorization rules (the real logic — turning messy
free-text weather/lighting/road/collision-type strings into a fixed
vocabulary) and the year-range + temp-table backfill flow with a mocked
DB session. The actual UPDATE needs a real database, so that part is
exercised with `db.execute` mocked to return canned results, same pattern
as test_backfill_derived.py.
"""

from unittest.mock import MagicMock

from etl.backfill_conditions import (
    _COLLISION_TYPE_RULES,
    _LIGHTING_RULES,
    _ROAD_CONDITION_RULES,
    _WEATHER_RULES,
    _all_crash_year_range,
    _backfill_canonical_column,
    _categorize,
)


class TestWeatherRules:
    def test_clear(self):
        assert _categorize("Clear", _WEATHER_RULES) == "clear"
        assert _categorize("sunny", _WEATHER_RULES) == "clear"

    def test_cloudy(self):
        assert _categorize("Cloudy", _WEATHER_RULES) == "cloudy"
        assert _categorize("Overcast", _WEATHER_RULES) == "cloudy"

    def test_rain(self):
        assert _categorize("Raining", _WEATHER_RULES) == "rain"
        assert _categorize("Wet", _WEATHER_RULES) == "rain"

    def test_fog(self):
        assert _categorize("Fog", _WEATHER_RULES) == "fog"
        assert _categorize("Smoke", _WEATHER_RULES) == "fog"

    def test_snow(self):
        assert _categorize("Snow", _WEATHER_RULES) == "snow"
        assert _categorize("Hail", _WEATHER_RULES) == "snow"

    def test_wind(self):
        assert _categorize("Windy", _WEATHER_RULES) == "wind"

    def test_other_when_no_match(self):
        assert _categorize("Unknown", _WEATHER_RULES) == "other"


class TestLightingRules:
    """Order matters: dusk/dawn before dark_lit before dark_unlit."""

    def test_dusk_dawn(self):
        assert _categorize("Dusk", _LIGHTING_RULES) == "dusk_dawn"
        assert _categorize("Dawn", _LIGHTING_RULES) == "dusk_dawn"

    def test_dark_with_street_lights(self):
        assert _categorize("Dark - Street Lights", _LIGHTING_RULES) == "dark_lit"

    def test_dark_with_no_street_lights(self):
        assert _categorize("Dark - No Street Lights", _LIGHTING_RULES) == "dark_unlit"

    def test_dark_not_functioning(self):
        assert _categorize("Dark - Not Functioning", _LIGHTING_RULES) == "dark_unlit"

    def test_dark_falls_back_to_unlit(self):
        # Plain "Dark" with no lighting detail matches the bare "dark" rule.
        assert _categorize("Dark", _LIGHTING_RULES) == "dark_unlit"

    def test_daylight(self):
        assert _categorize("Daylight", _LIGHTING_RULES) == "daylight"
        assert _categorize("Day", _LIGHTING_RULES) == "daylight"

    def test_other_when_no_match(self):
        assert _categorize("Unknown", _LIGHTING_RULES) == "other"


class TestRoadConditionRules:
    def test_dry(self):
        assert _categorize("dry", _ROAD_CONDITION_RULES) == "dry"
        assert _categorize("No unusual conditions", _ROAD_CONDITION_RULES) == "dry"

    def test_wet(self):
        assert _categorize("Wet", _ROAD_CONDITION_RULES) == "wet"
        assert _categorize("Flooded", _ROAD_CONDITION_RULES) == "wet"

    def test_snow_ice(self):
        assert _categorize("Ice", _ROAD_CONDITION_RULES) == "snow_ice"
        assert _categorize("Slippery", _ROAD_CONDITION_RULES) == "snow_ice"

    def test_construction(self):
        assert _categorize("Construction Zone", _ROAD_CONDITION_RULES) == "construction"

    def test_other_when_no_match(self):
        assert _categorize("Unknown", _ROAD_CONDITION_RULES) == "other"


class TestCollisionTypeRules:
    def test_rear_end(self):
        assert _categorize("Rear End", _COLLISION_TYPE_RULES) == "rear_end"

    def test_broadside(self):
        assert _categorize("Broadside", _COLLISION_TYPE_RULES) == "broadside"
        assert _categorize("T-Bone", _COLLISION_TYPE_RULES) == "broadside"

    def test_sideswipe(self):
        assert _categorize("Sideswipe", _COLLISION_TYPE_RULES) == "sideswipe"

    def test_hit_object(self):
        assert _categorize("Hit Fixed Object", _COLLISION_TYPE_RULES) == "hit_object"
        assert _categorize("Overturned", _COLLISION_TYPE_RULES) == "hit_object"

    def test_head_on(self):
        assert _categorize("Head-On", _COLLISION_TYPE_RULES) == "head_on"

    def test_other_when_no_match(self):
        assert _categorize("Unknown", _COLLISION_TYPE_RULES) == "other"


class TestAllCrashYearRange:
    def test_returns_range_from_min_max(self):
        db = MagicMock()
        db.execute.return_value.one_or_none.return_value = (2019, 2021)
        assert list(_all_crash_year_range(db)) == [2019, 2020, 2021]

    def test_returns_empty_range_when_no_rows(self):
        db = MagicMock()
        db.execute.return_value.one_or_none.return_value = None
        assert list(_all_crash_year_range(db)) == []

    def test_returns_empty_range_when_min_is_none(self):
        db = MagicMock()
        db.execute.return_value.one_or_none.return_value = (None, None)
        assert list(_all_crash_year_range(db)) == []


class TestBackfillCanonicalColumn:
    def test_no_distinct_values_returns_zero(self):
        db = MagicMock()
        db.execute.return_value.scalars.return_value.all.return_value = []
        total = _backfill_canonical_column(db, "weather", "canonical_weather", _WEATHER_RULES)
        assert total == 0

    def test_categorizes_and_updates_each_year(self):
        db = MagicMock()
        result = db.execute.return_value
        result.scalars.return_value.all.return_value = ["Rain", "Clear", "Unknown"]
        result.one_or_none.return_value = (2020, 2020)
        result.rowcount = 7

        total = _backfill_canonical_column(db, "weather", "canonical_weather", _WEATHER_RULES)

        assert total == 7
        # DROP + CREATE TEMP TABLE + INSERT + (1 year * UPDATE) = at least 4 calls.
        assert db.execute.call_count >= 4
        db.commit.assert_called()

    def test_zero_rowcount_years_are_not_counted(self):
        db = MagicMock()
        result = db.execute.return_value
        result.scalars.return_value.all.return_value = ["Rain"]
        result.one_or_none.return_value = (2020, 2021)
        result.rowcount = 0

        total = _backfill_canonical_column(db, "weather", "canonical_weather", _WEATHER_RULES)

        assert total == 0
