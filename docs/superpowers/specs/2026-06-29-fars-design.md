# NHTSA FARS Integration — Design Spec

**Date:** 2026-06-29
**Status:** Approved (design)
**Sub-project:** 1 of 3 in the "new correlation data sources" effort (FARS → DUI arrests → Census tract). Each is independent with its own spec/plan/implementation.

## Goal

Add NHTSA FARS (Fatality Analysis Reporting System) as a new county-level data
source feeding the existing correlation matrix on the Stats page. FARS is the
federal census of fatal crashes, FIPS-county-coded, giving us:

1. **`fars_fatalities`** — an independent fatality count per county, to cross-check
   the SWITRS/CCRS `total_killed` we already report.
2. **`pct_unrestrained`** — share of killed occupants not wearing a restraint. A
   genuinely new behavioral safety signal not present in SWITRS.

Scope of "done" (per decision): **full pipeline + tests, no live data load.** The
ETL module, model, migration, endpoint, correlation wiring, and unit tests are
delivered; the actual download/load runs later via the daily ETL or a manual
trigger against prod. Nothing in this work writes to the prod DB.

## Data source & acquisition

- NHTSA yearly national CSV bundles:
  `https://static.nhtsa.gov/nhtsa/downloads/FARS/{year}/National/FARS{year}NationalCSV.zip`
- Files used inside the zip:
  - `accident.csv` — one row per fatal crash. Columns used: `STATE` (FIPS, CA=6),
    `COUNTY` (3-digit within-state FIPS), `FATALS` (count killed in that crash),
    `ST_CASE` (join key).
  - `person.csv` — one row per person involved. Columns used: `STATE`, `COUNTY`,
    `ST_CASE`, `INJ_SEV` (4 = killed), `REST_USE` (restraint-use code).
- Filter to `STATE == 6` (California only).
- Year range: **2001–latest** (matches `noaa_weather.py` default), CLI-overridable
  via `--start`/`--end`.

### County mapping

FARS `COUNTY` is the 3-digit within-state FIPS. `County.fips` is the full 5-digit
FIPS (e.g. `06001`). Build a lookup `{int(fips[-3:]) → county_code}` from the
`counties` table, exactly as `noaa_weather.py` reads `County.fips`. FARS rows whose
`COUNTY` is an unknown/special code (e.g. 0, 997–999) with no match are skipped.

### Restraint coding

`REST_USE` is a coded field whose valid-vs-missing values shift slightly across FARS
years. We classify each **killed** person (`INJ_SEV == 4`) as:
- **unrestrained** if `REST_USE` is in the "none used" set (code `0`),
- **restraint-known** if `REST_USE` is a real, non-missing code (i.e. not in the
  unknown/not-reported/not-applicable set: `8, 9, 96, 97, 98, 99` and blank).

`pct_unrestrained = unrestrained_killed / restraint_known_killed` (derived in the
frontend). The unknown set is defined as a module-level constant so it is easy to
audit and adjust; the aggregation counts only restraint-known killed in the
denominator so missing codes don't deflate the rate.

## Schema

New table `fars_county_year` (mirrors the `weather` model shape):

| column                  | type        | notes |
|-------------------------|-------------|-------|
| `id`                    | Integer PK  | |
| `county_code`           | SmallInteger FK→counties.code, not null | |
| `year`                  | SmallInteger not null | |
| `fatalities`            | Integer     | sum of killed persons (`INJ_SEV==4`) in county/year |
| `unrestrained_killed`   | Integer     | killed with `REST_USE` in the none-used set |
| `restraint_known_killed`| Integer     | killed with a non-missing `REST_USE` |
| `created_at`            | DateTime server_default now() | |

- `UniqueConstraint("county_code", "year")` (upsert key) + `Index("ix_fars_county_year", "county_code", "year")`.
- Raw counts only — the frontend derives `pct_unrestrained`, matching the `ev_pct`
  pattern (`ev_vehicles / total_vehicles`). This keeps the stored data
  re-aggregatable.
- Alembic migration: plain `CREATE TABLE` (new empty table — no CONCURRENTLY needed).
  Revision chained off the current head.

## ETL module — `etl/nhtsa_fars.py`

Naming matches existing source modules (`noaa_weather.py`, `dmv_vehicles.py`,
`bls_unemployment.py`). Structure mirrors `noaa_weather.py`:

- `@track_etl_run("fars")`, writes via `EtlSessionLocal`.
- Pure, unit-testable helpers (no network/db) so tests use fixtures:
  - `build_county_lookup(counties) -> dict[int, int]` — 3-digit FIPS → county_code.
  - `aggregate_fars(accident_rows, person_rows, county_lookup, year) -> list[dict]` —
    returns per-county dicts `{county_code, year, fatalities, unrestrained_killed,
    restraint_known_killed}`. Counts killed persons from `person.csv`; `fatalities`
    is the count of `INJ_SEV==4` persons in CA counties (cross-checkable against
    `accident.FATALS`, but persons is the source of truth so restraint and fatality
    counts come from one table).
- I/O layer (network, not unit-tested):
  - `fetch_year(year) -> (accident_rows, person_rows)` — httpx download of the zip,
    `zipfile` + `csv.DictReader` parse, with `MAX_RETRIES`/backoff like the NOAA
    module. Filters `STATE == "6"` while parsing to keep memory small.
  - `run(start_year, end_year)` — loops years, aggregates, `pg_insert ...
    on_conflict_do_update` upsert on the unique constraint, commits per year,
    logs counts. Per-year try/except + rollback (matches NOAA).
- `argparse` `--start`/`--end`; `python -m etl.nhtsa_fars`.

Registered in `etl/jobs.py`:
```python
registry.register(Job(
    name="fars",
    module="etl.nhtsa_fars",
    schedule="monthly",          # FARS releases annually; monthly check is cheap
    table_name="fars_county_year",
    max_drop_pct=10,
    source_type="federal",
    freshness_table="fars_county_year",
))
```

## API endpoint — `app/routers/fars.py`

Copy of `weather.py`:
- `GET /api/fars` → `list[FarsOut]`, optional `county`/`year` filters, ordered by
  `(county_code, year)`, `Cache-Control: public, max-age=300`, same rate limit.
- `app/schemas/fars.py`: `FarsOut` (county_code, year, fatalities,
  unrestrained_killed, restraint_known_killed) with `model_config = ConfigDict(from_attributes=True)`.
- Router registered wherever the other routers are included (mirror `weather`'s
  registration in the app factory / `main`).

## Frontend wiring — `useCorrelationData.ts`

- Add `/api/fars` to the `Promise.all` supplemental fetch block (graceful-skip via
  `safeFetchJson`, like the others).
- Aggregate: most-recent-year row per county → set `byCounty[code].fars_fatalities`
  and, when `restraint_known_killed > 0`, `byCounty[code].pct_unrestrained =
  unrestrained_killed / restraint_known_killed * 100`.
- Add to `CORRELATION_FIELDS`:
  - `{ key: "fars_fatalities", label: "FARS Deaths", source: "fars" }`
  - `{ key: "pct_unrestrained", label: "Unrestrained %", source: "fars" }`
- No new component — the matrix renders the new rows/cols automatically.

## Testing

Backend (pytest, fixtures — no network):
- `build_county_lookup` maps 5-digit FIPS → 3-digit key → county_code.
- `aggregate_fars`: counts fatalities; classifies unrestrained vs restraint-known;
  excludes unknown `REST_USE` codes from the denominator; skips unmatched counties;
  filters non-CA rows.
- Router test: seed `fars_county_year`, assert `GET /api/fars` shape + `county`/`year`
  filters (follow `tests/api/test_stats_highways.py` / existing weather/router tests).
- Migration import/smoke (table exists after upgrade) if the suite has that pattern.

Frontend (vitest):
- Extend the `useCorrelationData` test (or add one) asserting `fars_fatalities` and
  derived `pct_unrestrained` populate from a mocked `/api/fars` response, and that
  the fields appear in `CORRELATION_FIELDS`.

## Out of scope (YAGNI)

- No live download/load in this work (decision: full pipeline + tests only).
- No new chart/visual — correlation matrix only.
- No backfill of the `crashes` table with FARS data; FARS lives in its own table.
- No restraint richness beyond the two fields (no rollover/speeding — that was the
  rejected "richer profile" option).
- Non-CA states excluded.

## Risks / notes

- **FARS column/code drift across years.** `REST_USE` codes and even file/column
  names vary by FARS year. Mitigation: keep the unknown-restraint code set and the
  column names as module constants; parse defensively (skip rows missing required
  fields); `max_drop_pct` guards a bad year. Worst case the load skips a
  problematic year rather than corrupting data — acceptable since this is additive.
- **`accident.FATALS` vs counted persons.** We count killed persons from
  `person.csv` so fatality and restraint counts come from one consistent source;
  `accident.FATALS` is available as a sanity cross-check in logs if desired.
