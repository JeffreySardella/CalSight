"""ETL: load CCRS Parties and InjuredWitnessPassengers into Postgres.

Fetches party (driver/pedestrian) and victim data from the CCRS dataset
on data.ca.gov. These tables link to crashes via collision_id and contain
demographics (age, gender), sobriety, vehicle info, and injury severity.

This is the data that powers insights like:
- "Males 18-25 are 3x more likely to be at-fault"
- "Unbelted drivers have 4x the fatality rate"
- "DUI crashes peak between 1-3 AM on weekends"

Source: CCRS on data.ca.gov (Parties_YYYY and InjuredWitnessPassengers_YYYY)

Usage:
    python -m etl.load_parties_victims
    python -m etl.load_parties_victims --start 2020 --end 2024
    python -m etl.load_parties_victims --table parties
    python -m etl.load_parties_victims --table victims
"""

import argparse
import logging
import time

import httpx
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.database import SessionLocal
from app.models import CrashParty, CrashVictim
from etl._utils import track_etl_run

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

CKAN_BASE_URL = "https://data.ca.gov/api/3/action/datastore_search"
PAGE_SIZE = 32000
MAX_RETRIES = 3
BACKOFF_BASE = 2

DEFAULT_START_YEAR = 2016
DEFAULT_END_YEAR = 2026

# Resource IDs for Parties data per year
PARTIES_RESOURCE_IDS = {
    2016: "2e8e3d81-4615-4b8e-ab7f-408f10f64bba",
    2017: "e8c625e8-674a-49f2-abe9-405267613045",
    2018: "42f3f3d1-c130-4ebc-9536-98bf7880b0b9",
    2019: "1a06775e-7d4a-4574-b3d4-f815d02d236a",
    2020: "ebfed5da-82d6-4af2-bf40-b9516d7935a9",
    2021: "754fe00c-f3bf-4f2f-80d0-ed4aa7b89b77",
    2022: "9ef51178-51cb-4939-9344-2d0907740580",
    2023: "84376be5-548b-44e3-8ebc-73e8a2ca9945",
    2024: "93892d36-017b-4a2a-bc0b-f1f385060b96",
    2025: "a2676918-a825-4b77-8e5c-6eadb38d6b1a",
    2026: "348a4266-bbb6-439f-b6c7-0018cc79f0fe",
}

# Resource IDs for InjuredWitnessPassengers data per year
VICTIMS_RESOURCE_IDS = {
    2016: "ea0bb73d-c41c-4d15-8a88-0c2a51fcd33a",
    2017: "fcb4f72e-db37-4379-8b78-25aad557d6cb",
    2018: "ca547c12-f64d-4b6a-8f25-7075f6d6ec0b",
    2019: "8ad780b4-0a05-4258-a461-57254888eb1a",
    2020: "459a4ce9-2a2a-4c50-a3fc-cfd6d4cbfa6e",
    2021: "616a9850-27cb-4012-b6e7-90a2e495900a",
    2022: "2d9e8bef-d5a2-402e-82eb-6386ad4d09f7",
    2023: "1dfc36fa-a5dd-4616-b9b0-ff55699e299a",
    2024: "a36a0078-d7e1-4244-8337-0a59433c9b84",
    2025: "10184ea3-7411-42d8-87a6-17039b58f04b",
    2026: "bbe0c38e-d0eb-4152-86e2-0b0895e66ba9",
}


def _safe_int(value):
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def _safe_bool(value):
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return value
    return str(value).strip().upper() in ("TRUE", "Y")


def _fetch_page(resource_id, offset):
    """Fetch one page from CKAN with retry."""
    params = {
        "resource_id": resource_id,
        "limit": PAGE_SIZE,
        "offset": offset,
    }
    last_error = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = httpx.get(CKAN_BASE_URL, params=params, timeout=60)
            resp.raise_for_status()
            return resp.json()["result"]
        except (httpx.HTTPStatusError, httpx.RequestError) as exc:
            last_error = exc
            if attempt < MAX_RETRIES - 1:
                wait = BACKOFF_BASE ** (attempt + 1)
                logger.warning("Attempt %d failed: %s. Retrying in %ds...", attempt + 1, exc, wait)
                time.sleep(wait)
    raise last_error


def transform_party(rec: dict) -> dict:
    """Transform a raw CCRS party record to CrashParty model columns."""
    gender_code = str(rec.get("GenderCode", "") or "").strip().upper()[:1]

    # Extract cell phone info from Special Information field
    special_info = str(rec.get("Special Information", "") or "").strip()
    cell_phone = special_info if "CELL" in special_info.upper() else None

    return {
        "party_id": _safe_int(rec.get("PartyId")),
        "collision_id": _safe_int(rec.get("CollisionId")),
        "party_number": _safe_int(rec.get("PartyNumber")),
        "party_type": str(rec.get("PartyType", "") or "").strip()[:30] or None,
        "at_fault": _safe_bool(rec.get("IsAtFault")),
        "gender": gender_code if gender_code in ("M", "F", "U") else None,
        "age": _safe_int(rec.get("StatedAge")),
        "sobriety": str(rec.get("SobrietyDrugPhysicalDescription1", "") or "").strip()[:100] or None,
        "vehicle_type": str(rec.get("Vehicle1TypeDesc", "") or "").strip()[:100] or None,
        "vehicle_year": _safe_int(rec.get("Vehicle1Year")),
        "vehicle_make": str(rec.get("Vehicle1Make", "") or "").strip()[:50] or None,
        "speed_limit": _safe_int(rec.get("SpeedLimit")),
        "movement": str(rec.get("MovementPrecCollDescription", "") or "").strip()[:100] or None,
        "safety_equipment": str(rec.get("SafetyEquipmentDescription", "") or "").strip()[:100] or None,
        "cell_phone_use": cell_phone[:50] if cell_phone else None,
        "data_source": "ccrs",
    }


def transform_victim(rec: dict) -> dict:
    """Transform a raw CCRS victim record to CrashVictim model columns."""
    gender = str(rec.get("Gender", "") or "").strip().upper()[:1]

    return {
        "victim_id": _safe_int(rec.get("InjuredWitPassId") or rec.get("InjWitPassId")),
        "collision_id": _safe_int(rec.get("CollisionId")),
        "party_number": _safe_int(rec.get("PartyNumber")),
        "age": _safe_int(rec.get("StatedAge")),
        "gender": gender if gender in ("M", "F", "U") else None,
        "injury_severity": str(rec.get("ExtentOfInjuryCode", "") or "").strip()[:50] or None,
        "person_type": str(rec.get("InjuredPersonType", "") or "").strip()[:30] or None,
        "seat_position": str(rec.get("SeatPosition", "") or "").strip()[:50] or None,
        "safety_equipment": str(rec.get("SafetyEquipmentDescription", "") or "").strip()[:100] or None,
        "ejected": str(rec.get("Ejected", "") or "").strip()[:30] or None,
        "data_source": "ccrs",
    }


# Columns to update on conflict for parties
_PARTY_UPSERT_COLS = [
    "collision_id", "party_number", "party_type", "at_fault", "gender",
    "age", "sobriety", "vehicle_type", "vehicle_year", "vehicle_make",
    "speed_limit", "movement", "safety_equipment", "cell_phone_use",
]

# Columns to update on conflict for victims
_VICTIM_UPSERT_COLS = [
    "collision_id", "party_number", "age", "gender", "injury_severity",
    "person_type", "seat_position", "safety_equipment", "ejected",
]


def load_table(
    table_type: str,
    resource_ids: dict,
    model_class,
    transform_fn,
    upsert_cols: list,
    constraint_name: str,
    id_field: str,
    start_year: int,
    end_year: int,
    force: bool,
):
    """Generic loader for parties or victims."""
    db = SessionLocal()

    try:
        total_rows = 0

        for year in range(start_year, end_year + 1):
            if year not in resource_ids:
                continue

            resource_id = resource_ids[year]
            year_rows = 0
            offset = 0

            logger.info("Starting %s year %d...", table_type, year)

            while True:
                try:
                    result = _fetch_page(resource_id, offset)
                except Exception as exc:
                    logger.error("%s year %d failed at offset %d: %s", table_type, year, offset, exc)
                    break

                total = result["total"]
                records = result["records"]
                if not records:
                    break

                # Transform
                batch = []
                for rec in records:
                    row = transform_fn(rec)
                    # Filter nulls on required fields
                    if row.get(id_field) is None or row.get("collision_id") is None:
                        continue
                    batch.append(row)

                # Bulk upsert
                if batch:
                    try:
                        stmt = pg_insert(model_class).values(batch)
                        stmt = stmt.on_conflict_do_update(
                            constraint=constraint_name,
                            set_={col: stmt.excluded[col] for col in upsert_cols},
                        )
                        db.execute(stmt)
                        db.commit()
                        year_rows += len(batch)
                    except Exception as exc:
                        logger.error(
                            "%s year %d batch at offset %d failed: %s",
                            table_type, year, offset, exc,
                        )
                        db.rollback()

                offset += len(records)
                logger.info(
                    "%s year %d: %d/%d fetched, %d upserted",
                    table_type, year, offset, total, year_rows,
                )

                if offset >= total:
                    break

            total_rows += year_rows
            logger.info("%s year %d complete: %d rows", table_type, year, year_rows)

        logger.info("Done. %d total %s records upserted.", total_rows, table_type)

    finally:
        db.close()


@track_etl_run("parties_victims")
def run(
    start_year: int = DEFAULT_START_YEAR,
    end_year: int = DEFAULT_END_YEAR,
    table: str | None = None,
    force: bool = False,
):
    """Main entry point."""
    if table is None or table == "parties":
        load_table(
            table_type="parties",
            resource_ids=PARTIES_RESOURCE_IDS,
            model_class=CrashParty,
            transform_fn=transform_party,
            upsert_cols=_PARTY_UPSERT_COLS,
            constraint_name="uq_parties_party_source",
            id_field="party_id",
            start_year=start_year,
            end_year=end_year,
            force=force,
        )

    if table is None or table == "victims":
        load_table(
            table_type="victims",
            resource_ids=VICTIMS_RESOURCE_IDS,
            model_class=CrashVictim,
            transform_fn=transform_victim,
            upsert_cols=_VICTIM_UPSERT_COLS,
            constraint_name="uq_victims_victim_source",
            id_field="victim_id",
            start_year=start_year,
            end_year=end_year,
            force=force,
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Load CCRS parties and victims into Postgres"
    )
    parser.add_argument("--start", type=int, default=DEFAULT_START_YEAR)
    parser.add_argument("--end", type=int, default=DEFAULT_END_YEAR)
    parser.add_argument("--table", choices=["parties", "victims"], default=None,
                        help="Load only parties or victims (default: both)")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    run(start_year=args.start, end_year=args.end, table=args.table, force=args.force)
