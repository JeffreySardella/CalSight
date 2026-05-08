"""Unit tests for URL-param parsers and predicate builder in app.filters."""

from datetime import date

import pytest

from app.filters import (
    FilterError,
    build_crash_predicates,
    parse_bool_flag,
    parse_cause,
    parse_county_codes,
    parse_date_range,
    parse_severity,
    parse_year,
    years_from_date_range,
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


def test_parse_cause_new_categories():
    assert parse_cause("right-of-way") == {"right_of_way"}
    assert parse_cause("turning") == {"turning"}
    assert parse_cause("following-too-close") == {"following_too_close"}
    assert parse_cause("signal-violation") == {"signal_violation"}
    assert parse_cause("pedestrian-violation") == {"pedestrian_violation"}
    assert parse_cause("unsafe-backing") == {"unsafe_backing"}


def test_parse_cause_all_ten_values():
    raw = "dui,speeding,lane-change,right-of-way,turning,following-too-close,signal-violation,pedestrian-violation,unsafe-backing,other"
    result = parse_cause(raw)
    assert len(result) == 10


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


# --- date range ---

def test_parse_date_range_both_none_returns_none():
    assert parse_date_range(None, None) is None


def test_parse_date_range_both_empty_returns_none():
    assert parse_date_range("", "") is None


def test_parse_date_range_full_range():
    start, end = parse_date_range("2020-03", "2022-08")
    assert start == date(2020, 3, 1)
    # end is the last day of the end month, inclusive.
    assert end == date(2022, 8, 31)


def test_parse_date_range_open_start():
    result = parse_date_range(None, "2023-06")
    assert result is not None
    start, end = result
    assert start is None
    assert end == date(2023, 6, 30)


def test_parse_date_range_open_end():
    result = parse_date_range("2023-01", None)
    assert result is not None
    start, end = result
    assert start == date(2023, 1, 1)
    assert end is None


def test_parse_date_range_february_leap_year():
    _, end = parse_date_range("2020-02", "2020-02")
    assert end == date(2020, 2, 29)


def test_parse_date_range_rejects_bad_format():
    with pytest.raises(FilterError) as exc_info:
        parse_date_range("2020", None)
    assert exc_info.value.filter == "start"


def test_parse_date_range_rejects_bad_month():
    with pytest.raises(FilterError) as exc_info:
        parse_date_range("2020-13", None)
    assert exc_info.value.filter == "start"


def test_parse_date_range_rejects_out_of_range_year():
    with pytest.raises(FilterError) as exc_info:
        parse_date_range("1990-06", None)
    assert exc_info.value.filter == "start"


def test_parse_date_range_rejects_inverted_range():
    with pytest.raises(FilterError) as exc_info:
        parse_date_range("2023-06", "2020-01")
    assert exc_info.value.filter == "end"


def test_years_from_date_range_full():
    dr = parse_date_range("2020-03", "2022-08")
    assert years_from_date_range(dr) == {2020, 2021, 2022}


def test_years_from_date_range_single_month():
    dr = parse_date_range("2023-06", "2023-06")
    assert years_from_date_range(dr) == {2023}


def test_years_from_date_range_none():
    assert years_from_date_range(None) is None


def test_build_crash_predicates_uses_date_range_over_years():
    dr = parse_date_range("2023-01", "2023-12")
    preds = build_crash_predicates(years={2020}, date_range=dr)
    # Both bounds (>= start, <= end) — no crash_year predicate.
    assert len(preds) == 2
    compiled = " ".join(
        str(p.compile(compile_kwargs={"literal_binds": True})) for p in preds
    )
    assert "crashes.crash_datetime" in compiled
    assert "crash_year" not in compiled


def test_build_crash_predicates_open_ended_date_range():
    dr = parse_date_range("2023-01", None)
    preds = build_crash_predicates(date_range=dr)
    assert len(preds) == 1
    compiled = str(preds[0].compile(compile_kwargs={"literal_binds": True}))
    assert "crashes.crash_datetime >=" in compiled
