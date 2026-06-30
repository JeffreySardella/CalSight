# Census Lived-Density Correlation Source — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add population-weighted density ("lived density") as a county-level field (`weighted_density`) in the Stats-page correlation matrix, computed from ACS tract populations joined to Census Gazetteer tract land areas.

**Architecture:** New `tract_density_county_year` table + Alembic migration; `etl/census_tract_density.py` (pure metric/aggregation helpers + httpx/zip + ACS I/O + `run()`) registered in `jobs.py`; `/api/tract-density` read endpoint mirroring `fars.py`; correlation wiring in `useCorrelationData.ts`. Full pipeline + tests; no live data load.

**Tech Stack:** Python 3 / FastAPI / SQLAlchemy / Alembic / pytest (backend); React / TypeScript / vitest / TanStack Query (frontend).

## Global Constraints

- CA only: ACS `in=state:06`; Gazetteer rows filtered to GEOID prefix `06`.
- Year range default 2010–2023, CLI-overridable (`--start`/`--end`).
- Metric: `weighted_density = Σ(pop² / area_sqmi) / Σ(pop)` over a county's tracts; exclude tracts with `pop is None`, `pop <= 0`, or `area_sqmi <= 0`; `tract_count` = contributing tracts; `None` if no contributing tracts.
- Tract-vintage pairing: `gazetteer_year_for(acs_year) = 2019 if acs_year <= 2019 else 2023`.
- Reuse `build_county_lookup` from `etl.nhtsa_fars` (3-digit FIPS → county_code). Do not reimplement.
- Census key: `settings.census_api_key` (same as `etl/load_demographics.py`); if unset, `run()` logs and returns.
- Write DB access via `EtlSessionLocal`; read endpoints via `get_db`.
- Backend integration tests are marked `pytest.mark.integration` (need Postgres on localhost:5433, provided in CI); pure-function tests need no DB.
- Spec: `docs/superpowers/specs/2026-06-29-lived-density-design.md`.

---

### Task 1: `TractDensityCountyYear` model + Alembic migration

**Files:**
- Modify: `backend/app/models.py` (add model after the `FarsCountyYear` class)
- Create: `backend/migrations/versions/u9v0w1x2y3z4_add_tract_density.py`

**Interfaces:**
- Produces: `TractDensityCountyYear` ORM model; table `tract_density_county_year`; unique constraint `tract_density_county_year_county_code_year_key` on `(county_code, year)`.

- [ ] **Step 1: Add the model**

In `backend/app/models.py`, immediately after the `FarsCountyYear` class:

```python
class TractDensityCountyYear(Base):
    """Population-weighted ("lived") density per county per year.

    Computed from ACS tract populations joined to Census Gazetteer tract
    land areas: weighted_density = sum(pop^2 / area_sqmi) / sum(pop).
    Distinct from the crude demographics.population_density.

    Source: Census ACS 5-year (tract population) + Census Gazetteer (land area).
    """

    __tablename__ = "tract_density_county_year"

    id = Column(Integer, primary_key=True)
    county_code = Column(
        SmallInteger, ForeignKey("counties.code"), nullable=False
    )
    year = Column(SmallInteger, nullable=False)
    weighted_density = Column(Float)   # persons per square mile (lived density)
    tract_count = Column(Integer)      # tracts contributing to the calc
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("county_code", "year"),
        Index("ix_tract_density_county_year", "county_code", "year"),
    )
```

- [ ] **Step 2: Verify the model imports cleanly**

Run: `cd backend && python -c "from app.models import TractDensityCountyYear; print(TractDensityCountyYear.__tablename__)"`
Expected: prints `tract_density_county_year`

- [ ] **Step 3: Write the migration**

Create `backend/migrations/versions/u9v0w1x2y3z4_add_tract_density.py`:

```python
"""add tract_density_county_year table

Population-weighted density per county/year. New empty table — plain
CREATE TABLE.

Revision ID: u9v0w1x2y3z4
Revises: t8u9v0w1x2y3
Create Date: 2026-06-29 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "u9v0w1x2y3z4"
down_revision: Union[str, None] = "t8u9v0w1x2y3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tract_density_county_year",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("county_code", sa.SmallInteger(), nullable=False),
        sa.Column("year", sa.SmallInteger(), nullable=False),
        sa.Column("weighted_density", sa.Float(), nullable=True),
        sa.Column("tract_count", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(["county_code"], ["counties.code"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("county_code", "year"),
    )
    op.create_index("ix_tract_density_county_year", "tract_density_county_year", ["county_code", "year"])


def downgrade() -> None:
    op.drop_index("ix_tract_density_county_year", table_name="tract_density_county_year")
    op.drop_table("tract_density_county_year")
```

- [ ] **Step 4: Verify single head**

Run: `cd backend && alembic heads`
Expected: one head, `u9v0w1x2y3z4 (head)`. (If `alembic` needs a DB and none is available locally, this is verified in CI; at minimum confirm `down_revision` is `t8u9v0w1x2y3`.)

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/migrations/versions/u9v0w1x2y3z4_add_tract_density.py
git commit -m "feat(density): tract_density_county_year model + migration"
```

---

### Task 2: Lived-density helpers + unit tests (TDD core)

**Files:**
- Create: `backend/etl/census_tract_density.py` (pure helpers only in this task)
- Create: `backend/tests/test_census_tract_density.py`

**Interfaces:**
- Produces:
  - `compute_weighted_density(tracts: list[dict]) -> tuple[float, int] | None` — `tracts` are `{"pop": int|None, "area_sqmi": float|None}`; returns `(weighted_density, tract_count)` or `None`.
  - `gazetteer_year_for(acs_year: int) -> int`.
  - `aggregate_county_density(tract_rows, gaz_land_by_geoid, county_lookup, year) -> list[dict]` — `tract_rows` are `{"geoid": str, "pop": int|None}`; returns per-county `{county_code, year, weighted_density, tract_count}`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_census_tract_density.py`:

```python
"""Unit tests for lived-density helpers (no DB, no network)."""

from etl.census_tract_density import (
    compute_weighted_density,
    gazetteer_year_for,
    aggregate_county_density,
)


def test_weighted_density_two_tracts():
    # tract A: pop 1000, area 1 -> density 1000
    # tract B: pop 3000, area 1 -> density 3000
    # weighted = (1000^2/1 + 3000^2/1) / (1000+3000) = 10_000_000/4000 = 2500
    out = compute_weighted_density([
        {"pop": 1000, "area_sqmi": 1.0},
        {"pop": 3000, "area_sqmi": 1.0},
    ])
    assert out == (2500.0, 2)


def test_weighted_density_single_tract_equals_its_density():
    out = compute_weighted_density([{"pop": 500, "area_sqmi": 2.0}])
    assert out == (250.0, 1)


def test_weighted_density_excludes_invalid_tracts():
    out = compute_weighted_density([
        {"pop": 1000, "area_sqmi": 1.0},  # valid
        {"pop": 0, "area_sqmi": 1.0},      # pop 0 -> excluded
        {"pop": 500, "area_sqmi": 0.0},    # area 0 -> excluded
        {"pop": None, "area_sqmi": 1.0},   # pop None -> excluded
    ])
    assert out == (1000.0, 1)


def test_weighted_density_none_when_no_contributing_tracts():
    assert compute_weighted_density([]) is None
    assert compute_weighted_density([{"pop": 0, "area_sqmi": 0.0}]) is None


def test_gazetteer_year_for_boundary():
    assert gazetteer_year_for(2015) == 2019
    assert gazetteer_year_for(2019) == 2019
    assert gazetteer_year_for(2020) == 2023
    assert gazetteer_year_for(2022) == 2023


def test_aggregate_joins_groups_and_skips():
    # county 001 -> code 1, county 037 -> code 19
    lookup = {1: 1, 37: 19}
    gaz = {
        "06001400100": 1.0,
        "06001400200": 1.0,
        "06037900100": 2.0,
        # 06037900200 intentionally missing land area -> skipped
    }
    rows = [
        {"geoid": "06001400100", "pop": 1000},
        {"geoid": "06001400200", "pop": 3000},
        {"geoid": "06037900100", "pop": 500},
        {"geoid": "06037900200", "pop": 9999},  # no land area -> skipped
        {"geoid": "06099000100", "pop": 100},   # county 099 not in lookup -> skipped
    ]
    out = {r["county_code"]: r for r in aggregate_county_density(rows, gaz, lookup, 2022)}
    assert set(out) == {1, 19}
    assert out[1]["weighted_density"] == 2500.0
    assert out[1]["tract_count"] == 2
    assert out[1]["year"] == 2022
    assert out[19]["weighted_density"] == 250.0
    assert out[19]["tract_count"] == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_census_tract_density.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'etl.census_tract_density'`

- [ ] **Step 3: Implement the helpers**

Create `backend/etl/census_tract_density.py`:

```python
"""Census lived-density ETL — population-weighted density per CA county/year.

Joins ACS 5-year tract populations to Census Gazetteer tract land areas and
computes weighted_density = sum(pop^2/area) / sum(pop) per county. Distinct
from the crude demographics.population_density.

Sources:
  - ACS5 B01003_001E (tract population), Census API (settings.census_api_key)
  - Census Gazetteer national tract file (ALAND_SQMI)

Usage:
    python -m etl.census_tract_density
    python -m etl.census_tract_density --start 2018 --end 2022
"""

import argparse
import csv
import io
import logging
import zipfile
from collections import defaultdict

import httpx
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.database import EtlSessionLocal as SessionLocal
from app.models import County, TractDensityCountyYear
from app.settings import settings
from etl._utils import track_etl_run
from etl.nhtsa_fars import build_county_lookup

logger = logging.getLogger(__name__)

DEFAULT_START_YEAR = 2010
DEFAULT_END_YEAR = 2023
CA_STATE_FIPS = "06"

GAZETTEER_URL = (
    "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/"
    "{gaz_year}_Gazetteer/{gaz_year}_Gaz_tracts_national.zip"
)
ACS_URL = (
    "https://api.census.gov/data/{year}/acs/acs5"
    "?get=B01003_001E&for=tract:*&in=state:06&in=county:*&key={key}"
)
MAX_RETRIES = 3
BACKOFF_BASE = 2


def gazetteer_year_for(acs_year: int) -> int:
    """Pair an ACS year with a same-tract-vintage Gazetteer year."""
    return 2019 if acs_year <= 2019 else 2023


def compute_weighted_density(tracts: list[dict]) -> tuple[float, int] | None:
    """Population-weighted density = sum(pop^2/area) / sum(pop).

    Excludes tracts with missing/non-positive pop or area. Returns
    (weighted_density, tract_count) or None when nothing contributes.
    """
    sum_pop = 0.0
    sum_term = 0.0
    count = 0
    for t in tracts:
        pop = t.get("pop")
        area = t.get("area_sqmi")
        if pop is None or area is None or pop <= 0 or area <= 0:
            continue
        sum_pop += pop
        sum_term += (pop * pop) / area
        count += 1
    if count == 0 or sum_pop <= 0:
        return None
    return (sum_term / sum_pop, count)


def aggregate_county_density(
    tract_rows: list[dict],
    gaz_land_by_geoid: dict[str, float],
    county_lookup: dict[int, int],
    year: int,
) -> list[dict]:
    """Join tract pop to gazetteer land by GEOID, group by county, compute."""
    by_county: dict[int, list[dict]] = defaultdict(list)
    for r in tract_rows:
        geoid = r.get("geoid", "")
        try:
            county_fips = int(geoid[2:5])
        except (ValueError, IndexError):
            continue
        code = county_lookup.get(county_fips)
        if code is None:
            continue
        area = gaz_land_by_geoid.get(geoid)
        if area is None:
            continue
        by_county[code].append({"pop": r.get("pop"), "area_sqmi": area})

    out: list[dict] = []
    for code, tracts in sorted(by_county.items()):
        res = compute_weighted_density(tracts)
        if res is None:
            continue
        wd, tc = res
        out.append({
            "county_code": code, "year": year,
            "weighted_density": wd, "tract_count": tc,
        })
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_census_tract_density.py -v`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/etl/census_tract_density.py backend/tests/test_census_tract_density.py
git commit -m "feat(density): lived-density helpers + unit tests"
```

---

### Task 3: Gazetteer/ACS I/O + run() + job registration

**Files:**
- Modify: `backend/etl/census_tract_density.py` (add `fetch_gazetteer_land`, `fetch_tract_population`, `run`, `__main__`)
- Modify: `backend/etl/jobs.py` (register `tract_density` job)
- Modify: `backend/tests/test_census_tract_density.py` (registry test)
- Modify: `backend/tests/test_orchestrator.py:77` (job-count guard 24 → 25)

**Interfaces:**
- Consumes: helpers from Task 2; `build_county_lookup` (etl.nhtsa_fars); `Job`/`build_default_registry` (etl.jobs).
- Produces: `fetch_gazetteer_land(gaz_year) -> dict[str,float]`; `fetch_tract_population(year, api_key) -> list[dict]`; `run(start_year, end_year)`; job `tract_density`.

- [ ] **Step 1: Write the failing registry test**

Append to `backend/tests/test_census_tract_density.py`:

```python
def test_tract_density_job_registered():
    from etl.jobs import build_default_registry

    registry = build_default_registry()
    job = registry.get("tract_density")
    assert job.module == "etl.census_tract_density"
    assert job.table_name == "tract_density_county_year"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && python -m pytest tests/test_census_tract_density.py::test_tract_density_job_registered -v`
Expected: FAIL — `KeyError: 'tract_density'` (job not registered).

- [ ] **Step 3: Add I/O + run() to `etl/census_tract_density.py`**

Append to `backend/etl/census_tract_density.py` (before any `if __name__` block):

```python
def fetch_gazetteer_land(gaz_year: int) -> dict[str, float]:
    """Download a Gazetteer tract zip and return {GEOID: ALAND_SQMI} for CA."""
    url = GAZETTEER_URL.format(gaz_year=gaz_year)
    last_error = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = httpx.get(url, timeout=120, follow_redirects=True)
            resp.raise_for_status()
            break
        except (httpx.HTTPStatusError, httpx.RequestError) as exc:
            last_error = exc
            if attempt < MAX_RETRIES - 1:
                import time
                time.sleep(BACKOFF_BASE ** (attempt + 1))
    else:
        logger.error("All retries failed for Gazetteer %d", gaz_year)
        raise last_error

    land: dict[str, float] = {}
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        name = next((n for n in zf.namelist() if n.lower().endswith(".txt")), None)
        if name is None:
            logger.warning("No .txt in Gazetteer %d zip", gaz_year)
            return land
        with zf.open(name) as fh:
            # Gazetteer files are tab-delimited; headers have trailing spaces.
            text = io.TextIOWrapper(fh, encoding="latin-1", newline="")
            reader = csv.DictReader(text, delimiter="\t")
            reader.fieldnames = [f.strip() for f in (reader.fieldnames or [])]
            for row in reader:
                geoid = (row.get("GEOID") or "").strip()
                if not geoid.startswith(CA_STATE_FIPS):
                    continue
                try:
                    land[geoid] = float((row.get("ALAND_SQMI") or "").strip())
                except ValueError:
                    continue
    return land


def fetch_tract_population(year: int, api_key: str) -> list[dict]:
    """Fetch ACS5 tract population for CA. Returns [{geoid, pop}]."""
    url = ACS_URL.format(year=year, key=api_key)
    last_error = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = httpx.get(url, timeout=60)
            resp.raise_for_status()
            data = resp.json()
            break
        except (httpx.HTTPStatusError, httpx.RequestError) as exc:
            last_error = exc
            if attempt < MAX_RETRIES - 1:
                import time
                time.sleep(BACKOFF_BASE ** (attempt + 1))
    else:
        logger.error("All retries failed for ACS tract pop %d", year)
        raise last_error

    header = data[0]
    idx = {name: i for i, name in enumerate(header)}
    rows: list[dict] = []
    for row in data[1:]:
        geoid = f"{row[idx['state']]}{row[idx['county']]}{row[idx['tract']]}"
        raw = row[idx["B01003_001E"]]
        try:
            pop = int(raw) if raw not in (None, "") else None
        except ValueError:
            pop = None
        rows.append({"geoid": geoid, "pop": pop})
    return rows


@track_etl_run("tract_density")
def run(start_year: int = DEFAULT_START_YEAR, end_year: int = DEFAULT_END_YEAR):
    """Fetch + join + upsert lived-density rows for CA counties."""
    api_key = settings.census_api_key
    if not api_key:
        logger.error("CENSUS_API_KEY is not set. Add it to backend/.env")
        return

    db = SessionLocal()
    gaz_cache: dict[int, dict[str, float]] = {}
    try:
        counties = db.query(County.code, County.fips).all()
        lookup = build_county_lookup([(c.code, c.fips) for c in counties])
        logger.info("Loaded %d counties", len(lookup))

        total = 0
        for year in range(start_year, end_year + 1):
            try:
                gaz_year = gazetteer_year_for(year)
                if gaz_year not in gaz_cache:
                    gaz_cache[gaz_year] = fetch_gazetteer_land(gaz_year)
                land = gaz_cache[gaz_year]

                tract_rows = fetch_tract_population(year, api_key)
                rows = aggregate_county_density(tract_rows, land, lookup, year)
                if not rows:
                    logger.info("Year %d: no rows", year)
                    continue
                stmt = pg_insert(TractDensityCountyYear).values(rows)
                stmt = stmt.on_conflict_do_update(
                    constraint="tract_density_county_year_county_code_year_key",
                    set_={
                        "weighted_density": stmt.excluded.weighted_density,
                        "tract_count": stmt.excluded.tract_count,
                    },
                )
                db.execute(stmt)
                db.commit()
                total += len(rows)
                logger.info("Year %d: %d county rows upserted", year, len(rows))
            except Exception as exc:
                logger.warning("Tract-density year %d failed: %s", year, exc)
                db.rollback()

        logger.info("Done. %d total lived-density rows upserted.", total)
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Load Census lived-density into Postgres")
    parser.add_argument("--start", type=int, default=DEFAULT_START_YEAR)
    parser.add_argument("--end", type=int, default=DEFAULT_END_YEAR)
    args = parser.parse_args()
    run(start_year=args.start, end_year=args.end)
```

- [ ] **Step 4: Register the job in `etl/jobs.py`**

After the `fars` job registration block, add:

```python
    registry.register(Job(
        name="tract_density",
        module="etl.census_tract_density",
        schedule="monthly",
        table_name="tract_density_county_year",
        max_drop_pct=10,
        source_type="federal",
        freshness_table="tract_density_county_year",
    ))
```

- [ ] **Step 5: Bump the orchestrator job-count guard**

In `backend/tests/test_orchestrator.py` line 77, change:

```python
    assert len(registry.jobs) == 24  # +1: fars (NHTSA FARS correlation source)
```

to:

```python
    assert len(registry.jobs) == 25  # +1: tract_density (Census lived-density source)
```

- [ ] **Step 6: Run the registry + orchestrator tests**

Run: `cd backend && python -m pytest tests/test_census_tract_density.py tests/test_orchestrator.py -v`
Expected: PASS (7 in census_tract_density + orchestrator suite green)

- [ ] **Step 7: Commit**

```bash
git add backend/etl/census_tract_density.py backend/etl/jobs.py backend/tests/test_census_tract_density.py backend/tests/test_orchestrator.py
git commit -m "feat(density): gazetteer/ACS I/O + run() + job registration"
```

---

### Task 4: `/api/tract-density` endpoint + schema

**Files:**
- Create: `backend/app/schemas/tract_density.py`
- Create: `backend/app/routers/tract_density.py`
- Modify: `backend/app/main.py` (import + include, next to `fars`)
- Create: `backend/tests/api/test_tract_density.py`

**Interfaces:**
- Consumes: `TractDensityCountyYear` (Task 1).
- Produces: `GET /api/tract-density` → `list[TractDensityOut]`.

- [ ] **Step 1: Write the failing integration test**

Create `backend/tests/api/test_tract_density.py`:

```python
"""Integration tests for /api/tract-density."""

import pytest

from app.models import TractDensityCountyYear

pytestmark = pytest.mark.integration


def _seed(db_session):
    db_session.add_all([
        TractDensityCountyYear(county_code=19, year=2022, weighted_density=8500.0, tract_count=2300),
        TractDensityCountyYear(county_code=30, year=2022, weighted_density=4200.0, tract_count=580),
        TractDensityCountyYear(county_code=19, year=2021, weighted_density=8400.0, tract_count=2295),
    ])
    db_session.flush()


def test_tract_density_returns_rows(client, db_session):
    _seed(db_session)
    resp = client.get("/api/tract-density")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 3
    row = next(r for r in body if r["county_code"] == 19 and r["year"] == 2022)
    assert row["weighted_density"] == 8500.0
    assert row["tract_count"] == 2300


def test_tract_density_filters_by_year(client, db_session):
    _seed(db_session)
    body = client.get("/api/tract-density?year=2022").json()
    assert {r["year"] for r in body} == {2022}
    assert len(body) == 2


def test_tract_density_filters_by_county(client, db_session):
    _seed(db_session)
    body = client.get("/api/tract-density?county=orange").json()
    assert {r["county_code"] for r in body} == {30}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && python -m pytest tests/api/test_tract_density.py -v`
Expected: FAIL — 404 (route not registered) / import error.

- [ ] **Step 3: Write the schema**

Create `backend/app/schemas/tract_density.py`:

```python
"""Response model for /api/tract-density."""

from pydantic import BaseModel


class TractDensityOut(BaseModel):
    county_code: int
    year: int
    weighted_density: float | None = None
    tract_count: int | None = None

    model_config = {"from_attributes": True}
```

- [ ] **Step 4: Write the router**

Create `backend/app/routers/tract_density.py`:

```python
"""Census population-weighted ("lived") density per county."""

from fastapi import APIRouter, Depends, Query, Request, Response
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from app.county_slug_map import get_slug_map
from app.database import get_db
from app.filters import parse_county_codes, parse_year
from app.models import TractDensityCountyYear
from app.schemas.tract_density import TractDensityOut

router = APIRouter(tags=["tract_density"])

_limiter = Limiter(key_func=get_remote_address)

_FIVE_MIN = "public, max-age=300"


@router.get("/tract-density", response_model=list[TractDensityOut])
@_limiter.limit("1000/minute;20000/hour")
def list_tract_density(
    request: Request,
    response: Response,
    county: str | None = Query(None),
    year: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """Population-weighted ("lived") density per county/year (CA)."""
    response.headers["Cache-Control"] = _FIVE_MIN
    q = db.query(TractDensityCountyYear)
    if county:
        codes = parse_county_codes(county, get_slug_map(db))
        if codes:
            q = q.filter(TractDensityCountyYear.county_code.in_(codes))
    if year:
        years = parse_year(year)
        if years:
            q = q.filter(TractDensityCountyYear.year.in_(years))
    rows = q.order_by(TractDensityCountyYear.county_code, TractDensityCountyYear.year).all()
    return [TractDensityOut.model_validate(r) for r in rows]
```

- [ ] **Step 5: Register the router in `app/main.py`**

With the other router imports (next to `from app.routers.fars import router as fars_router`):

```python
from app.routers.tract_density import router as tract_density_router  # noqa: E402
```

With the other `include_router` calls (after the fars include):

```python
app.include_router(tract_density_router, prefix="/api")
```

- [ ] **Step 6: Run the integration tests to verify they pass**

Run: `cd backend && python -m pytest tests/api/test_tract_density.py -v`
Expected: PASS (3 tests). (Requires Postgres on localhost:5433; runs in CI if not available locally.)

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas/tract_density.py backend/app/routers/tract_density.py backend/app/main.py backend/tests/api/test_tract_density.py
git commit -m "feat(density): /api/tract-density endpoint + schema + tests"
```

---

### Task 5: Wire lived-density into the correlation matrix (frontend)

**Files:**
- Modify: `frontend/src/hooks/useCorrelationData.ts`
- Create: `frontend/src/hooks/useCorrelationData.density.test.ts`

**Interfaces:**
- Consumes: `/api/tract-density` returning `{county_code, year, weighted_density, tract_count}[]`.
- Produces: exported `applyTractDensityAggregation(rows, byCounty)`; `CORRELATION_FIELDS` entry `weighted_density`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/useCorrelationData.density.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { CORRELATION_FIELDS, applyTractDensityAggregation } from "./useCorrelationData";
import type { CountyRow } from "./useCorrelationData";

describe("lived-density correlation field", () => {
  it("registers weighted_density with source census", () => {
    const f = CORRELATION_FIELDS.find((x) => x.key === "weighted_density");
    expect(f).toBeDefined();
    expect(f?.source).toBe("census");
  });

  it("applies most-recent-year weighted_density per county, skips unknown counties", () => {
    const byCounty: Record<string, CountyRow> = { "19": { crash_count: 5 } };
    applyTractDensityAggregation(
      [
        { county_code: 19, year: 2021, weighted_density: 8400, tract_count: 1 },
        { county_code: 19, year: 2022, weighted_density: 8500, tract_count: 1 },
        { county_code: 30, year: 2022, weighted_density: 4200, tract_count: 1 }, // not in byCounty
      ] as unknown as Record<string, unknown>[],
      byCounty,
    );
    expect(byCounty["19"].weighted_density).toBe(8500); // latest year wins
    expect(byCounty["30"]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/useCorrelationData.density.test.ts`
Expected: FAIL — `applyTractDensityAggregation` is not exported / `weighted_density` not found.

- [ ] **Step 3: Add the field**

In `frontend/src/hooks/useCorrelationData.ts`, append to the `CORRELATION_FIELDS` array (after the `pct_unrestrained` entry from the FARS work):

```typescript
  { key: "weighted_density", label: "Lived Density", source: "census" },
```

- [ ] **Step 4: Add the aggregation helper + call**

In `useCorrelationData.ts`, add the exported helper (place it next to `applyFarsAggregation`):

```typescript
export function applyTractDensityAggregation(
  density: Record<string, unknown>[],
  byCounty: Record<string, CountyRow>,
): void {
  const latest: Record<string, Record<string, unknown>> = {};
  for (const r of density) {
    const code = String(r.county_code ?? "");
    const existing = latest[code];
    if (!existing || (r.year as number) > (existing.year as number)) {
      latest[code] = r;
    }
  }
  for (const [code, r] of Object.entries(latest)) {
    if (!byCounty[code]) continue;
    const wd = r.weighted_density as number | null;
    if (wd != null) byCounty[code].weighted_density = wd;
  }
}
```

Add `/api/tract-density` to the supplemental `Promise.all` (after the `/api/fars` fetch) and include it in the destructuring:

```typescript
        safeFetchJson<Record<string, unknown>[]>(`${API_BASE}/api/tract-density`),
```

```typescript
      const [demographics, calenviro, unemployment, vehicles, weather, fars, density] = await Promise.all([
```

After the `applyFarsAggregation(fars, byCounty)` call (added in the FARS work), add:

```typescript
      applyTractDensityAggregation(density, byCounty);
```

(If the FARS work left the FARS aggregation inline rather than as a call, place `applyTractDensityAggregation(density, byCounty)` immediately after the FARS block. The `CountyRow` type and `safeFetchJson` already exist in this file.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/hooks/useCorrelationData.density.test.ts`
Expected: PASS

- [ ] **Step 6: Typecheck + lint + full FE suite**

Run: `cd frontend && npx tsc --noEmit && npx eslint . && npx vitest run`
Expected: tsc exit 0; eslint 0 errors; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/useCorrelationData.ts frontend/src/hooks/useCorrelationData.density.test.ts
git commit -m "feat(density): wire lived-density into correlation matrix"
```

---

## Self-Review

**Spec coverage:**
- Metric (weighted density formula + exclusions) → Task 2 (`compute_weighted_density`). ✓
- Tract-vintage pairing → Task 2 (`gazetteer_year_for`). ✓
- County mapping reuse → Task 2/3 (`build_county_lookup` import). ✓
- Two sources + join → Task 3 (`fetch_gazetteer_land`, `fetch_tract_population`, `aggregate_county_density`). ✓
- Gazetteer caching per vintage → Task 3 (`gaz_cache`). ✓
- Schema/table → Task 1. ✓
- Job registration + count bump → Task 3. ✓
- API endpoint + schema → Task 4. ✓
- Frontend field + aggregation → Task 5. ✓
- Census key guard → Task 3 (`run`). ✓
- Tests (unit + router + frontend) → Tasks 2, 3, 4, 5. ✓
- Out-of-scope respected (no live load, no new chart, CA-only, additive). ✓

**Placeholder scan:** None. Task 5 Step 4 notes the FARS-block placement contingency — that's a concrete conditional instruction (handle inline vs. helper form of the prior FARS work), not an unfilled blank; the code to add is fully shown.

**Type consistency:** `compute_weighted_density`/`aggregate_county_density`/`gazetteer_year_for` signatures match between Task 2 definition and Task 3 usage. `TractDensityCountyYear` columns identical across Tasks 1/3/4. `TractDensityOut` fields match the model and the frontend's consumed keys (`weighted_density`, `tract_count`, `county_code`, `year`). Upsert constraint `tract_density_county_year_county_code_year_key` is the Postgres default for `UniqueConstraint("county_code","year")` on table `tract_density_county_year`, used consistently. `applyTractDensityAggregation(density, byCounty)` signature matches between Task 5 definition and test.
