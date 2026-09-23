"""Ask AI tools for the four datasets the dashboard shipped ahead of the chat:
road-user mode, CARB EMFAC VMT, crashes within 500 ft of a school, and census
tract burden vs CalEnviroScreen.

Each tool reuses the query path its endpoint already uses, so what is worth
pinning here is the part the model sees: the declared schema, the shape of the
result, the caveat text travelling with the numbers (the model can only repeat
a caveat that is in the payload), the unknown-county error rather than a
silent fall-through to statewide, and the row cap.
"""

from __future__ import annotations

import json

import pytest
from sqlalchemy import text

from app.ai_prompt import TOOL_DEFINITIONS
from app.ai_tools import (
    _MAX_ROWS,
    TOOL_REGISTRY,
    get_mode_breakdown,
    get_school_crashes,
    get_tract_burden,
    get_vmt,
)
from app.models import (
    DataQualityStat,
    SchoolLocation,
    TractCes,
    TractCrashYear,
    Vmt,
)

pytestmark = pytest.mark.integration

_NEW_TOOLS = {
    "get_mode_breakdown": get_mode_breakdown,
    "get_vmt": get_vmt,
    "get_school_crashes": get_school_crashes,
    "get_tract_burden": get_tract_burden,
}

# Shared seed: crash 3 is LA / 2022 / Fatal at (34.05, -118.05); crash 4 is
# Orange / 2023 / Injury at (33.70, -117.80).
_CRASH_3 = (34.05, -118.05)
_CRASH_4 = (33.70, -117.80)


# ── declaration and schema ─────────────────────────────────────────────


def test_tools_are_declared_and_registered():
    names = {d["function"]["name"] for d in TOOL_DEFINITIONS}
    for name, fn in _NEW_TOOLS.items():
        assert name in names, f"{name} missing from TOOL_DEFINITIONS"
        assert TOOL_REGISTRY[name] is fn
    # Registry and prompt definitions stay in sync — a tool the model is told
    # about but cannot call (or vice versa) is worse than a missing one.
    assert set(TOOL_REGISTRY) == names


def test_schemas_are_well_formed():
    scalars = {"string", "integer", "number", "boolean"}
    by_name = {d["function"]["name"]: d for d in TOOL_DEFINITIONS}

    for name in _NEW_TOOLS:
        defn = by_name[name]
        assert defn["type"] == "function"
        params = defn["function"]["parameters"]
        assert params["type"] == "object"
        assert params["properties"], f"{name} declares no parameters"
        for prop, spec in params["properties"].items():
            assert spec["type"] in scalars | {"array"}, f"{name}.{prop}"
            if spec["type"] == "array":
                assert spec["items"]["type"] in scalars, f"{name}.{prop} items"
            if "enum" in spec:
                assert spec["enum"] and all(isinstance(v, str) for v in spec["enum"])
        # All four default to statewide / all years, so nothing is required.
        assert "required" not in params, f"{name} should have no required params"
        # The definitions are POSTed as JSON to the provider.
        assert json.loads(json.dumps(defn)) == defn


def test_descriptions_carry_the_dataset_caveats():
    """The model picks a tool off the description, so the trap has to be in it."""
    desc = {d["function"]["name"]: d["function"]["description"] for d in TOOL_DEFINITIONS}

    assert "2016" in desc["get_mode_breakdown"]
    assert "PEOPLE" in desc["get_mode_breakdown"]
    assert "37%" in desc["get_school_crashes"]
    assert "37%" in desc["get_tract_burden"]
    assert "AADT" in desc["get_vmt"]


# ── get_mode_breakdown ─────────────────────────────────────────────────
# The shared seed's victims: crash 3 (LA, 2022, Fatal) has a fatal driver and
# a severely injured passenger, both car occupants; crash 4 (Orange, 2023,
# Injury) has two occupant passengers and one pedestrian.


def test_mode_breakdown_counts_people_by_road_user(db_session):
    out = get_mode_breakdown(db_session, county="Orange")
    modes = {m["mode"]: m for m in out["modes"]}

    assert modes["occupant"]["victim_count"] == 2
    assert modes["pedestrian"]["victim_count"] == 1
    assert set(modes) <= {"pedestrian", "cyclist", "motorcyclist", "occupant"}


def test_mode_breakdown_reports_its_own_casualties(db_session):
    out = get_mode_breakdown(db_session, county="Los Angeles")
    modes = {m["mode"]: m for m in out["modes"]}

    # Two occupants in the fatal LA crash, one of whom died.
    assert modes["occupant"]["victim_count"] == 2
    assert modes["occupant"]["fatal_victim_count"] == 1


def test_mode_breakdown_applies_the_severity_filter(db_session):
    """severity is the CRASH's severity — only crash 4 is an Injury crash."""
    out = get_mode_breakdown(db_session, severity="Injury")
    modes = {m["mode"]: m for m in out["modes"]}

    assert modes["pedestrian"]["victim_count"] == 1
    assert modes["occupant"]["victim_count"] == 2


def test_mode_breakdown_filters_by_year(db_session):
    """Victim records are CCRS-only, so a pre-2016 year has nothing to report."""
    assert get_mode_breakdown(db_session, years=[2015])["modes"] == []


def test_mode_breakdown_carries_the_people_and_2016_caveats(db_session):
    out = get_mode_breakdown(db_session)

    assert "Counts PEOPLE, not crashes" in out["caveats"]
    assert "starts in 2016" in out["caveats"]
    assert len(out["modes"]) <= _MAX_ROWS


def test_mode_breakdown_unknown_county_errors(db_session):
    assert get_mode_breakdown(db_session, county="Narnia") == {
        "error": "County not found: Narnia"
    }


def test_mode_breakdown_says_so_when_its_view_is_not_built(db_session, monkeypatch):
    """Between a migration and the first refresh, mv_victims_by_mode raises
    55000. The tool must say the data is not built yet, not fail."""
    from sqlalchemy.exc import DBAPIError

    import app.routers.stats as stats

    class NotPopulated(Exception):
        pgcode = "55000"

    def raise_not_populated(*_args, **_kwargs):
        raise DBAPIError("SELECT", {}, NotPopulated())

    monkeypatch.setattr(stats, "_run_group_query", raise_not_populated)
    result = get_mode_breakdown(db_session)
    assert result["modes"] == []
    assert "not been built yet" in result["note"]
    assert "PEOPLE" in result["caveats"]


def test_mode_breakdown_by_year_gives_a_yearly_ksi_series(db_session):
    """A "getting more dangerous" question needs deaths + serious injuries per
    year, not one total. The seed's "Severe" is not a CCRS serious-injury
    code (SuspectSerious), so KSI here is the one 2022 death."""
    rows = get_mode_breakdown(db_session, by_year=True)["modes"]

    assert [r["year"] for r in rows] == [2022, 2023]
    assert (rows[0]["victim_count"], rows[0]["ksi_count"]) == (2, 1)
    assert (rows[1]["victim_count"], rows[1]["ksi_count"]) == (3, 0)


def test_mode_breakdown_filters_to_one_mode(db_session):
    walking = get_mode_breakdown(db_session, mode="pedestrian", by_year=True)
    assert walking["mode"] == "pedestrian"
    assert [(r["year"], r["victim_count"], r["ksi_count"]) for r in walking["modes"]] == [(2023, 1, 0)]

    by_mode = get_mode_breakdown(db_session, mode="pedestrian")["modes"]
    assert [r["mode"] for r in by_mode] == ["pedestrian"]
    assert by_mode[0]["victim_count"] == 1


def test_mode_breakdown_flags_the_years_whose_deaths_are_still_arriving(db_session, monkeypatch):
    """Death records lag six months or more: the latest full year is
    provisional and the current one partial, so a drop there is not news."""
    from datetime import datetime as real_datetime

    import app.ai_tools as ai_tools

    class Frozen2024(real_datetime):
        @classmethod
        def now(cls, tz=None):
            return real_datetime(2024, 9, 22, tzinfo=tz)

    monkeypatch.setattr(ai_tools, "datetime", Frozen2024)
    rows = {r["year"]: r for r in get_mode_breakdown(db_session, by_year=True)["modes"]}

    assert "status" not in rows[2022]
    assert rows[2023]["status"].startswith("provisional")

    monkeypatch.setattr(ai_tools, "datetime", type("F", (real_datetime,), {
        "now": classmethod(lambda cls, tz=None: real_datetime(2023, 3, 1, tzinfo=tz)),
    }))
    rows = {r["year"]: r for r in get_mode_breakdown(db_session, by_year=True)["modes"]}
    assert rows[2023]["status"].startswith("partial year")
    assert rows[2022]["status"].startswith("provisional")


# ── get_vmt ────────────────────────────────────────────────────────────
# The shared seed carries VMT for 2023 only (LA 81,997.43M and Alameda
# 12,120.14M), and LA's crashes are 2014 / 2015 / 2022 — so a rate needs a
# VMT row in a year that also has a crash.


@pytest.fixture()
def vmt_2022(db_session):
    """200M miles driven in LA in 2022, the year of the seeded fatal crash."""
    db_session.add(Vmt(county_code=19, year=2022, vmt_millions=200.0,
                       source="EMFAC2025 v2.1.1"))
    db_session.flush()


def test_vmt_rate_per_100m_vehicle_miles(db_session, vmt_2022):
    out = get_vmt(db_session, county="Los Angeles")
    by_year = {r["year"]: r for r in out["years"]}

    # 1 crash and 1 death against 200M miles = 2 units of 100M VMT.
    assert by_year[2022]["vmt_millions"] == 200.0
    assert by_year[2022]["crash_count"] == 1
    assert by_year[2022]["crashes_per_100m_vmt"] == 0.5
    assert by_year[2022]["killed_per_100m_vmt"] == 0.5


def test_vmt_year_without_crashes_reports_no_rate(db_session, vmt_2022):
    """LA has VMT for 2023 but no 2023 crashes — a rate would be a fabrication."""
    by_year = {r["year"]: r for r in get_vmt(db_session, county="Los Angeles")["years"]}

    assert by_year[2023]["vmt_millions"] == 81997.4
    assert "crashes_per_100m_vmt" not in by_year[2023]
    assert by_year[2023]["crash_count"] is None


def test_vmt_statewide_sums_the_counties(db_session):
    by_year = {r["year"]: r for r in get_vmt(db_session)["years"]}

    # 81,997.43 (LA) + 12,120.14 (Alameda).
    assert by_year[2023]["vmt_millions"] == 94117.6
    # Both 2023 crashes (Orange and San Francisco) are in scope statewide.
    assert by_year[2023]["crash_count"] == 2


def test_vmt_reports_the_coverage_years_it_holds(db_session, vmt_2022):
    out = get_vmt(db_session, county="Los Angeles", year_start=2023)

    assert [r["year"] for r in out["years"]] == [2023]
    # The window narrowed, but what the table covers did not.
    assert out["vmt_years_available"] == "2022-2023"
    assert "EMFAC2025" in out["caveats"]
    assert "AADT" in out["caveats"]


def test_vmt_keeps_the_most_recent_years_at_the_cap(db_session):
    db_session.add_all([
        Vmt(county_code=34, year=y, vmt_millions=1000.0 + y, source="EMFAC2025 v2.1.1")
        for y in range(2001, 2026)
    ])
    db_session.flush()

    years = [r["year"] for r in get_vmt(db_session, county="Sacramento")["years"]]

    assert len(years) == _MAX_ROWS
    assert years == list(range(2006, 2026))


def test_vmt_unknown_county_errors(db_session):
    assert get_vmt(db_session, county="Atlantis") == {
        "error": "County not found: Atlantis"
    }


# ── get_school_crashes ─────────────────────────────────────────────────


@pytest.fixture()
def schools_near_crashes(db_session):
    """Three schools inside crash 3's 500 ft circle, one on crash 4.

    Both the inserts and the REFRESH run inside the per-test transaction, so
    the rollback puts the view back to WITH NO DATA for the test below that
    needs the pre-refresh state.
    """
    db_session.add_all([
        SchoolLocation(cds_code="19000000000201", school_name="On Crash High",
                       county_code=19, city="Los Angeles", school_type="High",
                       status="Active", latitude=_CRASH_3[0], longitude=_CRASH_3[1]),
        # ~182 ft north and south — well inside the 500 ft circle.
        SchoolLocation(cds_code="19000000000202", school_name="North Elementary",
                       county_code=19, city="Los Angeles", school_type="Elementary",
                       status="Active", latitude=_CRASH_3[0] + 0.0005,
                       longitude=_CRASH_3[1]),
        SchoolLocation(cds_code="19000000000203", school_name="South Middle",
                       county_code=19, city="Los Angeles", school_type="Middle",
                       status="Active", latitude=_CRASH_3[0] - 0.0005,
                       longitude=_CRASH_3[1]),
        SchoolLocation(cds_code="30000000000204", school_name="Anaheim High",
                       county_code=30, city="Anaheim", school_type="High",
                       status="Active", latitude=_CRASH_4[0], longitude=_CRASH_4[1]),
    ])
    db_session.flush()
    db_session.execute(text("REFRESH MATERIALIZED VIEW mv_school_crash_counts"))


def test_school_crashes_totals_and_top_list(db_session, schools_near_crashes):
    out = get_school_crashes(db_session, county="Los Angeles")

    # All three LA schools sit within 500 ft of the one seeded 2022 crash.
    assert out["schools_with_a_nearby_crash"] == 3
    assert out["total_crashes_near_schools"] == 3
    assert out["total_killed_near_schools"] == 3
    assert {s["school_name"] for s in out["top_schools"]} == {
        "On Crash High", "North Elementary", "South Middle",
    }
    assert out["top_schools"][0]["crashes"] == 1
    assert out["top_schools"][0]["city"] == "Los Angeles"


def test_school_crashes_filters_by_county(db_session, schools_near_crashes):
    out = get_school_crashes(db_session, county="Orange")

    assert [s["school_name"] for s in out["top_schools"]] == ["Anaheim High"]
    assert out["total_injured_near_schools"] == 3


def test_school_crashes_filters_by_year(db_session, schools_near_crashes):
    """Crash 3 is 2022 (LA), crash 4 is 2023 (Orange)."""
    out = get_school_crashes(db_session, years=[2023])

    assert out["years"] == [2023]
    assert [s["school_name"] for s in out["top_schools"]] == ["Anaheim High"]


def test_school_crashes_caps_rows_but_not_totals(db_session, schools_near_crashes):
    """The cap must not silently shrink the answer to 'how many near schools'."""
    out = get_school_crashes(db_session, county="Los Angeles", limit=1)

    assert len(out["top_schools"]) == 1
    assert out["schools_with_a_nearby_crash"] == 3
    assert out["total_crashes_near_schools"] == 3


def test_school_crashes_limit_is_clamped_to_the_max(db_session, schools_near_crashes):
    out = get_school_crashes(db_session, limit=500)
    assert len(out["top_schools"]) <= _MAX_ROWS


def test_school_crashes_reports_coordinate_coverage(db_session, schools_near_crashes):
    """The caveat is the point: only located crashes can be near a school."""
    out = get_school_crashes(db_session, county="Los Angeles")

    # Seeded data-quality rollup for LA: 4,200,000 crashes, 4,000,000 located.
    assert out["coord_coverage_pct"] == 95.2
    assert "500 ft" in out["caveats"]
    assert "located crashes only" in out["caveats"]

    # ?years= reads the per-year rows instead: 500,000 / 480,000 for 2023.
    assert get_school_crashes(db_session, county="Los Angeles",
                              years=[2023])["coord_coverage_pct"] == 96.0


def test_school_crashes_unpopulated_view_says_so(db_session):
    """The state prod is in between a deploy and the next nightly refresh."""
    out = get_school_crashes(db_session, county="Los Angeles")

    assert out["top_schools"] == []
    assert out["total_crashes_near_schools"] == 0
    assert "refreshes nightly" in out["note"]


def test_school_crashes_unknown_county_errors(db_session):
    assert get_school_crashes(db_session, county="Narnia") == {
        "error": "County not found: Narnia"
    }


# ── get_tract_burden ───────────────────────────────────────────────────


@pytest.fixture()
def tracts(db_session):
    db_session.add_all([
        # Two high-burden LA tracts, so the band has to sum across tracts.
        TractCes(geoid="06037100100", county_code=19, ces_score=45.0,
                 ces_percentile=88.0, population=4000),
        TractCes(geoid="06037100400", county_code=19, ces_score=44.0,
                 ces_percentile=85.0, population=1000),
        TractCes(geoid="06037100200", county_code=19, ces_score=12.0,
                 ces_percentile=15.0, population=2000),
        # CES scored this one but gave it neither a percentile nor a population.
        TractCes(geoid="06037100300", county_code=19, ces_score=40.0,
                 ces_percentile=None, population=None),
        TractCes(geoid="06059010100", county_code=30, ces_score=30.0,
                 ces_percentile=50.0, population=1000),
    ])
    db_session.add_all([
        TractCrashYear(geoid="06037100100", year=2022, crash_count=10, killed=1, injured=4),
        TractCrashYear(geoid="06037100100", year=2023, crash_count=30, killed=2, injured=6),
        TractCrashYear(geoid="06037100400", year=2023, crash_count=10, killed=0, injured=3),
        TractCrashYear(geoid="06037100200", year=2023, crash_count=5, killed=0, injured=1),
        # Outside every window the tests ask for.
        TractCrashYear(geoid="06037100200", year=2019, crash_count=999, killed=99, injured=99),
        TractCrashYear(geoid="06037100300", year=2023, crash_count=7, killed=1, injured=2),
    ])
    db_session.add_all([
        # Statewide coverage rows (county_code NULL) — what coord_share reads.
        DataQualityStat(county_code=None, year=2022, total_crashes=1000,
                        crashes_with_coords=300, coords_pct=30.0),
        DataQualityStat(county_code=None, year=2023, total_crashes=1000,
                        crashes_with_coords=500, coords_pct=50.0),
    ])
    db_session.flush()


def _bands(out):
    return {b["ces_band"]: b for b in out["burden_bands"]}


def test_tract_burden_sums_crashes_by_ces_band(db_session, tracts):
    bands = _bands(get_tract_burden(db_session, county="Los Angeles",
                                    year_start=2022, year_end=2023))

    top = bands["80-100 (most burdened)"]
    assert top["tract_count"] == 2
    assert top["crash_count"] == 50          # 10 + 30 + 10
    assert top["killed"] == 3
    # 2019 is outside the window and must not be summed in.
    assert bands["0-20 (least burdened)"]["crash_count"] == 5


def test_tract_burden_rate_uses_tract_population_once(db_session, tracts):
    """A tract with N crash-years must contribute its population once, not N
    times — otherwise the band's rate is silently halved."""
    bands = _bands(get_tract_burden(db_session, county="Los Angeles",
                                    year_start=2022, year_end=2023))

    assert bands["80-100 (most burdened)"]["population"] == 5000
    assert bands["80-100 (most burdened)"]["crashes_per_1k_pop"] == 10.0
    assert bands["0-20 (least burdened)"]["crashes_per_1k_pop"] == 2.5


def test_tract_burden_unscored_band_has_no_rate(db_session, tracts):
    bands = _bands(get_tract_burden(db_session, county="Los Angeles",
                                    year_start=2022, year_end=2023))

    assert bands["unscored"]["crash_count"] == 7
    assert bands["unscored"]["population"] is None
    assert bands["unscored"]["crashes_per_1k_pop"] is None


def test_tract_burden_top_tracts_are_ranked(db_session, tracts):
    out = get_tract_burden(db_session, year_start=2022, year_end=2023)
    top = out["top_tracts"][0]

    assert top["geoid"] == "06037100100"
    assert top["crash_count"] == 40
    assert top["ces_percentile"] == 88.0
    assert top["crashes_per_1k_pop"] == 10.0
    # The Orange tract has no crash rows at all but is still a tract.
    assert any(t["geoid"] == "06059010100" and t["crash_count"] == 0
               for t in out["top_tracts"])


def test_tract_burden_caps_top_tracts(db_session, tracts):
    out = get_tract_burden(db_session, year_start=2022, year_end=2023, limit=2)
    assert [t["geoid"] for t in out["top_tracts"]] == ["06037100100", "06037100400"]

    assert len(get_tract_burden(db_session, limit=500)["top_tracts"]) <= _MAX_ROWS


def test_tract_burden_filters_by_county(db_session, tracts):
    out = get_tract_burden(db_session, county="Orange", year_start=2022, year_end=2023)
    assert [t["geoid"] for t in out["top_tracts"]] == ["06059010100"]


def test_tract_burden_carries_the_coverage_and_ces_caveats(db_session, tracts):
    out = get_tract_burden(db_session, year_start=2022, year_end=2023)

    # (300 + 500) / (1000 + 1000) for the selected window.
    assert out["coord_share"] == 0.4
    assert "100 = most burdened" in out["caveats"]
    assert "association" in out["caveats"]


def test_tract_burden_empty_tables_are_not_an_error(db_session):
    """The state prod is in between a deploy and the first tract load."""
    out = get_tract_burden(db_session, year_start=2022, year_end=2023)

    assert out["burden_bands"] == []
    assert out["top_tracts"] == []


def test_tract_burden_unknown_county_errors(db_session):
    assert get_tract_burden(db_session, county="Atlantis") == {
        "error": "County not found: Atlantis"
    }
