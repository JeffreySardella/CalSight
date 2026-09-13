"""The Ask AI `first_rain` tool: declared, registered, and formats the shared
router summary into compact JSON. No live Postgres — the session is faked at
db.execute with a queue of canned results in the order build_first_rain
issues its four statements (weather_through, events, last rain, counties)."""

from datetime import date
from json import dumps
from types import SimpleNamespace

from app.ai_prompt import TOOL_DEFINITIONS
from app.ai_tools import TOOL_REGISTRY, get_first_rain
from etl.compute_first_rain import MATURITY_DAYS


class FakeResult:
    def __init__(self, payload):
        self._payload = payload

    def scalar(self):
        return self._payload

    def all(self):
        return self._payload

    def first(self):
        return self._payload[0] if self._payload else None


class FakeDB:
    def __init__(self, *results):
        self._results = list(results)

    def execute(self, stmt, *args, **kwargs):
        return FakeResult(self._results.pop(0))


def _event(county_code, water_year, first_rain_date, crashes_on_day, baseline, lift):
    return SimpleNamespace(
        county_code=county_code, water_year=water_year, first_rain_date=first_rain_date,
        precip_in=0.4, dry_days_before=20, crashes_on_day=crashes_on_day,
        baseline_daily_crashes=baseline, lift_pct=lift,
    )


LA_2025 = _event(19, 2025, date(2024, 11, 4), 380, 300.0, 26.7)
LA_2026 = _event(19, 2026, date(2025, 10, 21), 412, 315.4, 30.6)
ALPINE_2026 = _event(3, 2026, date(2025, 10, 21), 3, 1.0, 200.0)


def _db(*extra):
    return FakeDB(
        date(2025, 11, 2),
        [(LA_2025, "Los Angeles"), (ALPINE_2026, "Alpine"), (LA_2026, "Los Angeles")],
        [(19, date(2025, 10, 21)), (3, date(2025, 11, 2))],
        [(3, "Alpine"), (19, "Los Angeles"), (30, "Orange")],
        *extra,
    )


def test_tool_is_declared_and_registered():
    names = {d["function"]["name"] for d in TOOL_DEFINITIONS}
    assert "first_rain" in names
    assert TOOL_REGISTRY["first_rain"] is get_first_rain
    assert set(TOOL_REGISTRY) == names


def test_statewide_summary_uses_latest_water_year():
    out = TOOL_REGISTRY["first_rain"](_db())
    assert "county" not in out
    assert "Association, not causation" in out["definition"]
    assert f"{MATURITY_DAYS} days (~6 weeks)" in out["definition"]
    assert out["weather_through"] == "2025-11-02"
    assert out["statewide"]["water_years"] == 2
    assert out["statewide"]["event"]["water_year"] == 2026
    assert out["statewide"]["event"]["counties"] == 2
    assert out["statewide"]["event"]["crashes_on_first_rain_days"] == 415
    assert len(dumps(out)) < 1500


def test_county_gets_latest_event_and_days_since_rain():
    out = get_first_rain(_db(), county="los-angeles")
    county = out["county"]
    assert county["county_name"] == "Los Angeles"
    assert county["days_since_rain"] == 12
    assert county["last_rain_date"] == "2025-10-21"
    assert county["event"]["water_year"] == 2026
    assert county["event"]["first_rain_date"] == "2025-10-21"
    assert county["event"]["lift_pct"] == 30.6
    assert county["event"]["small_baseline"] is False
    assert len(dumps(out)) < 1500


def test_county_accepts_a_display_name_and_flags_small_baselines():
    out = get_first_rain(_db(), county="Alpine")
    assert out["county"]["days_since_rain"] == 0
    assert out["county"]["event"]["small_baseline"] is True


def test_county_without_an_event_still_reports_rain():
    out = get_first_rain(_db(), county="orange")
    assert out["county"]["event"] is None
    assert out["county"]["days_since_rain"] is None


def test_explicit_water_year_looks_up_that_event():
    out = get_first_rain(_db([(LA_2025, "Los Angeles")]), county="Los Angeles", water_year=2025)
    assert out["statewide"]["event"]["water_year"] == 2025
    assert out["county"]["event"]["water_year"] == 2025
    assert out["county"]["event"]["crashes_on_day"] == 380


def test_unknown_county_errors():
    assert "error" in get_first_rain(_db(), county="Atlantis")
