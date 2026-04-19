"""Unit tests for URL-param parsers and predicate builder in app.filters."""

import pytest

from app.filters import (
    FilterError,
    build_crash_predicates,
    parse_bool_flag,
    parse_cause,
    parse_county_codes,
    parse_severity,
    parse_year,
)


# --- year ---

def test_parse_year_none_returns_none():
    assert parse_year(None) is None


def test_parse_year_empty_returns_none():
    assert parse_year("") is None


def test_parse_year_single():
    assert parse_year("2023") == {2023}


def test_parse_year_comma_separated():
    assert parse_year("2020,2023") == {2020, 2023}


def test_parse_year_whitespace_tolerated():
    assert parse_year(" 2020 , 2023 ") == {2020, 2023}


def test_parse_year_rejects_non_integer():
    with pytest.raises(FilterError) as exc_info:
        parse_year("2020,twenty")
    assert exc_info.value.filter == "year"


def test_parse_year_rejects_out_of_range():
    with pytest.raises(FilterError) as exc_info:
        parse_year("1990")
    assert exc_info.value.filter == "year"


# --- county ---

def test_parse_county_codes_none():
    slug_map = {"los-angeles": 19}
    assert parse_county_codes(None, slug_map) is None


def test_parse_county_codes_translates_slugs():
    slug_map = {"los-angeles": 19, "orange": 30}
    assert parse_county_codes("los-angeles,orange", slug_map) == {19, 30}


def test_parse_county_codes_rejects_unknown_slug():
    slug_map = {"los-angeles": 19}
    with pytest.raises(FilterError) as exc_info:
        parse_county_codes("atlantis", slug_map)
    assert exc_info.value.filter == "county"
    assert "atlantis" in exc_info.value.detail


# --- severity ---

def test_parse_severity_fatal():
    assert parse_severity("fatal") == {"Fatal"}


def test_parse_severity_multiple():
    assert parse_severity("fatal,injury") == {"Fatal", "Injury"}


def test_parse_severity_property_damage_only():
    assert parse_severity("property-damage-only") == {"Property Damage Only"}


def test_parse_severity_rejects_severe_injury():
    # FE currently sends this; backend surfaces the mismatch honestly.
    with pytest.raises(FilterError) as exc_info:
        parse_severity("severe-injury")
    assert exc_info.value.filter == "severity"
    assert "severe-injury" in exc_info.value.detail


def test_parse_severity_rejects_minor_injury():
    with pytest.raises(FilterError) as exc_info:
        parse_severity("minor-injury")
    assert exc_info.value.filter == "severity"


# --- cause ---

def test_parse_cause_canonical_values():
    assert parse_cause("dui,speeding,other") == {"dui", "speeding", "other"}


def test_parse_cause_translates_hyphen():
    # FE sends lane-change, DB stores lane_change. Cosmetic translation.
    assert parse_cause("lane-change") == {"lane_change"}


def test_parse_cause_rejects_distracted():
    with pytest.raises(FilterError) as exc_info:
        parse_cause("distracted")
    assert exc_info.value.filter == "cause"
    assert "distracted=true" in exc_info.value.detail


def test_parse_cause_rejects_weather():
    with pytest.raises(FilterError) as exc_info:
        parse_cause("weather")
    assert exc_info.value.filter == "cause"


# --- bool ---

def test_parse_bool_flag_true():
    assert parse_bool_flag("true", "alcohol") is True


def test_parse_bool_flag_false():
    assert parse_bool_flag("false", "alcohol") is False


def test_parse_bool_flag_none():
    assert parse_bool_flag(None, "alcohol") is None


def test_parse_bool_flag_rejects_garbage():
    with pytest.raises(FilterError):
        parse_bool_flag("yes", "alcohol")


# --- predicate builder ---

def test_build_crash_predicates_empty_returns_empty_list():
    preds = build_crash_predicates()
    assert preds == []


def test_build_crash_predicates_year_in():
    preds = build_crash_predicates(years={2020, 2023})
    assert len(preds) == 1
    compiled = str(preds[0].compile(compile_kwargs={"literal_binds": True}))
    assert "crashes.crash_year IN" in compiled
    assert "2020" in compiled and "2023" in compiled


def test_build_crash_predicates_combined():
    preds = build_crash_predicates(
        years={2023}, county_codes={19}, severities={"Fatal"}
    )
    assert len(preds) == 3
