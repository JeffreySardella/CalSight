# NHTSA FARS Correlation Source — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add NHTSA FARS as a county-level data source feeding the existing Stats-page correlation matrix with two fields: `fars_fatalities` (independent fatality cross-check) and `pct_unrestrained` (derived).

**Architecture:** New `fars_county_year` table + Alembic migration; `etl/nhtsa_fars.py` ETL (pure aggregation helpers + httpx/zip I/O) registered in `jobs.py`; `/api/fars` read endpoint mirroring `weather.py`; correlation wiring in `useCorrelationData.ts`. Full pipeline + tests; no live data load.

**Tech Stack:** Python 3 / FastAPI / SQLAlchemy / Alembic / pytest (backend); React / TypeScript / vitest / TanStack Query (frontend).

## Global Constraints

- CA only: filter FARS rows to `STATE == "6"`.
- Year range default: 2001–2025, CLI-overridable (`--start`/`--end`), matching `noaa_weather.py`.
- Store raw counts only; derive `pct_unrestrained` in the frontend (mirrors `ev_pct`).
- Write DB access uses `EtlSessionLocal`; read endpoints use `get_db`.
- Spec: `docs/superpowers/specs/2026-06-29-fars-design.md`.
- Backend integration tests are marked `pytest.mark.integration` and need Postgres on `localhost:5433` (provided in CI); pure-function ETL tests need no DB and run anywhere.
- Restraint coding constants (best-effort, adjustable): `UNRESTRAINED_CODES = {"0"}`, `UNKNOWN_RESTRAINT_CODES = {"8", "9", "96", "97", "98", "99", ""}`.

---

### Task 1: `FarsCountyYear` model + Alembic migration

**Files:**
- Modify: `backend/app/models.py` (add model after the `Weather` class, ~line 505)
- Create: `backend/migrations/versions/t8u9v0w1x2y3_add_fars_county_year.py`

**Interfaces:**
- Produces: `FarsCountyYear` ORM model with columns `id, county_code, year, fatalities, unrestrained_killed, restraint_known_killed, created_at`; table `fars_county_year`; unique constraint `fars_county_year_county_code_year_key` on `(county_code, year)`.

- [ ] **Step 1: Add the model**

In `backend/app/models.py`, immediately after the `Weather` class (before `class SpeedLimit`):

```python
class FarsCountyYear(Base):
    """NHTSA FARS fatal-crash aggregates per county per year.

    Federal census of fatal crashes (Fatality Analysis Reporting System).
    Stores raw counts; the frontend derives pct_unrestrained from
    unrestrained_killed / restraint_known_killed. CA only.

    Source: NHTSA FARS yearly National CSV bundles.
    """

    __tablename__ = "fars_county_year"

    id = Column(Integer, primary_key=True)
    county_code = Column(
        SmallInteger, ForeignKey("counties.code"), nullable=False
    )
    year = Column(SmallInteger, nullable=False)
    fatalities = Column(Integer)               # killed persons (INJ_SEV==4)
    unrestrained_killed = Column(Integer)      # killed w/ REST_USE in UNRESTRAINED_CODES
    restraint_known_killed = Column(Integer)   # killed w/ a non-missing REST_USE
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("county_code", "year"),
        Index("ix_fars_county_year", "county_code", "year"),
    )
```

- [ ] **Step 2: Verify the model imports cleanly**

Run: `cd backend && python -c "from app.models import FarsCountyYear; print(FarsCountyYear.__tablename__)"`
Expected: prints `fars_county_year`

- [ ] **Step 3: Write the migration**

Create `backend/migrations/versions/t8u9v0w1x2y3_add_fars_county_year.py`:

```python
"""add fars_county_year table

NHTSA FARS fatal-crash aggregates per county/year. New empty table —
plain CREATE TABLE (no CONCURRENTLY needed).

Revision ID: t8u9v0w1x2y3
Revises: s7t8u9v0w1x2
Create Date: 2026-06-29 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "t8u9v0w1x2y3"
down_revision: Union[str, None] = "s7t8u9v0w1x2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "fars_county_year",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("county_code", sa.SmallInteger(), nullable=False),
        sa.Column("year", sa.SmallInteger(), nullable=False),
        sa.Column("fatalities", sa.Integer(), nullable=True),
        sa.Column("unrestrained_killed", sa.Integer(), nullable=True),
        sa.Column("restraint_known_killed", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(["county_code"], ["counties.code"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("county_code", "year"),
    )
    op.create_index("ix_fars_county_year", "fars_county_year", ["county_code", "year"])


def downgrade() -> None:
    op.drop_index("ix_fars_county_year", table_name="fars_county_year")
    op.drop_table("fars_county_year")
```

- [ ] **Step 4: Verify the migration is the single head**

Run: `cd backend && alembic heads`
Expected: one head, `t8u9v0w1x2y3 (head)`. (If `alembic` needs a DB URL and none is available locally, this is verified in CI; at minimum confirm `down_revision` matches the prior head `s7t8u9v0w1x2`.)

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/migrations/versions/t8u9v0w1x2y3_add_fars_county_year.py
git commit -m "feat(fars): fars_county_year model + migration"
```

---

### Task 2: FARS aggregation helpers + unit tests (TDD core)

**Files:**
- Create: `backend/etl/nhtsa_fars.py` (pure helpers only in this task)
- Create: `backend/tests/test_nhtsa_fars.py`

**Interfaces:**
- Produces:
  - `build_county_lookup(counties: list[tuple[int, str | None]]) -> dict[int, int]` — maps 3-digit within-state FIPS → `county_code`, from `(code, fips)` pairs; skips null/short fips.
  - `aggregate_fars(person_rows: list[dict], county_lookup: dict[int, int], year: int) -> list[dict]` — returns per-county dicts `{county_code, year, fatalities, unrestrained_killed, restraint_known_killed}`. Counts only CA (`STATE=="6"`) killed (`INJ_SEV=="4"`) persons.
  - Constants `UNRESTRAINED_CODES`, `UNKNOWN_RESTRAINT_CODES`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_nhtsa_fars.py`:

```python
"""Unit tests for FARS aggregation helpers (no DB, no network)."""

from etl.nhtsa_fars import build_county_lookup, aggregate_fars


def test_build_county_lookup_maps_last_three_fips_digits():
    lookup = build_county_lookup([(1, "06001"), (19, "06037"), (30, "06059")])
    assert lookup == {1: 1, 37: 19, 59: 30}


def test_build_county_lookup_skips_missing_fips():
    lookup = build_county_lookup([(1, "06001"), (99, None), (98, "")])
    assert lookup == {1: 1}


def _person(state="6", county="37", inj="4", rest="3"):
    return {"STATE": state, "COUNTY": county, "INJ_SEV": inj, "REST_USE": rest}


def test_aggregate_counts_fatalities_per_county():
    lookup = {37: 19, 59: 30}
    rows = [_person(county="37"), _person(county="37"), _person(county="59")]
    out = {r["county_code"]: r for r in aggregate_fars(rows, lookup, 2022)}
    assert out[19]["fatalities"] == 2
    assert out[30]["fatalities"] == 1
    assert out[19]["year"] == 2022


def test_aggregate_classifies_restraint():
    lookup = {37: 19}
    rows = [
        _person(rest="0"),   # unrestrained + known
        _person(rest="3"),   # restrained + known
        _person(rest="99"),  # unknown -> excluded from denominator
    ]
    out = aggregate_fars(rows, lookup, 2022)[0]
    assert out["fatalities"] == 3
    assert out["unrestrained_killed"] == 1
    assert out["restraint_known_killed"] == 2


def test_aggregate_skips_non_ca_and_non_fatal_and_unmapped():
    lookup = {37: 19}
    rows = [
        _person(state="48"),            # not CA
        _person(inj="1"),               # injured, not killed
        _person(county="999"),          # unmapped county
        _person(),                      # valid -> counted
    ]
    out = aggregate_fars(rows, lookup, 2022)
    assert len(out) == 1
    assert out[0]["county_code"] == 19
    assert out[0]["fatalities"] == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_nhtsa_fars.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'etl.nhtsa_fars'`

- [ ] **Step 3: Implement the helpers**

Create `backend/etl/nhtsa_fars.py`:

```python
"""NHTSA FARS ETL — fatal-crash aggregates per California county per year.

Downloads the yearly FARS National CSV bundle, reads accident/person tables,
filters to California (STATE=6), and upserts per-county fatality + restraint
counts into fars_county_year. The frontend derives pct_unrestrained.

Source: NHTSA FARS  https://static.nhtsa.gov/nhtsa/downloads/FARS/

Usage:
    python -m etl.nhtsa_fars
    python -m etl.nhtsa_fars --start 2018 --end 2022
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
from app.models import County, FarsCountyYear
from etl._utils import track_etl_run

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

DEFAULT_START_YEAR = 2001
DEFAULT_END_YEAR = 2025
CA_STATE_FIPS = "6"

# REST_USE classification (best-effort, FARS codes drift across years).
UNRESTRAINED_CODES = {"0"}
UNKNOWN_RESTRAINT_CODES = {"8", "9", "96", "97", "98", "99", ""}

FARS_ZIP_URL = (
    "https://static.nhtsa.gov/nhtsa/downloads/FARS/"
    "{year}/National/FARS{year}NationalCSV.zip"
)
MAX_RETRIES = 3
BACKOFF_BASE = 2


def build_county_lookup(counties: list[tuple[int, str | None]]) -> dict[int, int]:
    """Map 3-digit within-state FIPS -> county_code from (code, fips) pairs."""
    lookup: dict[int, int] = {}
    for code, fips in counties:
        if not fips or len(fips) < 3:
            continue
        lookup[int(fips[-3:])] = code
    return lookup


def aggregate_fars(
    person_rows: list[dict], county_lookup: dict[int, int], year: int
) -> list[dict]:
    """Aggregate FARS person rows to per-county fatality + restraint counts."""
    tally: dict[int, dict[str, int]] = defaultdict(
        lambda: {"fatalities": 0, "unrestrained_killed": 0, "restraint_known_killed": 0}
    )
    for r in person_rows:
        if str(r.get("STATE")) != CA_STATE_FIPS:
            continue
        if str(r.get("INJ_SEV")) != "4":  # 4 == Fatal Injury (killed)
            continue
        try:
            county = int(r.get("COUNTY"))
        except (TypeError, ValueError):
            continue
        code = county_lookup.get(county)
        if code is None:
            continue
        rest = str(r.get("REST_USE", "")).strip()
        t = tally[code]
        t["fatalities"] += 1
        if rest not in UNKNOWN_RESTRAINT_CODES:
            t["restraint_known_killed"] += 1
        if rest in UNRESTRAINED_CODES:
            t["unrestrained_killed"] += 1

    return [
        {"county_code": code, "year": year, **counts}
        for code, counts in sorted(tally.items())
    ]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_nhtsa_fars.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/etl/nhtsa_fars.py backend/tests/test_nhtsa_fars.py
git commit -m "feat(fars): aggregation helpers + unit tests"
```

---

### Task 3: FARS download/load I/O + job registration

**Files:**
- Modify: `backend/etl/nhtsa_fars.py` (add `fetch_year`, `run`, `__main__`)
- Modify: `backend/etl/jobs.py` (register the `fars` job)
- Modify: `backend/tests/test_nhtsa_fars.py` (add registry test)

**Interfaces:**
- Consumes: `build_county_lookup`, `aggregate_fars` (Task 2); `Job`, `JobRegistry`, `build_default_registry` (existing in `etl/jobs.py`).
- Produces: `fetch_year(year: int) -> list[dict]` (CA person rows); `run(start_year, end_year)` (upserts); job named `"fars"` in the default registry.

- [ ] **Step 1: Write the failing registry test**

Append to `backend/tests/test_nhtsa_fars.py`:

```python
def test_fars_job_registered():
    from etl.jobs import build_default_registry

    registry = build_default_registry()
    job = registry.get("fars")
    assert job is not None
    assert job.module == "etl.nhtsa_fars"
    assert job.table_name == "fars_county_year"
```

(If `registry.get` is not the accessor name, use the registry's documented lookup — confirm against `etl/orchestrator.py`'s `JobRegistry`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && python -m pytest tests/test_nhtsa_fars.py::test_fars_job_registered -v`
Expected: FAIL — `assert None is not None` (job not registered yet)

- [ ] **Step 3: Add I/O + run() to `etl/nhtsa_fars.py`**

Append to `backend/etl/nhtsa_fars.py` (before the `if __name__` block):

```python
def fetch_year(year: int) -> list[dict]:
    """Download a FARS year bundle and return California person rows.

    Reads person.csv from the zip, filtering STATE==6 while parsing to keep
    memory small. Returns raw dict rows for aggregate_fars().
    """
    url = FARS_ZIP_URL.format(year=year)
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
        logger.error("All retries failed for FARS %d", year)
        raise last_error

    rows: list[dict] = []
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        name = next(
            (n for n in zf.namelist() if n.lower().endswith("person.csv")), None
        )
        if name is None:
            logger.warning("No person.csv in FARS %d bundle", year)
            return rows
        with zf.open(name) as fh:
            text = io.TextIOWrapper(fh, encoding="latin-1", newline="")
            for r in csv.DictReader(text):
                if str(r.get("STATE")) == CA_STATE_FIPS:
                    rows.append(r)
    return rows


@track_etl_run("fars")
def run(start_year: int = DEFAULT_START_YEAR, end_year: int = DEFAULT_END_YEAR):
    """Fetch + aggregate + upsert FARS county/year rows for CA."""
    db = SessionLocal()
    try:
        counties = db.query(County.code, County.fips).all()
        lookup = build_county_lookup([(c.code, c.fips) for c in counties])
        logger.info("Loaded %d counties", len(lookup))

        total = 0
        for year in range(start_year, end_year + 1):
            try:
                person_rows = fetch_year(year)
                rows = aggregate_fars(person_rows, lookup, year)
                if not rows:
                    logger.info("Year %d: no rows", year)
                    continue
                stmt = pg_insert(FarsCountyYear).values(rows)
                stmt = stmt.on_conflict_do_update(
                    constraint="fars_county_year_county_code_year_key",
                    set_={
                        "fatalities": stmt.excluded.fatalities,
                        "unrestrained_killed": stmt.excluded.unrestrained_killed,
                        "restraint_known_killed": stmt.excluded.restraint_known_killed,
                    },
                )
                db.execute(stmt)
                db.commit()
                total += len(rows)
                logger.info("Year %d: %d county rows upserted", year, len(rows))
            except Exception as exc:
                logger.warning("FARS year %d failed: %s", year, exc)
                db.rollback()

        logger.info("Done. %d total FARS county/year rows upserted.", total)
    finally:
        db.close()
```

And update the `__main__` block at the bottom:

```python
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Load NHTSA FARS data into Postgres")
    parser.add_argument("--start", type=int, default=DEFAULT_START_YEAR)
    parser.add_argument("--end", type=int, default=DEFAULT_END_YEAR)
    args = parser.parse_args()
    run(start_year=args.start, end_year=args.end)
```

- [ ] **Step 4: Register the job in `etl/jobs.py`**

After the `weather` job registration block, add:

```python
    registry.register(Job(
        name="fars",
        module="etl.nhtsa_fars",
        schedule="monthly",
        table_name="fars_county_year",
        max_drop_pct=10,
        source_type="federal",
        freshness_table="fars_county_year",
    ))
```

(Match the exact `Job(...)` kwargs the `weather` job uses; drop `freshness_table` if the `weather` job doesn't set it, and copy whatever fields it does.)

- [ ] **Step 5: Run the registry test (and full helper suite)**

Run: `cd backend && python -m pytest tests/test_nhtsa_fars.py -v`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/etl/nhtsa_fars.py backend/etl/jobs.py backend/tests/test_nhtsa_fars.py
git commit -m "feat(fars): download/load run() + job registration"
```

---

### Task 4: `/api/fars` endpoint + schema

**Files:**
- Create: `backend/app/schemas/fars.py`
- Create: `backend/app/routers/fars.py`
- Modify: `backend/app/main.py` (import at ~line 191, include at ~line 207)
- Create: `backend/tests/api/test_fars.py`

**Interfaces:**
- Consumes: `FarsCountyYear` model (Task 1).
- Produces: `GET /api/fars` → `list[FarsOut]`; `FarsOut(county_code, year, fatalities, unrestrained_killed, restraint_known_killed)`.

- [ ] **Step 1: Write the failing integration test**

Create `backend/tests/api/test_fars.py`:

```python
"""Integration tests for /api/fars."""

import pytest

from app.models import FarsCountyYear

pytestmark = pytest.mark.integration


def _seed_fars(db_session):
    db_session.add_all([
        FarsCountyYear(county_code=19, year=2022, fatalities=100,
                       unrestrained_killed=30, restraint_known_killed=80),
        FarsCountyYear(county_code=30, year=2022, fatalities=20,
                       unrestrained_killed=5, restraint_known_killed=18),
        FarsCountyYear(county_code=19, year=2021, fatalities=90,
                       unrestrained_killed=25, restraint_known_killed=70),
    ])
    db_session.flush()


def test_fars_returns_rows(client, db_session):
    _seed_fars(db_session)
    resp = client.get("/api/fars")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 3
    row = next(r for r in body if r["county_code"] == 19 and r["year"] == 2022)
    assert row["fatalities"] == 100
    assert row["unrestrained_killed"] == 30
    assert row["restraint_known_killed"] == 80


def test_fars_filters_by_year(client, db_session):
    _seed_fars(db_session)
    body = client.get("/api/fars?year=2022").json()
    assert {r["year"] for r in body} == {2022}
    assert len(body) == 2


def test_fars_filters_by_county(client, db_session):
    _seed_fars(db_session)
    body = client.get("/api/fars?county=orange").json()
    assert {r["county_code"] for r in body} == {30}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && python -m pytest tests/api/test_fars.py -v`
Expected: FAIL — 404 (route not registered) / import error for the router.

- [ ] **Step 3: Write the schema**

Create `backend/app/schemas/fars.py`:

```python
"""Response model for /api/fars."""

from pydantic import BaseModel


class FarsOut(BaseModel):
    county_code: int
    year: int
    fatalities: int | None = None
    unrestrained_killed: int | None = None
    restraint_known_killed: int | None = None

    model_config = {"from_attributes": True}
```

- [ ] **Step 4: Write the router**

Create `backend/app/routers/fars.py`:

```python
"""NHTSA FARS fatal-crash aggregates per county."""

from fastapi import APIRouter, Depends, Query, Request, Response
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from app.county_slug_map import get_slug_map
from app.database import get_db
from app.filters import parse_county_codes, parse_year
from app.models import FarsCountyYear
from app.schemas.fars import FarsOut

router = APIRouter(tags=["fars"])

_limiter = Limiter(key_func=get_remote_address)

_FIVE_MIN = "public, max-age=300"


@router.get("/fars", response_model=list[FarsOut])
@_limiter.limit("1000/minute;20000/hour")
def list_fars(
    request: Request,
    response: Response,
    county: str | None = Query(None),
    year: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """NHTSA FARS fatality + restraint aggregates per county/year (CA)."""
    response.headers["Cache-Control"] = _FIVE_MIN
    q = db.query(FarsCountyYear)
    if county:
        codes = parse_county_codes(county, get_slug_map(db))
        if codes:
            q = q.filter(FarsCountyYear.county_code.in_(codes))
    if year:
        years = parse_year(year)
        if years:
            q = q.filter(FarsCountyYear.year.in_(years))
    rows = q.order_by(FarsCountyYear.county_code, FarsCountyYear.year).all()
    return [FarsOut.model_validate(r) for r in rows]
```

- [ ] **Step 5: Register the router in `app/main.py`**

Near line 191 (with the other router imports):

```python
from app.routers.fars import router as fars_router  # noqa: E402
```

Near line 207 (with the other `include_router` calls, after the weather line):

```python
app.include_router(fars_router, prefix="/api")
```

- [ ] **Step 6: Run the integration tests to verify they pass**

Run: `cd backend && python -m pytest tests/api/test_fars.py -v`
Expected: PASS (3 tests). (Requires Postgres on localhost:5433; runs in CI if not available locally.)

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas/fars.py backend/app/routers/fars.py backend/app/main.py backend/tests/api/test_fars.py
git commit -m "feat(fars): /api/fars endpoint + schema + tests"
```

---

### Task 5: Wire FARS into the correlation matrix (frontend)

**Files:**
- Modify: `frontend/src/hooks/useCorrelationData.ts`
- Create: `frontend/src/hooks/useCorrelationData.fars.test.ts`

**Interfaces:**
- Consumes: `/api/fars` (Task 4) returning `{county_code, year, fatalities, unrestrained_killed, restraint_known_killed}[]`.
- Produces: `CORRELATION_FIELDS` entries `fars_fatalities` and `pct_unrestrained`; per-county values on the correlation rows.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/useCorrelationData.fars.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { CORRELATION_FIELDS } from "./useCorrelationData";

describe("FARS correlation fields", () => {
  it("registers fars_fatalities and pct_unrestrained", () => {
    const keys = CORRELATION_FIELDS.map((f) => f.key);
    expect(keys).toContain("fars_fatalities");
    expect(keys).toContain("pct_unrestrained");
    const fars = CORRELATION_FIELDS.find((f) => f.key === "fars_fatalities");
    expect(fars?.source).toBe("fars");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/useCorrelationData.fars.test.ts`
Expected: FAIL — `expect(keys).toContain("fars_fatalities")` (field not present).

- [ ] **Step 3: Add the fields**

In `frontend/src/hooks/useCorrelationData.ts`, append to the `CORRELATION_FIELDS` array (after the `precip` entry, line ~47):

```typescript
  { key: "fars_fatalities", label: "FARS Deaths", source: "fars" },
  { key: "pct_unrestrained", label: "Unrestrained %", source: "fars" },
```

- [ ] **Step 4: Add the fetch + aggregation**

In `useCorrelationData.ts`, add `/api/fars` to the supplemental `Promise.all` (after the `weather` fetch, line ~123):

```typescript
        safeFetchJson<Record<string, unknown>[]>(`${API_BASE}/api/fars`),
```

Update the destructuring to include `fars`:

```typescript
      const [demographics, calenviro, unemployment, vehicles, weather, fars] = await Promise.all([
```

After the weather aggregation block (line ~233), add:

```typescript
      // FARS — most recent year per county; derive pct_unrestrained
      const farsByCounty: Record<string, Record<string, unknown>> = {};
      for (const r of fars) {
        const code = String(r.county_code ?? "");
        const existing = farsByCounty[code];
        if (!existing || (r.year as number) > (existing.year as number)) {
          farsByCounty[code] = r;
        }
      }
      for (const [code, r] of Object.entries(farsByCounty)) {
        if (!byCounty[code]) continue;
        const fatalities = r.fatalities as number | null;
        if (fatalities != null) byCounty[code].fars_fatalities = fatalities;
        const unrestrained = r.unrestrained_killed as number | null;
        const known = r.restraint_known_killed as number | null;
        if (unrestrained != null && known != null && known > 0) {
          byCounty[code].pct_unrestrained = (unrestrained / known) * 100;
        }
      }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/hooks/useCorrelationData.fars.test.ts`
Expected: PASS

- [ ] **Step 6: Typecheck + lint + full FE suite**

Run: `cd frontend && npx tsc --noEmit && npx eslint . && npx vitest run`
Expected: tsc exit 0; eslint 0 errors; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/useCorrelationData.ts frontend/src/hooks/useCorrelationData.fars.test.ts
git commit -m "feat(fars): wire FARS fields into correlation matrix"
```

---

## Self-Review

**Spec coverage:**
- Data source/acquisition → Task 3 (`fetch_year`). ✓
- County mapping → Task 2 (`build_county_lookup`). ✓
- Restraint coding → Task 2 (constants + `aggregate_fars`). ✓
- Schema/table → Task 1. ✓
- ETL module + job → Tasks 2–3. ✓
- API endpoint + schema → Task 4. ✓
- Frontend wiring (2 fields) → Task 5. ✓
- Testing (unit + router + frontend) → Tasks 2, 4, 5. ✓
- Out-of-scope items respected (no live load, no new chart, CA-only). ✓

**Placeholder scan:** Two spots flag verify-against-codebase notes (registry accessor name in Task 3; exact `Job` kwargs / `freshness_table` presence) — these are deliberate "confirm the existing signature" checks, not unfilled placeholders; the code to write is fully shown. No TBD/TODO.

**Type consistency:** `build_county_lookup`/`aggregate_fars` signatures match between Task 2 definition and Task 3 usage. `FarsCountyYear` columns identical across Tasks 1/3/4. `FarsOut` fields match the model and the frontend's consumed keys. Constraint name `fars_county_year_county_code_year_key` (Postgres default for `UniqueConstraint("county_code","year")` on table `fars_county_year`) used consistently in Task 3 upsert.
