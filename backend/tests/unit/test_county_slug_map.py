"""Tests for county slug <-> code lookup."""

from app.county_slug_map import build_map, get_code, slugify_name


def test_slugify_name_lowercase():
    assert slugify_name("Los Angeles") == "los-angeles"


def test_slugify_name_single_word():
    assert slugify_name("Orange") == "orange"


def test_slugify_name_handles_spaces():
    assert slugify_name("San Bernardino") == "san-bernardino"


def test_build_map_from_rows():
    rows = [(1, "Alameda"), (19, "Los Angeles"), (30, "Orange")]
    result = build_map(rows)
    assert result == {"alameda": 1, "los-angeles": 19, "orange": 30}


def test_get_code_returns_code():
    rows = [(19, "Los Angeles")]
    slug_map = build_map(rows)
    assert get_code("los-angeles", slug_map) == 19


def test_get_code_returns_none_for_unknown():
    rows = [(19, "Los Angeles")]
    slug_map = build_map(rows)
    assert get_code("atlantis", slug_map) is None
