"""Unit tests for lived-density helpers (no DB, no network)."""

from etl.census_tract_density import (
    compute_weighted_density,
    gazetteer_year_for,
    aggregate_county_density,
)


def test_weighted_density_two_tracts():
    # tract A: pop 1000, area 1 -> density 1000
    # tract B: pop 3000, area 1 -> density 3000
    # weighted = (1000^2/1 + 3000^2/1) / (1000+3000) = 10_000_000/4000 = 2500
    out = compute_weighted_density([
        {"pop": 1000, "area_sqmi": 1.0},
        {"pop": 3000, "area_sqmi": 1.0},
    ])
    assert out == (2500.0, 2)


def test_weighted_density_single_tract_equals_its_density():
    out = compute_weighted_density([{"pop": 500, "area_sqmi": 2.0}])
    assert out == (250.0, 1)


def test_weighted_density_excludes_invalid_tracts():
    out = compute_weighted_density([
        {"pop": 1000, "area_sqmi": 1.0},  # valid
        {"pop": 0, "area_sqmi": 1.0},      # pop 0 -> excluded
        {"pop": 500, "area_sqmi": 0.0},    # area 0 -> excluded
        {"pop": None, "area_sqmi": 1.0},   # pop None -> excluded
    ])
    assert out == (1000.0, 1)


def test_weighted_density_none_when_no_contributing_tracts():
    assert compute_weighted_density([]) is None
    assert compute_weighted_density([{"pop": 0, "area_sqmi": 0.0}]) is None


def test_gazetteer_year_for_boundary():
    assert gazetteer_year_for(2015) == 2019
    assert gazetteer_year_for(2019) == 2019
    assert gazetteer_year_for(2020) == 2023
    assert gazetteer_year_for(2022) == 2023


def test_aggregate_joins_groups_and_skips():
    # county 001 -> code 1, county 037 -> code 19
    lookup = {1: 1, 37: 19}
    gaz = {
        "06001400100": 1.0,
        "06001400200": 1.0,
        "06037900100": 2.0,
        # 06037900200 intentionally missing land area -> skipped
    }
    rows = [
        {"geoid": "06001400100", "pop": 1000},
        {"geoid": "06001400200", "pop": 3000},
        {"geoid": "06037900100", "pop": 500},
        {"geoid": "06037900200", "pop": 9999},  # no land area -> skipped
        {"geoid": "06099000100", "pop": 100},   # county 099 not in lookup -> skipped
    ]
    out = {r["county_code"]: r for r in aggregate_county_density(rows, gaz, lookup, 2022)}
    assert set(out) == {1, 19}
    assert out[1]["weighted_density"] == 2500.0
    assert out[1]["tract_count"] == 2
    assert out[1]["year"] == 2022
    assert out[19]["weighted_density"] == 250.0
    assert out[19]["tract_count"] == 1
