"""Unit tests for FARS aggregation helpers (no DB, no network)."""

from etl.nhtsa_fars import build_county_lookup, aggregate_fars


def test_build_county_lookup_maps_last_three_fips_digits():
    lookup = build_county_lookup([(1, "06001"), (19, "06037"), (30, "06059")])
    assert lookup == {1: 1, 37: 19, 59: 30}


def test_build_county_lookup_skips_missing_fips():
    lookup = build_county_lookup([(1, "06001"), (99, None), (98, "")])
    assert lookup == {1: 1}


def _person(state="6", county="37", inj="4", rest="3"):
    return {"STATE": state, "COUNTY": county, "INJ_SEV": inj, "REST_USE": rest}


def test_aggregate_counts_fatalities_per_county():
    lookup = {37: 19, 59: 30}
    rows = [_person(county="37"), _person(county="37"), _person(county="59")]
    out = {r["county_code"]: r for r in aggregate_fars(rows, lookup, 2022)}
    assert out[19]["fatalities"] == 2
    assert out[30]["fatalities"] == 1
    assert out[19]["year"] == 2022


def test_aggregate_classifies_restraint():
    lookup = {37: 19}
    rows = [
        _person(rest="0"),   # unrestrained + known
        _person(rest="3"),   # restrained + known
        _person(rest="99"),  # unknown -> excluded from denominator
    ]
    out = aggregate_fars(rows, lookup, 2022)[0]
    assert out["fatalities"] == 3
    assert out["unrestrained_killed"] == 1
    assert out["restraint_known_killed"] == 2


def test_aggregate_skips_non_ca_and_non_fatal_and_unmapped():
    lookup = {37: 19}
    rows = [
        _person(state="48"),            # not CA
        _person(inj="1"),               # injured, not killed
        _person(county="999"),          # unmapped county
        _person(),                      # valid -> counted
    ]
    out = aggregate_fars(rows, lookup, 2022)
    assert len(out) == 1
    assert out[0]["county_code"] == 19
    assert out[0]["fatalities"] == 1
