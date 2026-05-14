"""Tests for city-name normalization shared by ETL, seeder, and API."""

import pytest

from app.cities_match import normalize_name


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("Oakland", "oakland"),
        ("OAKLAND", "oakland"),
        ("oakland", "oakland"),
        ("  Oakland  ", "oakland"),
        ("Oakland, CA", "oakland"),
        ("Oakland, California", "oakland"),
        ("Oakland CA", "oakland"),
        ("City of Fresno", "fresno"),
        ("Town of Truckee", "truckee"),
        ("Mountain View city", "mountain view"),
        ("San José", "san jose"),
        ("San José, CA", "san jose"),
        ("St. Helena", "st helena"),
        ("O'Neals", "o neals"),
        ("  Los   Angeles  ", "los angeles"),
    ],
)
def test_normalize_name_variants(raw, expected):
    assert normalize_name(raw) == expected


def test_normalize_name_none_returns_empty():
    assert normalize_name(None) == ""


def test_normalize_name_empty_returns_empty():
    assert normalize_name("") == ""


def test_normalize_name_idempotent():
    once = normalize_name("Mountain View city")
    twice = normalize_name(once)
    assert once == twice == "mountain view"
