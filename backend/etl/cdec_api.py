"""CDEC API client — California reservoir storage time series.

Fetches daily sensor data from the California Data Exchange Center's
JSON Data Servlet (https://cdec.water.ca.gov). CDEC is DWR's public
hub for real-time hydrologic data: reservoir storage, snow water
content, river stages, and more.

The servlet returns a JSON array (no envelope). Field casing is mixed —
``stationId`` is camelCase while the sensor field is ``SENSOR_NUM``
(upper), confirmed against production CDEC clients (drivendataorg
water-supply-forecast-rodeo, ncss-tech/sharpshootR):
    [
        {
            "stationId": "SHA",
            "durCode": "D",
            "SENSOR_NUM": 15,
            "sensorType": "STORAGE",
            "date": "2026-07-01 00:00",
            "value": 3201453,
            "dataFlag": " ",
            "units": "AF"
        },
        ...
    ]

Missing observations come back as -9999 (sometimes as the string
"---"); parse_observations() drops them rather than storing sentinel
values. parse_observations reads both ``SENSOR_NUM`` and the newer
``sensorNumber`` for the (informational) sensor field.

NOTE: the request/response shape is web-verified against production CDEC
clients, but the endpoint itself was not reachable from the authoring
sandbox. Confirm end-to-end with the live smoke test before wiring a
loader on top of this:

    python -m etl.cdec_api --smoke
"""

import argparse
import logging
from dataclasses import dataclass
from datetime import date, datetime

from etl._utils import get_with_retry, safe_int

logger = logging.getLogger(__name__)

CDEC_BASE_URL = "https://cdec.water.ca.gov/dynamicapp/req/JSONDataServlet"
REQUEST_DELAY = 0.5  # courtesy delay between batched requests

# CDEC sensor numbers (https://cdec.water.ca.gov/misc/senslist.html)
SENSOR_STORAGE = 15  # reservoir storage, acre-feet
SENSOR_SNOW_WATER_CONTENT = 3  # snow water content, inches

MISSING_VALUE = -9999

# Major reservoirs tracked in v1, keyed by CDEC station id. Static map by
# design — CDEC has no clean metadata API — mirroring the RESOURCE_IDS
# pattern in ckan_api.py. Capacities (gross pool, acre-feet) and counties
# were verified July 2026 against CDEC station pages, DWR/USBR/USACE
# publications, and Wikipedia cross-checks.
#
# County notes: for reservoirs whose water body spans a county line we use
# the DAM's county (the convention CDEC/DWR follow). NML (dam on the
# Tuolumne/Calaveras line) and MIL (Friant Dam, Fresno, on the
# Fresno/Madera line) are the ambiguous ones. ISB reflects full gross pool
# — the pre-2023 storage restriction was lifted after the USACE Isabella
# Dam Safety Modification Project completed.
MAJOR_RESERVOIRS = {
    "SHA": {"name": "Shasta Lake", "capacity_af": 4_552_000, "county": "Shasta"},
    "ORO": {"name": "Lake Oroville", "capacity_af": 3_537_577, "county": "Butte"},
    "CLE": {"name": "Trinity Lake", "capacity_af": 2_447_650, "county": "Trinity"},
    "NML": {"name": "New Melones Lake", "capacity_af": 2_400_000, "county": "Tuolumne"},
    "SNL": {"name": "San Luis Reservoir", "capacity_af": 2_041_000, "county": "Merced"},
    "DNP": {"name": "Don Pedro Reservoir", "capacity_af": 2_030_000, "county": "Tuolumne"},
    "BER": {"name": "Lake Berryessa", "capacity_af": 1_602_000, "county": "Napa"},
    "EXC": {"name": "Lake McClure", "capacity_af": 1_024_600, "county": "Mariposa"},
    "PNF": {"name": "Pine Flat Reservoir", "capacity_af": 1_000_000, "county": "Fresno"},
    "FOL": {"name": "Folsom Lake", "capacity_af": 977_000, "county": "Sacramento"},
    "BUL": {"name": "New Bullards Bar", "capacity_af": 966_103, "county": "Yuba"},
    "ISB": {"name": "Lake Isabella", "capacity_af": 568_000, "county": "Kern"},
    "MIL": {"name": "Millerton Lake", "capacity_af": 520_500, "county": "Fresno"},
    "CAS": {"name": "Castaic Lake", "capacity_af": 325_000, "county": "Los Angeles"},
    "PYM": {"name": "Pyramid Lake", "capacity_af": 171_200, "county": "Los Angeles"},
}


@dataclass(frozen=True)
class Observation:
    """One clean daily sensor reading."""

    station_id: str
    sensor: int
    date: date
    value: float
    units: str


def fetch_sensor_data(
    stations: list[str],
    sensor: int,
    start: date,
    end: date,
    duration: str = "D",
) -> list[dict]:
    """Fetch raw sensor rows for a batch of stations from the CDEC servlet.

    Args:
        stations: CDEC station ids, e.g. ["SHA", "ORO"]. CDEC accepts a
            comma-separated batch, so one request covers many stations.
        sensor: CDEC sensor number (15 = storage).
        start / end: inclusive date range.
        duration: "D" daily, "M" monthly, "H" hourly.

    Returns the raw list of record dicts. Transient failures retry via
    etl._utils.get_with_retry (5xx/network only, like the other clients).
    """
    params = {
        "Stations": ",".join(stations),
        "SensorNums": str(sensor),
        # Production CDEC clients in the wild send the duration lowercase.
        "dur_code": duration.lower(),
        "Start": start.isoformat(),
        "End": end.isoformat(),
    }

    resp = get_with_retry(CDEC_BASE_URL, params=params, timeout=60)
    data = resp.json()
    if not isinstance(data, list):
        raise ValueError(
            f"CDEC returned {type(data).__name__}, expected a JSON array"
        )
    return data


def parse_observations(raw: list[dict]) -> list[Observation]:
    """Turn raw servlet rows into clean Observations.

    Drops rows with missing/sentinel values (-9999, "---", null) and rows
    whose date can't be parsed, logging counts instead of failing the run —
    same silently-drop-nothing philosophy as load_crashes: every drop is
    counted and reported.
    """
    observations: list[Observation] = []
    dropped = 0

    for row in raw:
        value = row.get("value")
        if value is None or value == "---":
            dropped += 1
            continue
        try:
            value = float(value)
        except (TypeError, ValueError):
            dropped += 1
            continue
        if value == MISSING_VALUE:
            dropped += 1
            continue

        raw_date = row.get("date", "")
        parsed_date = _parse_cdec_date(raw_date)
        if parsed_date is None:
            dropped += 1
            continue

        station = str(row.get("stationId", "")).strip().upper()
        if not station:
            dropped += 1
            continue

        observations.append(
            Observation(
                station_id=station,
                # Informational only (the loader keys on station+date), so a
                # null/garbled sensor number must not abort the run.
                sensor=safe_int(row.get("sensorNumber", row.get("SENSOR_NUM"))) or 0,
                date=parsed_date,
                value=value,
                units=str(row.get("units", "")).strip(),
            )
        )

    if dropped:
        logger.info(
            "parse_observations: kept %d rows, dropped %d (missing/invalid)",
            len(observations),
            dropped,
        )
    return observations


def _parse_cdec_date(raw: str) -> date | None:
    """Parse CDEC's date strings.

    Observed formats: "2026-7-1 00:00" (no zero padding) and
    "2026-07-01 00:00". Returns None if nothing matches.
    """
    raw = str(raw).strip()
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d", "%m/%d/%Y %H:%M", "%m/%d/%Y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


def fetch_reservoir_storage(start: date, end: date) -> list[Observation]:
    """Fetch daily storage for every reservoir in MAJOR_RESERVOIRS."""
    raw = fetch_sensor_data(
        stations=sorted(MAJOR_RESERVOIRS),
        sensor=SENSOR_STORAGE,
        start=start,
        end=end,
    )
    return parse_observations(raw)


def _smoke_test() -> int:
    """Hit the live servlet for one week of Shasta storage and print it.

    This is the first thing to run outside the sandbox — it validates the
    endpoint, the response shape, and the parser against reality.
    """
    from datetime import timedelta

    end = date.today()
    start = end - timedelta(days=7)
    print(f"Fetching SHA storage {start} → {end} ...")
    raw = fetch_sensor_data(["SHA"], SENSOR_STORAGE, start, end)
    print(f"Raw rows: {len(raw)}")
    if raw:
        print(f"First raw row: {raw[0]}")
    obs = parse_observations(raw)
    for o in obs:
        print(f"  {o.date}  {o.value:,.0f} {o.units}")
    if not obs:
        print("No observations parsed — check the response shape above.")
        return 1
    print("Smoke test OK.")
    return 0


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
        datefmt="%H:%M:%S",
    )
    parser = argparse.ArgumentParser(description="CDEC API client spike")
    parser.add_argument(
        "--smoke", action="store_true", help="run a live one-station smoke test"
    )
    args = parser.parse_args()
    if args.smoke:
        raise SystemExit(_smoke_test())
    parser.print_help()
