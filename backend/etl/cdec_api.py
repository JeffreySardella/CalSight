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
import time
from dataclasses import dataclass
from datetime import date, datetime

from etl._utils import get_with_retry, require_rows, safe_int

logger = logging.getLogger(__name__)

CDEC_BASE_URL = "https://cdec.water.ca.gov/dynamicapp/req/JSONDataServlet"
REQUEST_DELAY = 0.5  # courtesy delay between batched requests
# 110 snow stations x a 365-day backfill window is too much for one servlet
# call; the station list goes out in chunks of this size.
SNOW_STATIONS_PER_REQUEST = 25

# CDEC sensor numbers (https://cdec.water.ca.gov/misc/senslist.html)
SENSOR_STORAGE = 15  # reservoir storage, acre-feet
SENSOR_SNOW_WATER_CONTENT = 3  # snow water content (raw daily SWE), inches
SENSOR_SNOW_WATER_CONTENT_REVISED = 82  # DWR-adjusted daily SWE, inches
SENSOR_PRECIP_ACCUM = 2  # accumulated precipitation (water-year total), inches

MISSING_VALUE = -9999

# DWR's three regional precipitation indices — the headline California
# wet-season numbers journalists reproduce every winter. Each is itself a
# CDEC "station" whose sensor 2 reports the region's accumulated water-year
# precipitation (inches), so no per-gauge aggregation is needed: one index =
# one region. Station codes + station counts verified live 2026-07 against the
# CDEC JSONDataServlet (sensor 2 returns "RAIN"/INCHES cumulative). The
# 8-Station Index is the canonical Northern Sierra figure.
PRECIP_REGION_NORTH = "Northern Sierra (8-Station)"
PRECIP_REGION_SANJOAQUIN = "San Joaquin (5-Station)"
PRECIP_REGION_TULARE = "Tulare Basin (6-Station)"

PRECIP_INDEX_STATIONS = {
    "8SI": {"name": "Northern Sierra 8-Station Index", "region": PRECIP_REGION_NORTH},
    "5SI": {"name": "San Joaquin 5-Station Index", "region": PRECIP_REGION_SANJOAQUIN},
    "6SI": {"name": "Tulare Basin 6-Station Index", "region": PRECIP_REGION_TULARE},
}

# DWR's official statewide snowpack summary (cdec.water.ca.gov/snowapp/
# sweq.action) averages a FIXED list of electronic snow sensors per region
# and reports each as a percent of average. This map is that list verbatim
# — every station CDEC names under "Stations included" — so our regional
# and statewide percents reconcile with DWR's headline figures. (The earlier
# hand-picked 15-station sample skewed high-elevation and read 26.5% of the
# April-1 average in 2026 when DWR published 18%.)
#
# Verified live 2026-09-12: NORTH 32, CENTRAL 54, SOUTH 25 as listed on
# sweq.action. LVT (Leavitt Lake) appears under both CENTRAL and SOUTH
# there; it is kept once, in CENTRAL, so the map holds 110 stations. LLP
# (Lower Lassen Peak) has dropped off CDEC's list ("Not Selected", no
# data) and is deliberately absent. Names and elevations are CDEC's own,
# from the PAGE6 snow-sensor report (reportapp/javareports?name=PAGE6).
# All carry sensor 3 (daily SWE). Sorted by region, then station id.
SNOW_REGION_NORTH = "Northern Sierra / Trinity"
SNOW_REGION_CENTRAL = "Central Sierra"
SNOW_REGION_SOUTH = "Southern Sierra"

MAJOR_SNOW_STATIONS = {
    "ADM": {"name": "Adin Mountain", "elevation_ft": 6200, "region": SNOW_REGION_NORTH},
    "BFL": {"name": "Big Flat", "elevation_ft": 5100, "region": SNOW_REGION_NORTH},
    "BKL": {"name": "Bucks Lake", "elevation_ft": 5873, "region": SNOW_REGION_NORTH},
    "BLA": {"name": "Blacks Mountain", "elevation_ft": 7050, "region": SNOW_REGION_NORTH},
    "BMW": {"name": "Big Meadows", "elevation_ft": 8700, "region": SNOW_REGION_NORTH},
    "BNK": {"name": "Bonanza King", "elevation_ft": 6450, "region": SNOW_REGION_NORTH},
    "CDP": {"name": "Cedar Pass", "elevation_ft": 7100, "region": SNOW_REGION_NORTH},
    "DSS": {"name": "Dismal Swamp", "elevation_ft": 7050, "region": SNOW_REGION_NORTH},
    "FOR": {"name": "Four Trees", "elevation_ft": 5202, "region": SNOW_REGION_NORTH},
    "GOL": {"name": "Gold Lake", "elevation_ft": 6750, "region": SNOW_REGION_NORTH},
    "GRZ": {"name": "Grizzly Ridge", "elevation_ft": 6760, "region": SNOW_REGION_NORTH},
    "HIG": {"name": "Highland Lakes", "elevation_ft": 5830, "region": SNOW_REGION_NORTH},
    "HMB": {"name": "Humbug", "elevation_ft": 6500, "region": SNOW_REGION_NORTH},
    "IDC": {"name": "Independence Camp", "elevation_ft": 7000, "region": SNOW_REGION_NORTH},
    "IDP": {"name": "Independence Lake", "elevation_ft": 8450, "region": SNOW_REGION_NORTH},
    "INN": {"name": "Independence Creek", "elevation_ft": 6500, "region": SNOW_REGION_NORTH},
    "KTL": {"name": "Kettle Rock", "elevation_ft": 7300, "region": SNOW_REGION_NORTH},
    "MB3": {"name": "Middle Boulder 3", "elevation_ft": 6200, "region": SNOW_REGION_NORTH},
    "MED": {"name": "Medicine Lake", "elevation_ft": 6700, "region": SNOW_REGION_NORTH},
    "MUM": {"name": "Mumbo Basin", "elevation_ft": 5590, "region": SNOW_REGION_NORTH},
    "NLS": {"name": "Noel Spring", "elevation_ft": 5100, "region": SNOW_REGION_NORTH},
    "PET": {"name": "Peterson Flat", "elevation_ft": 7150, "region": SNOW_REGION_NORTH},
    "PLP": {"name": "Pilot Peak", "elevation_ft": 6800, "region": SNOW_REGION_NORTH},
    "RRM": {"name": "Red Rock Mountain", "elevation_ft": 6700, "region": SNOW_REGION_NORTH},
    "SCT": {"name": "Scott Mountain", "elevation_ft": 5900, "region": SNOW_REGION_NORTH},
    "SDF": {"name": "Sand Flat", "elevation_ft": 6750, "region": SNOW_REGION_NORTH},
    "SHM": {"name": "Shimmy Lake", "elevation_ft": 6400, "region": SNOW_REGION_NORTH},
    "SLT": {"name": "Slate Creek", "elevation_ft": 5560, "region": SNOW_REGION_NORTH},
    "SNM": {"name": "Snow Mountain", "elevation_ft": 5950, "region": SNOW_REGION_NORTH},
    "SQV": {"name": "Squaw Valley", "elevation_ft": 8200, "region": SNOW_REGION_NORTH},
    "STM": {"name": "Stouts Meadow", "elevation_ft": 5200, "region": SNOW_REGION_NORTH},
    "TK2": {"name": "Truckee 2", "elevation_ft": 6400, "region": SNOW_REGION_NORTH},
    "ALP": {"name": "Alpha", "elevation_ft": 7600, "region": SNOW_REGION_CENTRAL},
    "BLC": {"name": "Blue Canyon", "elevation_ft": 5280, "region": SNOW_REGION_CENTRAL},
    "BLD": {"name": "Bloods Creek", "elevation_ft": 7200, "region": SNOW_REGION_CENTRAL},
    "BLK": {"name": "Blue Lakes", "elevation_ft": 7990, "region": SNOW_REGION_CENTRAL},
    "BLS": {"name": "Black Springs", "elevation_ft": 6500, "region": SNOW_REGION_CENTRAL},
    "BSK": {"name": "Burnside Lake", "elevation_ft": 8129, "region": SNOW_REGION_CENTRAL},
    "CAP": {"name": "Caples Lake", "elevation_ft": 7920, "region": SNOW_REGION_CENTRAL},
    "CSL": {"name": "Central Sierra Snow Lab", "elevation_ft": 6900, "region": SNOW_REGION_CENTRAL},
    "CXS": {"name": "Carson Pass", "elevation_ft": 8353, "region": SNOW_REGION_CENTRAL},
    "DAN": {"name": "Dana Meadows", "elevation_ft": 9760, "region": SNOW_REGION_CENTRAL},
    "DDM": {"name": "Deadman Creek", "elevation_ft": 9250, "region": SNOW_REGION_CENTRAL},
    "EBB": {"name": "Ebbetts Pass", "elevation_ft": 8700, "region": SNOW_REGION_CENTRAL},
    "EP5": {"name": "Echo Peak 5", "elevation_ft": 7800, "region": SNOW_REGION_CENTRAL},
    "FDC": {"name": "Forestdale Creek", "elevation_ft": 8017, "region": SNOW_REGION_CENTRAL},
    "FLL": {"name": "Fallen Leaf Lake", "elevation_ft": 6250, "region": SNOW_REGION_CENTRAL},
    "FRN": {"name": "Forni Ridge", "elevation_ft": 7600, "region": SNOW_REGION_CENTRAL},
    "GIN": {"name": "Gin Flat", "elevation_ft": 7050, "region": SNOW_REGION_CENTRAL},
    "GKS": {"name": "Greek Store", "elevation_ft": 5600, "region": SNOW_REGION_CENTRAL},
    "GNL": {"name": "Gianelli Meadow", "elevation_ft": 8400, "region": SNOW_REGION_CENTRAL},
    "HGM": {"name": "Hagans Meadow", "elevation_ft": 8000, "region": SNOW_REGION_CENTRAL},
    "HHM": {"name": "Highland Meadow", "elevation_ft": 8700, "region": SNOW_REGION_CENTRAL},
    "HOR": {"name": "Horse Meadow", "elevation_ft": 8557, "region": SNOW_REGION_CENTRAL},
    "HRS": {"name": "Horse Meadow", "elevation_ft": 8400, "region": SNOW_REGION_CENTRAL},
    "HVN": {"name": "Heavenly Valley", "elevation_ft": 8800, "region": SNOW_REGION_CENTRAL},
    "HYS": {"name": "Huysink", "elevation_ft": 6600, "region": SNOW_REGION_CENTRAL},
    "KIB": {"name": "Lower Kibbie Ridge", "elevation_ft": 6700, "region": SNOW_REGION_CENTRAL},
    "LBD": {"name": "Lobdell Lake", "elevation_ft": 9200, "region": SNOW_REGION_CENTRAL},
    "LOS": {"name": "Lake Lois", "elevation_ft": 8600, "region": SNOW_REGION_CENTRAL},
    "LVM": {"name": "Leavitt Meadows", "elevation_ft": 7200, "region": SNOW_REGION_CENTRAL},
    "LVT": {"name": "Leavitt Lake", "elevation_ft": 9600, "region": SNOW_REGION_CENTRAL},
    "MNT": {"name": "Monitor Pass", "elevation_ft": 8350, "region": SNOW_REGION_CENTRAL},
    "MRL": {"name": "Marlette Lake", "elevation_ft": 8000, "region": SNOW_REGION_CENTRAL},
    "MSK": {"name": "Mount Rose Ski Area", "elevation_ft": 8900, "region": SNOW_REGION_CENTRAL},
    "PDS": {"name": "Paradise Meadow", "elevation_ft": 7650, "region": SNOW_REGION_CENTRAL},
    "PSN": {"name": "Poison Flat", "elevation_ft": 7900, "region": SNOW_REGION_CENTRAL},
    "RBB": {"name": "Robbs Saddle", "elevation_ft": 5900, "region": SNOW_REGION_CENTRAL},
    "RBP": {"name": "Robbs Powerhouse", "elevation_ft": 5150, "region": SNOW_REGION_CENTRAL},
    "RCC": {"name": "Robinson Cow Camp", "elevation_ft": 6480, "region": SNOW_REGION_CENTRAL},
    "REL": {"name": "Lower Relief Valley", "elevation_ft": 8100, "region": SNOW_REGION_CENTRAL},
    "RP2": {"name": "Rubicon Peak 2", "elevation_ft": 7500, "region": SNOW_REGION_CENTRAL},
    "SCN": {"name": "Schneiders", "elevation_ft": 8750, "region": SNOW_REGION_CENTRAL},
    "SDW": {"name": "Summit Meadow", "elevation_ft": 9313, "region": SNOW_REGION_CENTRAL},
    "SIL": {"name": "Silver Lake", "elevation_ft": 7100, "region": SNOW_REGION_CENTRAL},
    "SLI": {"name": "Slide Canyon", "elevation_ft": 9200, "region": SNOW_REGION_CENTRAL},
    "SPS": {"name": "Sonora Pass Bridge", "elevation_ft": 8750, "region": SNOW_REGION_CENTRAL},
    "SPT": {"name": "Spratt Creek", "elevation_ft": 6150, "region": SNOW_REGION_CENTRAL},
    "STR": {"name": "Ostrander Lake", "elevation_ft": 8200, "region": SNOW_REGION_CENTRAL},
    "TCC": {"name": "Tahoe City Cross", "elevation_ft": 6750, "region": SNOW_REGION_CENTRAL},
    "TNY": {"name": "Lake Tenaya", "elevation_ft": 8070, "region": SNOW_REGION_CENTRAL},
    "TUM": {"name": "Tuolumne Meadows", "elevation_ft": 8500, "region": SNOW_REGION_CENTRAL},
    "VRG": {"name": "Virginia Lakes", "elevation_ft": 9300, "region": SNOW_REGION_CENTRAL},
    "VVL": {"name": "Van Vleck", "elevation_ft": 6700, "region": SNOW_REGION_CENTRAL},
    "WC3": {"name": "Ward Creek 3", "elevation_ft": 6750, "region": SNOW_REGION_CENTRAL},
    "WHW": {"name": "White Wolf", "elevation_ft": 7900, "region": SNOW_REGION_CENTRAL},
    "BCB": {"name": "Blackcap Basin", "elevation_ft": 10180, "region": SNOW_REGION_SOUTH},
    "BCH": {"name": "Beach Meadows", "elevation_ft": 7650, "region": SNOW_REGION_SOUTH},
    "BIM": {"name": "Big Meadows", "elevation_ft": 7600, "region": SNOW_REGION_SOUTH},
    "CBT": {"name": "Crabtree Meadow", "elevation_ft": 10600, "region": SNOW_REGION_SOUTH},
    "CHM": {"name": "Chilkoot Meadow", "elevation_ft": 7120, "region": SNOW_REGION_SOUTH},
    "CHP": {"name": "Chagoopa Plateau", "elevation_ft": 10300, "region": SNOW_REGION_SOUTH},
    "CWD": {"name": "Cottonwood Lakes", "elevation_ft": 10150, "region": SNOW_REGION_SOUTH},
    "GNF": {"name": "Giant Forest", "elevation_ft": 6400, "region": SNOW_REGION_SOUTH},
    "GRM": {"name": "Green Mountain", "elevation_ft": 7900, "region": SNOW_REGION_SOUTH},
    "GRV": {"name": "Graveyard Meadow", "elevation_ft": 6900, "region": SNOW_REGION_SOUTH},
    "HNT": {"name": "Huntington Lake", "elevation_ft": 7000, "region": SNOW_REGION_SOUTH},
    "KSP": {"name": "Kaiser Point", "elevation_ft": 9200, "region": SNOW_REGION_SOUTH},
    "MHP": {"name": "Mammoth Pass", "elevation_ft": 9300, "region": SNOW_REGION_SOUTH},
    "MTM": {"name": "Mitchell Meadow", "elevation_ft": 10026, "region": SNOW_REGION_SOUTH},
    "PSC": {"name": "Pascoes", "elevation_ft": 9120, "region": SNOW_REGION_SOUTH},
    "PSR": {"name": "Poison Ridge", "elevation_ft": 6900, "region": SNOW_REGION_SOUTH},
    "QUA": {"name": "Quaking Aspen", "elevation_ft": 7200, "region": SNOW_REGION_SOUTH},
    "RCK": {"name": "Rock Creek Lakes", "elevation_ft": 9575, "region": SNOW_REGION_SOUTH},
    "SLK": {"name": "South Lake", "elevation_ft": 9600, "region": SNOW_REGION_SOUTH},
    "STL": {"name": "State Lakes", "elevation_ft": 10400, "region": SNOW_REGION_SOUTH},
    "SWM": {"name": "Sawmill", "elevation_ft": 10200, "region": SNOW_REGION_SOUTH},
    "TMR": {"name": "Tamarack Summit", "elevation_ft": 7550, "region": SNOW_REGION_SOUTH},
    "UBC": {"name": "Upper Burnt Corral", "elevation_ft": 9700, "region": SNOW_REGION_SOUTH},
    "UTY": {"name": "Upper Tyndall Creek", "elevation_ft": 11500, "region": SNOW_REGION_SOUTH},
}

# Major reservoirs tracked in v1, keyed by CDEC station id. Static map by
# design — CDEC has no clean metadata API — mirroring the RESOURCE_IDS
# pattern in ckan_api.py. Capacities (gross pool, acre-feet) verified
# 2026-07-15 against CDEC's Daily Reservoir Storage Summary
# (reportapp/javareports?name=RES) so our percent-of-capacity matches
# CDEC's published percents; counties verified against each station's
# CDEC staMeta page.
#
# County notes: for reservoirs whose water body spans a county line we use
# the county on the station's CDEC staMeta page (NML says Calaveras; MIL —
# Friant Dam, on the Fresno/Madera line — says Fresno). ISB reflects full
# gross pool — the pre-2023 storage restriction was lifted after the USACE
# Isabella Dam Safety Modification Project completed. ORO is the post-2017
# spillway-rebuild figure CDEC uses, not the 3,537,577 nameplate.
#
# lat/lon are the station coordinates from each station's CDEC staMeta page
# (https://cdec.water.ca.gov/dynamicapp/staMeta?station_id=<id>), fetched
# live and verified 2026-07-15. They are the dam/gauge location, which is
# what the map-marker feature wants — a stable point, not the lake centroid.
MAJOR_RESERVOIRS = {
    "SHA": {"name": "Shasta Lake", "capacity_af": 4_552_000, "county": "Shasta", "lat": 40.718, "lon": -122.420},
    "ORO": {"name": "Lake Oroville", "capacity_af": 3_424_753, "county": "Butte", "lat": 39.540, "lon": -121.493},
    "CLE": {"name": "Trinity Lake", "capacity_af": 2_447_650, "county": "Trinity", "lat": 40.801, "lon": -122.762},
    "NML": {"name": "New Melones Lake", "capacity_af": 2_400_000, "county": "Calaveras", "lat": 37.9481, "lon": -120.525},
    "SNL": {"name": "San Luis Reservoir", "capacity_af": 2_041_000, "county": "Merced", "lat": 37.033, "lon": -121.133},
    "DNP": {"name": "Don Pedro Reservoir", "capacity_af": 2_030_000, "county": "Tuolumne", "lat": 37.702, "lon": -120.421},
    "BER": {"name": "Lake Berryessa", "capacity_af": 1_602_000, "county": "Napa", "lat": 38.513, "lon": -122.104},
    "EXC": {"name": "Lake McClure", "capacity_af": 1_024_600, "county": "Mariposa", "lat": 37.585, "lon": -120.270},
    "PNF": {"name": "Pine Flat Reservoir", "capacity_af": 1_000_000, "county": "Fresno", "lat": 36.833, "lon": -119.325},
    "FOL": {"name": "Folsom Lake", "capacity_af": 977_000, "county": "Sacramento", "lat": 38.683, "lon": -121.183},
    "BUL": {"name": "New Bullards Bar", "capacity_af": 966_000, "county": "Yuba", "lat": 39.393, "lon": -121.140},
    "ISB": {"name": "Lake Isabella", "capacity_af": 568_000, "county": "Kern", "lat": 35.646, "lon": -118.473},
    "MIL": {"name": "Millerton Lake", "capacity_af": 520_500, "county": "Fresno", "lat": 37.001, "lon": -119.705},
    "CAS": {"name": "Castaic Lake", "capacity_af": 325_000, "county": "Los Angeles", "lat": 34.5152, "lon": -118.6101},
    "PYM": {"name": "Pyramid Lake", "capacity_af": 180_000, "county": "Los Angeles", "lat": 34.644153, "lon": -118.764528},
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


def _parse_with_zero_row_guard(
    raw: list[dict], source: str, window_start: date, window_end: date
) -> list[Observation]:
    """Shared empty/quiet-day handling for the three whole-batch CDEC pulls.

    Each of these fetches every station/index in ONE request, so an empty
    *raw* body means the servlet returned nothing at all for the window —
    never legitimate. Zero *parsed* observations from a non-empty raw body
    (e.g. every reading is the day's -9999 sentinel) can be a genuinely
    quiet day, so that case is only logged, not raised.
    """
    require_rows(raw, source, "raw CDEC rows")
    observations = parse_observations(raw)
    if not observations:
        logger.warning(
            "%s: parsed 0 observations from %d raw CDEC rows for %s–%s "
            "(quiet window, not treated as a failure)",
            source, len(raw), window_start, window_end,
        )
    return observations


def fetch_reservoir_storage(start: date, end: date) -> list[Observation]:
    """Fetch daily storage for every reservoir in MAJOR_RESERVOIRS."""
    raw = fetch_sensor_data(
        stations=sorted(MAJOR_RESERVOIRS),
        sensor=SENSOR_STORAGE,
        start=start,
        end=end,
    )
    return _parse_with_zero_row_guard(raw, "reservoirs", start, end)


def fetch_snow_water_content(start: date, end: date) -> list[Observation]:
    """Fetch daily snow water content (SWE) for every MAJOR_SNOW_STATIONS
    station. Sensor 3 is the raw daily SWE, present at all snow pillows.

    Stations are requested in chunks of SNOW_STATIONS_PER_REQUEST with the
    courtesy delay between chunks; the rows are concatenated before parsing."""
    stations = sorted(MAJOR_SNOW_STATIONS)
    raw: list[dict] = []
    for i in range(0, len(stations), SNOW_STATIONS_PER_REQUEST):
        if i:
            time.sleep(REQUEST_DELAY)
        raw.extend(
            fetch_sensor_data(
                stations=stations[i : i + SNOW_STATIONS_PER_REQUEST],
                sensor=SENSOR_SNOW_WATER_CONTENT,
                start=start,
                end=end,
            )
        )
    return _parse_with_zero_row_guard(raw, "snowpack", start, end)


def fetch_precip_indices(start: date, end: date) -> list[Observation]:
    """Fetch daily accumulated water-year precipitation for the three DWR
    regional indices (8SI/5SI/6SI). Sensor 2 is the cumulative total."""
    raw = fetch_sensor_data(
        stations=sorted(PRECIP_INDEX_STATIONS),
        sensor=SENSOR_PRECIP_ACCUM,
        start=start,
        end=end,
    )
    return _parse_with_zero_row_guard(raw, "precip_indices", start, end)


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
