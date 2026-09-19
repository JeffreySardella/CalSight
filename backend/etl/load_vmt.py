"""Pull annual vehicle miles traveled (VMT) per county from CARB EMFAC.

This is the exposure denominator behind "crashes per 100M vehicle miles" —
the standard road-safety rate, because it counts how much driving actually
happened rather than how many people live there (per-100k) or how much
pavement exists (per-100-road-miles).

Source: CARB EMFAC2025 v2.1.1 Web Platform, Emissions Inventory tool
(https://emfac.arb.ca.gov/emissions-inventory/). There is no documented REST
API. The tool's Vue front end POSTs a JSON form to
https://emfac.arb.ca.gov/handler/request_emfac.php and gets JSON back; that
is what we call here. Treat it like a pinned scraper, not an API contract:
CARB ships a new EMFAC major version every 1-4 years and the version strings
below (and possibly a form field or two) need a manual bump when they do.

IMPORTANT GOTCHA: a *minimal* payload carrying only the semantically relevant
fields (region / year / unit) comes back 200 OK with an F5-WAF "Request
Rejected" HTML body instead of JSON. That looks exactly like bot defense, but
it is not — it is strict schema validation on the `form` object, which must
carry every field the Vue form model does, including UI-only ones like
`pivotConfig` and `outputCols`. Do not "tidy up" PAYLOAD_TEMPLATE by dropping
fields that don't affect the numbers; they are load-bearing for the request.
`hash` is SHA1-shaped in real traffic but its value is never checked.

Two other things that matter for the numbers:
  * `unit: "year"` — the default is "day" (a representative operation-day
    rate). Only "year" gives true annualized VMT in the `Total VMT` column.
  * pass the full vehicle-category / model-year / speed / fuel lists, so the
    response covers the whole fleet rather than one slice of it.

EMFAC's VMT is a model output calibrated against DMV vehicle population and
Caltrans travel-demand control totals, not a raw traffic count. Statewide it
lands within ~6% of Caltrans' published Public Road Data figure, which is
fine for a rate denominator.

Usage:
    python -m etl.load_vmt
"""

import logging
from datetime import date

from sqlalchemy import select

from app.database import EtlSessionLocal as SessionLocal  # write/DDL role
from app.models import County, Vmt
from etl._utils import post_with_retry, track_etl_run

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

URL = "https://emfac.arb.ca.gov/handler/request_emfac.php"

# Recorded in the `source` column so a row always says which model produced
# it, and so CARB's attribution ask is satisfied.
SOURCE = "EMFAC2025 v2.1.1"

# Shape-only; the value is never validated server-side.
DUMMY_HASH = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"

FIRST_YEAR = 2001  # start of the SWITRS crash history the map can select

# Statewide VMT has sat between ~275B and ~340B miles/year across 2001-2025.
# A result outside this band means the response changed meaning under us —
# most likely `unit` silently reverting to "day", which would be ~365x low.
# Fail the run rather than write a denominator that is wrong by two orders
# of magnitude.
STATEWIDE_MIN_MILES = 200e9
STATEWIDE_MAX_MILES = 450e9

# EMFAC's own county ids (from the def_areas_county topojson the app ships)
# are 1-58 in plain alphabetical order, so the FIPS is 06 + (2*id - 1).
COUNTY_NAMES = [
    "Alameda", "Alpine", "Amador", "Butte", "Calaveras", "Colusa", "Contra Costa",
    "Del Norte", "El Dorado", "Fresno", "Glenn", "Humboldt", "Imperial", "Inyo",
    "Kern", "Kings", "Lake", "Lassen", "Los Angeles", "Madera", "Marin",
    "Mariposa", "Mendocino", "Merced", "Modoc", "Mono", "Monterey", "Napa",
    "Nevada", "Orange", "Placer", "Plumas", "Riverside", "Sacramento",
    "San Benito", "San Bernardino", "San Diego", "San Francisco", "San Joaquin",
    "San Luis Obispo", "San Mateo", "Santa Barbara", "Santa Clara", "Santa Cruz",
    "Shasta", "Sierra", "Siskiyou", "Solano", "Sonoma", "Stanislaus", "Sutter",
    "Tehama", "Trinity", "Tulare", "Tuolumne", "Ventura", "Yolo", "Yuba",
]

ALL_VEHICLE_CATEGORIES = [
    "LDA", "LDT1", "LDT2", "MDV", "MCY", "MH", "LHD1 Public", "LHD1 Other",
    "LHD2 Public", "LHD2 Other", "T6 Public Class 4", "T6 Public Class 5",
    "T6 Public Class 6", "T6 Public Class 7", "T6 Utility Class 5",
    "T6 Utility Class 6", "T6 Utility Class 7", "T6 Instate Tractor Class 6",
    "T6 Instate Delivery Class 4", "T6 Instate Delivery Class 5",
    "T6 Instate Delivery Class 6", "T6 Instate Other Class 4",
    "T6 Instate Other Class 5", "T6 Instate Other Class 6",
    "T6 Instate Tractor Class 7", "T6 Instate Delivery Class 7",
    "T6 Instate Other Class 7", "T6 CAIRP Class 4", "T6 CAIRP Class 5",
    "T6 CAIRP Class 6", "T6 CAIRP Class 7", "T6 OOS Class 4", "T6 OOS Class 5",
    "T6 OOS Class 6", "T6 OOS Class 7", "T6TS", "T7 Public Class 8",
    "T7 CAIRP Class 8", "T7 Utility Class 8", "T7 NNOOS Class 8",
    "T7 NOOS Class 8", "T7 Other Port Class 8", "T7 POAK Class 8",
    "T7 POLA Class 8", "T7 Single Concrete/Transit Mix Class 8",
    "T7 Single Dump Class 8", "T7 Single Other Class 8", "T7 Tractor Class 8",
    "T7 SWCV Class 8", "T7IS", "PTO", "UBUS", "SBUS", "Motor Coach", "OBUS",
]
# Inert as far as the numbers go: `modelYearAll: True` below is what actually
# selects the model years, and the 2025 pull came back on the 2023/24 trend
# rather than short of it. The list is sent because the form must arrive whole
# (see the gotcha above), so its 2024 end does not need to advance with the
# calendar and no newer model years are being dropped.
MODEL_YEARS = list(range(1978, 2025))
SPEEDS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90]
ALL_FUELS = [
    {"id": 1, "name": "Gasoline"}, {"id": 2, "name": "Diesel"},
    {"id": 3, "name": "Electricity"}, {"id": 4, "name": "Natural Gas"},
    {"id": 5, "name": "Plug-in Hybrid"}, {"id": 6, "name": "Fuel Cell Electric Vehicle"},
]


def build_payload(year: int) -> dict:
    """The complete form the WAF insists on, for all 58 counties in one POST.

    `calendarYears` is an array and multi-year pulls do work, but each
    county-year is ~85KB of JSON, so a 25-year request would be a ~120MB
    response. One year at a time keeps each response ~5MB and lets the
    statewide sanity check below run per year.
    """
    region = [
        {"fips": f"06{2 * i - 1:03d}", "id": i, "name": name}
        for i, name in enumerate(COUNTY_NAMES, start=1)
    ]
    form = {
        "output": "Emissions",
        "regionType": "County",
        "modelVersion": "emfac2025",
        "modelVersionNumber": {"label": "v2.1.1", "value": "emfac2025_webdb_v2_1_1"},
        "region": region,
        "calendarYears": [year],
        "season": "Annual",
        "vehicleCategoryMode": "emfac202y",
        "vehicleCategory": ALL_VEHICLE_CATEGORIES,
        "modelYearMode": "Aggregate",
        "modelYears": MODEL_YEARS,
        "modelYearStart": MODEL_YEARS[0],
        "modelYearEnd": MODEL_YEARS[-1],
        "modelYearStartSelected": MODEL_YEARS[0],
        "modelYearEndSelected": MODEL_YEARS[-1],
        "speedMode": "Aggregate",
        "speed": SPEEDS,
        "fuel": ALL_FUELS,
        "unit": "year",  # annual VMT, not the default miles/operation-day
        "outputCols": {
            "activities": ["Population", "Total VMT", "CVMT", "EVMT", "Trips",
                           "Energy Consumption", "Hydrogen Consumption", "Fuel Consumption"],
            "pollutants": ["NOx", "PM2.5", "PM10", "CO2", "CH4", "N2O", "ROG",
                           "TOG", "CO", "SOx", "NH3"],
            "processes": ["RUNEX", "IDLEX", "STREX", "TOTEX", "PMTW", "PMBW",
                          "TOTAL", "DIURN", "HOTSOAK", "RUNLOSS"],
            "tableColumns": [],
        },
        "showMap": True,
        "showPivot": False,
        "pivotConfig": {
            "rows": [], "cols": [], "rendererName": "Table", "aggregatorName": "Sum",
            "heatmapMode": "", "rowOrder": "key_a_to_z", "colOrder": "key_a_to_z",
            "vals": ["Population"], "valueFilter": {}, "hiddenAttributes": [],
            "hiddenFromDragDrop": [], "hiddenFromAggregators": [],
        },
        "version": "2026-08-23",  # FORM_VERSION from the app bundle; not checked for freshness
        "calendarYearMode": "Select",
        "calendarYearStartSelected": 2000,
        "calendarYearEndSelected": 2050,
        "modelVersionNumberLabel": "v2.1.1",
        "modelVersionNumberValue": "emfac2025_webdb_v2_1_1",
        "vehicleCategoryAll": True,
        "modelYearAll": True,
        "speedAll": True,
        "fuelAll": True,
        "output_format": "json",
    }
    return {"form": form, "hash": DUMMY_HASH}


def fetch_year(year: int) -> dict:
    """POST one calendar year and return the decoded JSON body.

    An HTML body is a WAF rejection (the payload drifted from the shape the
    server validates) or a CARB-side outage. Either way it means we have no
    data, so raise and let the run fail visibly instead of writing zero rows.
    """
    resp = post_with_retry(
        URL,
        json=build_payload(year),
        timeout=180.0,
        headers={"Content-Type": "application/json;charset=UTF-8"},
    )
    if resp.text.lstrip().startswith("<"):
        raise RuntimeError(
            f"EMFAC returned HTML, not JSON, for {year} — WAF rejection "
            f"(payload shape drifted) or a CARB outage. First 200 chars: "
            f"{resp.text.lstrip()[:200]!r}"
        )
    return resp.json()


def county_vmt_miles(result: dict) -> dict[str, float]:
    """Sum `Total VMT` per county across every vehicle-category/fuel row."""
    header = result["header"]
    region_idx = header.index("Region")
    vmt_idx = header.index("Total VMT")
    totals: dict[str, float] = {}
    for row in result["output"]:
        county = row[region_idx]
        totals[county] = totals.get(county, 0.0) + (row[vmt_idx] or 0.0)
    return totals


def last_complete_year() -> int:
    """The newest year EMFAC reports as history rather than forecast.

    EMFAC will happily hand back 2026-2050, but those years are model
    *projections*: publishing one as the denominator of a real crash rate
    would invent exposure that never happened. So the cap is the last
    complete calendar year — any year >= the current one is never loaded.

    Computed per run rather than at import because the pipeline container is
    long-lived (APScheduler): an import-time constant would still hold last
    year's value every January until the container was recreated.
    """
    return date.today().year - 1


def check_counties(totals: dict[str, float], year: int) -> None:
    """Require exactly the 58 counties we asked for, by name.

    Neither of the other guards can see a short response: Alpine is ~0.02%
    of statewide VMT and the band below is +/-30%, so a dropped county — or
    a dozen small ones — sails through. A renamed county is the same problem
    wearing a different hat. Upserts never delete, so a county missing from
    this pull silently keeps last month's row and the row count still rises,
    which means the orchestrator's drop guard cannot see it either. Fail the
    year instead.
    """
    expected = set(COUNTY_NAMES)
    got = set(totals)
    missing = sorted(expected - got)
    unknown = sorted(got - expected)
    if missing or unknown:
        raise ValueError(
            f"EMFAC returned {len(got)} counties for {year}, expected "
            f"{len(expected)} — missing: {missing or 'none'}; "
            f"unexpected: {unknown or 'none'}"
        )


def check_statewide(totals: dict[str, float], year: int) -> float:
    """Return the statewide total, or raise if it is not physically plausible."""
    statewide = sum(totals.values())
    if not STATEWIDE_MIN_MILES <= statewide <= STATEWIDE_MAX_MILES:
        raise ValueError(
            f"EMFAC statewide VMT for {year} is {statewide:,.0f} miles, "
            f"outside the plausible {STATEWIDE_MIN_MILES:,.0f}-"
            f"{STATEWIDE_MAX_MILES:,.0f} band — the response probably "
            f"changed units (check `unit`: 'year' vs 'day')"
        )
    return statewide


@track_etl_run("vmt")
def run():
    """Main ETL entry point."""
    db = SessionLocal()
    try:
        counties = db.execute(select(County.code, County.name)).all()
        name_to_code = {c.name.upper(): c.code for c in counties}
        logger.info("Loaded %d counties", len(name_to_code))

        inserted = 0
        updated = 0
        for year in range(FIRST_YEAR, last_complete_year() + 1):
            # Both guards run before anything is written, so an incomplete or
            # mis-scaled year leaves the table untouched rather than half-filled.
            totals = county_vmt_miles(fetch_year(year))
            check_counties(totals, year)
            statewide = check_statewide(totals, year)
            logger.info(
                "%d: %d counties, %.1fB miles statewide",
                year, len(totals), statewide / 1e9,
            )

            for county_name, miles in totals.items():
                county_code = name_to_code.get(county_name.upper())
                if county_code is None:
                    # check_counties already matched EMFAC's names against our
                    # own list, so this means the counties table is short.
                    raise ValueError(
                        f"No county row for {county_name!r} — the counties "
                        f"table is incomplete, so {year} cannot be loaded"
                    )

                vmt_millions = round(miles / 1e6, 2)
                existing = db.query(Vmt).filter_by(
                    county_code=county_code,
                    year=year,
                ).first()

                if existing:
                    existing.vmt_millions = vmt_millions
                    existing.source = SOURCE
                    updated += 1
                else:
                    db.add(Vmt(
                        county_code=county_code,
                        year=year,
                        vmt_millions=vmt_millions,
                        source=SOURCE,
                    ))
                    inserted += 1

            # Commit per year so a late failure keeps the years already pulled.
            db.commit()

        logger.info("Done. %d inserted, %d updated", inserted, updated)
    finally:
        db.close()


if __name__ == "__main__":
    run()
