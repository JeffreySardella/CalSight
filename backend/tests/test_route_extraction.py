"""Unit tests for primary_road → canonical route extraction."""

import pytest

from app.route_extraction import extract_route_number


@pytest.mark.parametrize(
    "raw,expected",
    [
        # Interstates with various spacings/directions
        ("I-5", "I-5"),
        ("I-5 N/B", "I-5"),
        ("I-5 S/B", "I-5"),
        ("I-405 N/B (Phillip Ortiz Mem Hwy)", "I-405"),
        ("I 80", "I-80"),
        ("I80", "I-80"),
        ("I-005", "I-5"),  # zero-padding stripped
        # US routes
        ("US-101", "US-101"),
        ("US-101 N/B", "US-101"),
        ("US HWY 50", "US-50"),
        # State routes — multiple formats
        ("SR-99", "SR-99"),
        ("SR-99 N/B", "SR-99"),
        ("SR  99 (SOUTHBOUND)", "SR-99"),
        ("SR - 1 (W. COAST HWY)", "SR-1"),
        ("CA-99", "SR-99"),
        ("STATE ROUTE 99", "SR-99"),
        ("STATE HWY 99", "SR-99"),
        ("STATE RTE 99", "SR-99"),
        ("STATE 41", "SR-41"),
        # Ambiguous "RT N" — resolved via CA_HIGHWAYS
        ("RT 5", "I-5"),       # 5 is I-5 in CA
        ("RT 101", "US-101"),  # 101 is US-101
        ("RT 99", "SR-99"),    # 99 is SR-99
        ("RT 405", "I-405"),
        # Ambiguous "HWY N" — same lookup
        ("HWY 99", "SR-99"),
        ("HWY-9", "SR-9"),
    ],
)
def test_extract_route_number_recognized(raw, expected):
    assert extract_route_number(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        None,
        "",
        "   ",
        "MAIN ST",
        "BROADWAY",
        "PACIFIC COAST HWY",   # named highway without a number
        "IMPERIAL HWY",
        "FOOTHILL BL",
        "7TH ST",
        "RT 9999",             # number not in the lookup
        "HWY 9999",
        # Strings that *contain* highway text but don't *start* with it:
        "BLVD CONNECTING I-5",
        "EXIT FROM SR-99",
    ],
)
def test_extract_route_number_unmatched(raw):
    assert extract_route_number(raw) is None


def test_extract_route_number_preserves_three_digit_routes():
    """Numbers must stay distinct — SR-110 and I-110 share digits but resolve
    to different canonical IDs based on the prefix in the source string."""
    assert extract_route_number("I-110 S/B") == "I-110"
    assert extract_route_number("SR-110") == "SR-110"


def test_extract_route_number_is_case_insensitive():
    assert extract_route_number("i-5") == "I-5"
    assert extract_route_number("sr-99 n/b") == "SR-99"
    assert extract_route_number("State Route 99") == "SR-99"
