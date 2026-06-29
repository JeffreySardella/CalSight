# Census "Lived Density" (Population-Weighted Density) — Design Spec

**Date:** 2026-06-29
**Status:** Approved (design)
**Sub-project:** 3 of 3 in the "new correlation data sources" effort. (1 = NHTSA FARS, shipped; 2 = DUI arrests, PARKED — no maintainable machine-readable source; 3 = this.) Independent, with its own spec/plan/implementation.

## Goal

Add **population-weighted density** ("lived density") as a new county-level field in the Stats-page correlation matrix. This is the density experienced by the average resident — `Σ(tract_pop² / tract_land_sqmi) / Σ(tract_pop)` over a county's census tracts. It is meaningfully distinct from the crude `population_density` (county population ÷ county land area) the demographics table already exposes: two counties with identical crude density but different internal concentration (a dense city beside empty land vs. uniform suburbia) get very different lived density — and lived density is far more relevant to crash exposure.

New correlation field: **`weighted_density`** (label "Lived Density", source `census`).

Scope of "done" (per decision): **full pipeline + tests, no live data load.** ETL module, model, migration, endpoint, and correlation wiring with tests using fixtures. The actual load runs later via the ETL. Nothing here writes to prod data.

Year scope (per decision): **full 2010–latest**, handling both census-tract vintages (2010-vintage tracts for ACS5 ≤2019, 2020-vintage for ACS5 ≥2020) by pairing each ACS year with a same-vintage Gazetteer.

## Data sources (two, joined per year by tract GEOID)

1. **Tract population** — ACS 5-year `B01003_001E` at tract level, via the same Census API + key the demographics ETL already uses (`settings` Census key). Query: `https://api.census.gov/data/{year}/acs/acs5?get=B01003_001E&for=tract:*&in=state:06&in=county:*&key=...`. (Verified: the endpoint is valid; keyless requests 302 to `missing_key` — the project key is required and already configured.) The response columns include `state`, `county`, `tract`; the 11-digit GEOID = `06` + 3-digit county + 6-digit tract. If the `in=county:*` wildcard is rejected for tracts in a given year, fall back to looping the 58 counties.
2. **Tract land area** — Census Gazetteer national tract file: `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/{gaz_year}_Gazetteer/{gaz_year}_Gaz_tracts_national.zip` (verified 200, keyless). Inside is a tab-delimited `.txt` with columns including `GEOID`, `ALAND_SQMI`. Filter to CA (`GEOID` starts with `06`).

### Tract-vintage / year pairing

Census tract boundaries change each decade, and land area must match the tract vintage of that year's ACS data. Rule: **for ACS year Y, use the Gazetteer file whose tract vintage matches** — implemented as a small `gazetteer_year_for(acs_year)` map:
- ACS 2010–2019 → a 2010-vintage Gazetteer (use `2019` tract gazetteer; for 2010–2011 where no tract gazetteer was published, the 2010-vintage file still applies — same tract boundaries).
- ACS 2020–latest → a 2020-vintage Gazetteer (use the latest available, e.g. `2023`).

The join is by exact tract GEOID; GEOIDs present in one source but not the other are skipped (logged). A mismatched vintage would simply produce few/no matches for a year — so the pairing map is the safeguard. The two distinct Gazetteer files are downloaded once and cached in-process (keyed by gaz_year) so multi-year runs don't re-fetch.

### County mapping

ACS returns the 3-digit county FIPS. Reuse the existing pure helper **`build_county_lookup`** from `etl.nhtsa_fars` (maps last-3-digits-of-`County.fips` → `county_code`) — already exported and unit-tested; no refactor needed.

## The metric

Per county per year, over that county's tracts with valid population and positive land area:

```
weighted_density = Σ(pop_t² / area_t) / Σ(pop_t)
tract_count      = number of contributing tracts
```

- Equivalent to the population-weighted mean of tract densities (each resident weighted by their tract's density). Standard "lived density."
- Tracts with `pop_t is None`, `pop_t == 0`, or `area_t <= 0` are excluded (can't contribute / divide-by-zero).
- If a county has no contributing tracts in a year, it produces no row for that year.
- `weighted_density` is an inherently derived metric (not re-aggregatable from a single stored scalar), so unlike the FARS raw counts it is **stored computed** (a float). `tract_count` is stored for transparency/QA.

## Schema

New table `tract_density_county_year` (same shape family as `fars_county_year`):

| column            | type        | notes |
|-------------------|-------------|-------|
| `id`              | Integer PK  | |
| `county_code`     | SmallInteger FK→counties.code, not null | |
| `year`            | SmallInteger not null | |
| `weighted_density`| Float       | population-weighted density (persons/sq mi) |
| `tract_count`     | Integer     | tracts contributing to the calc |
| `created_at`      | DateTime server_default now() | |

- `UniqueConstraint("county_code", "year")` (upsert key) + `Index("ix_tract_density_county_year", "county_code", "year")`.
- Alembic migration: plain `CREATE TABLE`, `down_revision` = current head at implementation time (chain off whatever FARS's `t8u9v0w1x2y3` led to / the live head), working downgrade.

## ETL module — `etl/census_tract_density.py`

Mirrors `noaa_weather.py`/`nhtsa_fars.py` structure:
- Pure, unit-testable helpers (no network/db):
  - `compute_weighted_density(tracts: list[dict]) -> tuple[float, int] | None` — input tract dicts `{pop, area_sqmi}`; returns `(weighted_density, tract_count)` or `None` if no contributing tracts. Implements the formula + guards above.
  - `aggregate_county_density(tract_rows, gaz_land_by_geoid, county_lookup, year) -> list[dict]` — joins ACS tract rows to gazetteer land by GEOID, groups by county_code, calls `compute_weighted_density`, returns `{county_code, year, weighted_density, tract_count}` per county.
  - `gazetteer_year_for(acs_year: int) -> int` — the vintage-pairing map above.
- I/O layer (network, not unit-tested):
  - `fetch_gazetteer_land(gaz_year) -> dict[str, float]` — httpx download + `zipfile` + parse the tab-delimited tract file → `{GEOID: ALAND_SQMI}` for CA (GEOID prefix `06`). Cached per `gaz_year`.
  - `fetch_tract_population(year, api_key) -> list[dict]` — ACS5 call(s); returns rows with `state`/`county`/`tract`/`B01003_001E`. Builds GEOID = state+county+tract.
  - `run(start_year, end_year)` — loads counties, builds lookup, per year: resolve gazetteer vintage → land lookup (cached) → fetch ACS tract pop → `aggregate_county_density` → `pg_insert(...).on_conflict_do_update` on `tract_density_county_year_county_code_year_key`, updating `weighted_density`/`tract_count`; per-year try/except + rollback; commit per year. `@track_etl_run("tract_density")`. Reads the Census key from `settings` like `census_api.py`.
- `argparse` `--start`/`--end` (defaults 2010–2023); `python -m etl.census_tract_density`.

Registered in `etl/jobs.py`: `Job(name="tract_density", module="etl.census_tract_density", schedule="monthly", table_name="tract_density_county_year", max_drop_pct=10, source_type="federal", freshness_table="tract_density_county_year")`.

## API endpoint — `app/routers/tract_density.py`

Copy of `weather.py`/`fars.py`:
- `GET /api/tract-density` → `list[TractDensityOut]`, optional `county`/`year` filters, ordered by `(county_code, year)`, `Cache-Control: public, max-age=300`, same rate limit.
- `app/schemas/tract_density.py`: `TractDensityOut` (county_code, year, weighted_density, tract_count), `model_config = {"from_attributes": True}`.
- Registered in `app/main.py` next to the `fars`/`weather` includes.

## Frontend wiring — `useCorrelationData.ts`

- Add `/api/tract-density` to the supplemental `Promise.all` (graceful-skip via `safeFetchJson`) + include in the destructuring.
- Aggregate most-recent-year per county → set `byCounty[code].weighted_density` (extract into a pure `applyTractDensityAggregation(rows, byCounty)` helper, mirroring the FARS `applyFarsAggregation` precedent so it's unit-testable).
- Add to `CORRELATION_FIELDS`: `{ key: "weighted_density", label: "Lived Density", source: "census" }`.
- No new component — the matrix renders the new row/column automatically.

## Testing

Backend (pytest, fixtures — no network):
- `compute_weighted_density`: known multi-tract county yields the exact weighted value; single tract returns that tract's density; excludes pop=0 / area<=0 / pop=None tracts; returns `None` when no contributing tracts.
- `aggregate_county_density`: joins ACS rows to gazetteer land by GEOID; groups by county; skips GEOIDs missing land area; skips unmapped counties; stamps year.
- `gazetteer_year_for`: 2015→2010-vintage, 2022→2020-vintage at the boundary.
- Router test (integration): seed `tract_density_county_year`, assert `GET /api/tract-density` shape + `county`/`year` filters (follow `tests/api/test_fars.py`).
- Job-registry: `tract_density` registered (and bump the `test_orchestrator.py` job-count guard — it will go from 24 to 25).

Frontend (vitest):
- `weighted_density` registered in `CORRELATION_FIELDS` with `source: "census"`.
- `applyTractDensityAggregation`: latest-year-wins per county; value set correctly; county absent from `byCounty` skipped.

## Out of scope (YAGNI)

- No live download/load (decision).
- No new chart/visual — correlation matrix only.
- No sub-county/tract-level UI — we surface a single county-level metric.
- No replacement of the existing crude `population_density` — this is additive.
- Non-CA excluded.

## Risks / notes

- **Tract-vintage boundary (2020).** Handled by `gazetteer_year_for`; a documented discontinuity exists at 2020 (tract boundaries redrawn). Because the matrix uses most-recent-year per county, the active value is from the 2020 vintage; older years are for completeness. Acceptable and noted.
- **`in=county:*` wildcard for tracts.** If a given ACS year rejects the statewide tract wildcard, `fetch_tract_population` falls back to per-county loops. Either way machine-readable.
- **Census key.** Same `settings` key the demographics ETL already requires; if unset, `run()` logs and returns (mirrors `noaa_weather.py`'s token guard).
- **Gazetteer file availability.** 2023 verified; the vintage map only needs one 2010-era file and one 2020-era file, both long-published and stable.
