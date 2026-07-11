"""US Drought Monitor API client — weekly drought severity per county.

Fetches county-level drought statistics from the USDM data services API
(https://usdmdataservices.unl.edu). The Drought Monitor publishes one map
per week (valid Tuesdays); for each county it reports the percent of land
area in each severity class:

    None  no drought
    D0    abnormally dry
    D1    moderate drought
    D2    severe drought
    D3    extreme drought
    D4    exceptional drought

Endpoint used (GET, JSON):

    https://usdmdataservices.unl.edu/api/CountyStatistics/
        GetDroughtSeverityStatisticsByAreaPercent
        ?aoi=CA&startdate=1/1/2024&enddate=7/1/2026&statisticsType=2

Response: a JSON array with one row per (county, week). The live API
returns PascalCase keys (the no-drought key is literally ``None``) and
percent values as quoted strings; parsing here is case-insensitive and
coerces the strings:

    [
        {
            "MapDate": "2026-06-30T00:00:00",
            "FIPS": "06067",
            "County": "Sacramento County",
            "State": "CA",
            "None": "12.34",
            "D0": "45.00",
            "D1": "30.00",
            "D2": "12.66",
            "D3": "0.00",
            "D4": "0.00",
            "ValidStart": "2026-06-30",
            "ValidEnd": "2026-07-06",
            "StatisticFormatID": 2
        },
        ...
    ]

``aoi=CA`` (state abbreviation) is valid for CountyStatistics and returns
every California county. ``validStart`` is the map's Tuesday; maps are
released the following Thursday.

NOTE: the request/response shape is web-verified against the official
USDM docs (droughtmonitor.unl.edu Statistics Explanation / Web Service
Information) and multiple real captured responses in public code, but
the endpoint was not reachable from the authoring sandbox. Confirm
end-to-end with the smoke test first:

    python -m etl.usdm_api --smoke
"""

import argparse
import logging
from dataclasses import dataclass
from datetime import date, datetime

from etl._utils import get_with_retry, safe_float

logger = logging.getLogger(__name__)

USDM_BASE_URL = (
    "https://usdmdataservices.unl.edu/api/CountyStatistics/"
    "GetDroughtSeverityStatisticsByAreaPercent"
)

# statisticsType controls how the six area percentages relate:
#   1 = "traditional"/cumulative — each class is percent-in-that-class-OR-WORSE,
#       so D0 >= D1 >= ... and None + D0 = 100 (does NOT sum across classes).
#   2 = "categorical" — non-overlapping classes, so None + D0 + ... + D4 = 100.
# We need the categorical breakdown: the 100%-stacked severity bar and the
# "D1+" in-drought share both assume exclusive, additive percentages.
# (Verified against droughtmonitor.unl.edu's Statistics Explanation page.)
STATISTICS_TYPE_CATEGORICAL = 2


@dataclass(frozen=True)
class DroughtWeek:
    """One county-week of drought area percentages (categorical stats:
    the classes are exclusive and sum to ~100 with none_pct)."""

    fips: str  # 5-digit county FIPS, e.g. "06067"
    week_start: date  # the map's valid start date
    none_pct: float
    d0_pct: float
    d1_pct: float
    d2_pct: float
    d3_pct: float
    d4_pct: float


def fetch_county_drought(start: date, end: date, aoi: str = "CA") -> list[dict]:
    """Fetch raw county drought rows for [start, end].

    USDM expects M/D/YYYY dates. Transient failures retry via
    etl._utils.get_with_retry (5xx/network only, like the other clients).
    """
    params = {
        "aoi": aoi,
        "startdate": f"{start.month}/{start.day}/{start.year}",
        "enddate": f"{end.month}/{end.day}/{end.year}",
        "statisticsType": str(STATISTICS_TYPE_CATEGORICAL),
    }
    headers = {"Accept": "application/json"}

    resp = get_with_retry(USDM_BASE_URL, params=params, headers=headers, timeout=120)
    data = resp.json()
    if not isinstance(data, list):
        raise ValueError(
            f"USDM returned {type(data).__name__}, expected a JSON array"
        )
    return data


def _get_ci(row: dict, key: str):
    """Case-insensitive dict lookup — USDM key casing has varied."""
    for k, v in row.items():
        if k.lower() == key:
            return v
    return None


def _parse_usdm_date(raw) -> date | None:
    raw = str(raw or "").strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(raw.split(".")[0], fmt).date()
        except ValueError:
            continue
    return None


def _parse_pct(raw) -> float | None:
    if raw is None:
        return None
    # Percents arrive as strings, sometimes with thousands separators.
    value = safe_float(str(raw).replace(",", ""))
    if value is None or value < 0:
        return None
    return value


def parse_drought_weeks(raw: list[dict]) -> list[DroughtWeek]:
    """Turn raw API rows into clean DroughtWeek records.

    Drops rows with an unusable FIPS, date, or any missing percent —
    counted and logged, never silent.
    """
    weeks: list[DroughtWeek] = []
    dropped = 0

    for row in raw:
        raw_fips = str(_get_ci(row, "fips") or "").strip()
        # zfill only a real numeric FIPS — "" would zero-fill to "00000".
        fips = raw_fips.zfill(5) if raw_fips.isdigit() else ""
        week_start = _parse_usdm_date(
            _get_ci(row, "validstart") or _get_ci(row, "mapdate")
        )
        pcts = [
            _parse_pct(_get_ci(row, key))
            for key in ("none", "d0", "d1", "d2", "d3", "d4")
        ]

        if len(fips) != 5 or not fips.isdigit() or week_start is None or None in pcts:
            dropped += 1
            continue

        weeks.append(DroughtWeek(fips, week_start, *pcts))  # type: ignore[arg-type]

    if dropped:
        logger.info(
            "parse_drought_weeks: kept %d rows, dropped %d (missing/invalid)",
            len(weeks),
            dropped,
        )
    return weeks


def _smoke_test() -> int:
    """Hit the live API for the last month of CA data and print a sample."""
    from datetime import timedelta

    end = date.today()
    start = end - timedelta(days=31)
    print(f"Fetching CA county drought {start} → {end} ...")
    raw = fetch_county_drought(start, end)
    print(f"Raw rows: {len(raw)}")
    if raw:
        print(f"First raw row: {raw[0]}")
    weeks = parse_drought_weeks(raw)
    for w in weeks[:5]:
        print(
            f"  {w.fips} {w.week_start}  none={w.none_pct:.0f} "
            f"d0={w.d0_pct:.0f} d1={w.d1_pct:.0f} d2={w.d2_pct:.0f} "
            f"d3={w.d3_pct:.0f} d4={w.d4_pct:.0f}"
        )
    if not weeks:
        print("No rows parsed — check the response shape above.")
        return 1
    print("Smoke test OK.")
    return 0


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
        datefmt="%H:%M:%S",
    )
    parser = argparse.ArgumentParser(description="US Drought Monitor API client")
    parser.add_argument(
        "--smoke", action="store_true", help="run a live smoke test"
    )
    args = parser.parse_args()
    if args.smoke:
        raise SystemExit(_smoke_test())
    parser.print_help()
