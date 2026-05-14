"""Seed the cities table from the Census place-by-county listing.

The source JSON (`app/data/ca_cities.json`) was generated from
https://www2.census.gov/geo/docs/reference/codes2020/place_by_cou/st06_ca_place_by_county2020.txt
and ships ~482 incorporated places + ~1133 Census Designated Places.

Run after `seed_counties` since cities.county_code is an FK to counties.code.
Idempotent — uses session.merge() keyed on (county_code, name).
"""

import json
from pathlib import Path

from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.cities_match import normalize_name
from app.database import EtlSessionLocal as SessionLocal  # write/DDL role
from app.models import City, County

_DATA_FILE = Path(__file__).parent / "data" / "ca_cities.json"


def seed() -> None:
    rows = json.loads(_DATA_FILE.read_text())

    db = SessionLocal()
    try:
        existing = db.query(City).count()
        # The source file has ~1615 places. Re-seeding to fix data is cheap,
        # so we only short-circuit when the table is already fully populated.
        if existing >= len(rows):
            print(f"Cities already seeded ({existing} rows). Skipping.")
            return

        # FIPS ("06001") → counties.code
        fips_to_code = {c.fips: c.code for c in db.query(County).all()}

        values = []
        skipped_unknown_county = 0
        for r in rows:
            county_code = fips_to_code.get(r["county_fips"])
            if county_code is None:
                skipped_unknown_county += 1
                continue
            values.append({
                "county_code": county_code,
                "name": r["name"],
                "name_normalized": normalize_name(r["name"]),
                "place_type": r["place_type"],
                "place_fips": r["place_fips"],
            })

        # ON CONFLICT DO NOTHING makes the seed re-runnable: existing rows
        # are kept (their auto-incremented id won't change, so any
        # crashes.city_id references stay valid).
        stmt = pg_insert(City).values(values).on_conflict_do_nothing(
            constraint="uq_cities_county_name",
        )
        result = db.execute(stmt)
        db.commit()
        print(
            f"Seeded {result.rowcount} new CA cities (skipped {skipped_unknown_county} "
            f"with no matching county; {len(values) - result.rowcount} already present)."
        )
    finally:
        db.close()


if __name__ == "__main__":
    seed()
