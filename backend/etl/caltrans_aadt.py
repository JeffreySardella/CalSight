"""Caltrans AADT (Annual Average Daily Traffic) ETL.

Fetches traffic volume data from the Caltrans ArcGIS FeatureServer,
aggregates per-segment AADT counts to the county level, and upserts
into the traffic_volumes table.

Source: Caltrans Traffic Census Program
API: https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/Traffic_AADT/FeatureServer/0

The raw data has one row per road segment (~14K segments), each with:
  - CNTY: 2-3 letter county abbreviation (e.g. "LA", "ALA", "SBD")
  - AHEAD_AADT: traffic volume in the "ahead" direction
  - BACK_AADT: traffic volume in the "back" direction

We aggregate to county level by summing AHEAD_AADT across all segments
per county (AHEAD_AADT is the standard reported direction).

Usage:
    python -m etl.caltrans_aadt
"""

import logging

from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.database import SessionLocal
from app.models import County, TrafficVolume
from etl._utils import get_with_retry, track_etl_run

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

FEATURE_SERVICE_URL = (
    "https://caltrans-gis.dot.ca.gov/arcgis/rest/services"
    "/CHhighway/Traffic_AADT/FeatureServer/0/query"
)

PAGE_SIZE = 2000

# Caltrans uses 2-3 letter county abbreviations. Map to county names
# so we can join against our counties table.
CALTRANS_ABBREV_TO_NAME = {
    "ALA": "Alameda", "ALP": "Alpine", "AMA": "Amador", "BUT": "Butte",
    "CAL": "Calaveras", "CC": "Contra Costa", "COL": "Colusa",
    "DN": "Del Norte", "ED": "El Dorado", "FRE": "Fresno",
    "GLE": "Glenn", "HUM": "Humboldt", "IMP": "Imperial",
    "INY": "Inyo", "KER": "Kern", "KIN": "Kings", "LA": "Los Angeles",
    "LAK": "Lake", "LAS": "Lassen", "MAD": "Madera",
    "MEN": "Mendocino", "MER": "Merced", "MNO": "Mono", "MOD": "Modoc",
    "MON": "Monterey", "MPA": "Mariposa", "MRN": "Marin", "NAP": "Napa",
    "NEV": "Nevada", "ORA": "Orange", "PLA": "Placer", "PLU": "Plumas",
    "RIV": "Riverside", "SAC": "Sacramento", "SB": "Santa Barbara",
    "SBD": "San Bernardino", "SBT": "San Benito", "SCL": "Santa Clara",
    "SCR": "Santa Cruz", "SD": "San Diego", "SF": "San Francisco",
    "SHA": "Shasta", "SIE": "Sierra", "SIS": "Siskiyou",
    "SJ": "San Joaquin", "SLO": "San Luis Obispo", "SM": "San Mateo",
    "SOL": "Solano", "SON": "Sonoma", "STA": "Stanislaus",
    "SUT": "Sutter", "TEH": "Tehama", "TRI": "Trinity",
    "TUL": "Tulare", "TUO": "Tuolumne", "VEN": "Ventura",
    "YOL": "Yolo", "YUB": "Yuba",
}


def fetch_all_segments() -> list[dict]:
    """Fetch all AADT road segments from the Caltrans FeatureServer.

    The ArcGIS API limits results per request, so we paginate using
    resultOffset until all records are fetched.

    Returns list of dicts with keys: CNTY, AHEAD_AADT, BACK_AADT, etc.
    """
    all_records = []
    offset = 0

    while True:
        params = {
            "where": "1=1",
            "outFields": "CNTY,AHEAD_AADT,BACK_AADT,AHEAD_PEAK_MADT,RTE,DESCRIPTION",
            "resultRecordCount": PAGE_SIZE,
            "resultOffset": offset,
            "f": "json",
        }
        resp = get_with_retry(FEATURE_SERVICE_URL, params=params, timeout=60)
        data = resp.json()

        features = data.get("features", [])
        if not features:
            break

        for f in features:
            all_records.append(f["attributes"])

        offset += len(features)
        logger.info("Fetched %d segments so far...", offset)

        # ArcGIS signals no more data when exceededTransferLimit is False
        if not data.get("exceededTransferLimit", False):
            break

    logger.info("Total segments fetched: %d", len(all_records))
    return all_records


def aggregate_by_county(
    segments: list[dict], name_to_code: dict[str, int]
) -> list[dict]:
    """Aggregate per-segment AADT to county-level totals.

    Args:
        segments: Raw segment records from the FeatureServer.
        name_to_code: Mapping of county name -> county_code from our DB.

    Returns:
        List of dicts ready for upserting into traffic_volumes.
    """
    county_data: dict[int, dict] = {}

    for seg in segments:
        abbrev = seg.get("CNTY")
        county_name = CALTRANS_ABBREV_TO_NAME.get(abbrev)
        if county_name is None:
            logger.debug("Unknown county abbreviation: %s", abbrev)
            continue

        county_code = name_to_code.get(county_name)
        if county_code is None:
            logger.debug("County not in DB: %s", county_name)
            continue

        raw_aadt = seg.get("AHEAD_AADT")
        try:
            aadt = int(raw_aadt) if raw_aadt is not None else 0
        except (ValueError, TypeError):
            aadt = 0

        if county_code not in county_data:
            county_data[county_code] = {"total_aadt": 0, "segment_count": 0}

        county_data[county_code]["total_aadt"] += aadt
        county_data[county_code]["segment_count"] += 1

    results = []
    for code, data in county_data.items():
        seg_count = data["segment_count"]
        results.append({
            "county_code": code,
            "total_aadt": data["total_aadt"],
            "segment_count": seg_count,
            "avg_aadt_per_segment": data["total_aadt"] // seg_count if seg_count else 0,
        })

    return results


@track_etl_run("traffic_volumes")
def run():
    """Main entry point: fetch, aggregate, upsert."""
    db = SessionLocal()

    try:
        # Build county name -> code lookup
        counties = db.query(County.name, County.code).all()
        name_to_code = {name: code for name, code in counties}
        logger.info("Loaded %d counties from DB", len(name_to_code))

        # Fetch raw segments
        segments = fetch_all_segments()

        # Aggregate to county level
        county_rows = aggregate_by_county(segments, name_to_code)
        logger.info("Aggregated to %d counties", len(county_rows))

        # Bulk upsert
        if county_rows:
            stmt = pg_insert(TrafficVolume).values(county_rows)
            stmt = stmt.on_conflict_do_update(
                constraint="traffic_volumes_county_code_key",
                set_={
                    "total_aadt": stmt.excluded.total_aadt,
                    "segment_count": stmt.excluded.segment_count,
                    "avg_aadt_per_segment": stmt.excluded.avg_aadt_per_segment,
                },
            )
            db.execute(stmt)
            db.commit()
            logger.info("Upserted %d county traffic volume records", len(county_rows))
        else:
            logger.warning("No data to upsert")

    finally:
        db.close()


if __name__ == "__main__":
    run()
