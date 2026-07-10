# Water Data Explorer — Exploration

**Status:** exploration spike (branch `claude/water-data-explorer`)
**Goal:** figure out whether CalSight should grow a second module — California water conditions — and what a v1 would look like.

## Why water, why CalSight

CalSight's name reads as "California insight," not "crash sight." The crash explorer proved out a reusable pattern: public state data → ETL → PostgreSQL → FastAPI → React, organized around counties. A water module reuses that entire spine:

- **Same ingestion pattern.** DWR publishes water data on data.cnra.ca.gov, which runs the *same CKAN DataStore API* as data.ca.gov — `etl/ckan_api.py`'s pagination/retry/discovery logic transfers almost verbatim. CDEC (the California Data Exchange Center) adds a simple JSON servlet for daily time series.
- **Same county-centric model.** Drought status, groundwater levels, and reservoir locations all join cleanly to the existing `County` model, so water data can appear inside the existing county detail views, not just on a new page.
- **Deliberately zero-AI core.** Unlike the crash module's "Ask AI" features, the water module is designed to require no LLM anywhere: pure data engineering — ETL, SQL, time series, and charts. (AI narratives could be bolted on later, but nothing in this design depends on one.) This keeps the module fully demonstrable in contexts where AI usage is a non-starter.

## Data sources

All endpoints below were **not reachable from the sandboxed session** that authored this doc (outbound policy blocks non-registry hosts), so response shapes are from documentation and prior observation. **First local task: run `python -m etl.cdec_api --smoke` and confirm the parser against live responses.**

### 1. CDEC — reservoir storage and snowpack (primary, v1)

The Data Exchange Center's JSON servlet returns daily/monthly sensor time series per station:

```
https://cdec.water.ca.gov/dynamicapp/req/JSONDataServlet
    ?Stations=SHA,ORO,FOL
    &SensorNums=15          # 15 = reservoir storage (acre-feet)
    &dur_code=D             # D = daily, M = monthly
    &Start=2026-06-01
    &End=2026-07-01
```

Response: a JSON array of `{stationId, date, value, units, ...}` rows; missing values come back as `-9999`. Key sensor numbers:

| Sensor | Meaning |
|---|---|
| 15 | Reservoir storage (AF) |
| 3  | Snow water content (inches) |
| 82 | Snow water content, revised |

Station metadata (capacity, coordinates, county) is not part of the servlet, so the spike ships a static map of ~15 major reservoirs (`MAJOR_RESERVOIRS` in `etl/cdec_api.py`) — same pattern as `RESOURCE_IDS` in `ckan_api.py`. Capacities/counties there are best-effort and **must be verified against CDEC station pages before load**.

### 2. data.cnra.ca.gov CKAN — groundwater and snow courses (v2+)

Same API as data.ca.gov (`/api/3/action/datastore_search`), so `ckan_api.py` patterns apply directly:

- *Periodic groundwater level measurements* (DWR) — well readings joinable to county.
- *Snow course measurements* (monthly, back to 1910) — long-horizon snowpack trends.

### 3. US Drought Monitor — weekly county drought status (v1, cheap win)

```
https://usdmdataservices.unl.edu/api/CountyStatistics/GetDroughtSeverityStatisticsByAreaPercent
    ?aoi=CA&startdate=1/1/2020&enddate=7/1/2026&statisticsType=1
```

Weekly D0–D4 area percentages per county FIPS. Tiny data volume, joins straight onto the existing `County` model, and gives every county page a drought badge with ~one day of work.

## Proposed schema (v1)

```
reservoirs            station_id PK, name, capacity_af, county_id FK, lat, lon
reservoir_daily       station_id FK, date, storage_af          (PK: station_id+date)
drought_county_weekly county_id FK, week_start, d0..d4 pct     (PK: county_id+week_start)
```

Historical averages per (station, day-of-year) come from a materialized view over `reservoir_daily` — same pattern as the existing crash materialized views. That powers the classic "storage vs. capacity vs. historical average" chart without any extra source.

## API sketch

```
GET /api/water/reservoirs                      # list w/ latest storage, % capacity, % of hist avg
GET /api/water/reservoirs/{station_id}/series  # daily time series, ?start&end
GET /api/water/drought/{county_slug}           # weekly drought series for a county
GET /api/water/summary                         # statewide: total storage vs capacity, snowpack % (v2)
```

## UI sketch

- New top-level **Water** page beside Map/Stats: reservoir gauge grid (storage bars against capacity with a historical-average tick), a statewide summary header, and a map layer of reservoir markers sized by capacity.
- **County detail integration:** drought badge + sparkline, and the county's reservoirs, rendered inside the existing county view. This is the piece that makes CalSight feel like one product instead of two glued-together apps.
- Charts follow DESIGN.md (custom SVG, "Digital Ledger" tonal layering — reservoir gauges suit that aesthetic well).

## Phasing

1. **P1 — Reservoirs:** CDEC client (this spike) → `load_reservoirs.py` → `/api/water/reservoirs` → gauge grid page. Demoable on its own.
2. **P2 — Drought by county:** Drought Monitor ETL → county page badges. Small, high-visibility.
3. **P3 — Snowpack:** CDEC snow sensors + statewide % of April 1 average.
4. **P4 — Groundwater:** CNRA CKAN wells, county-level trends. Largest data volume, do last.

## What's on this branch

**Spike (first commit):**

- `backend/etl/cdec_api.py` — CDEC JSON servlet client: fetch + retry + parse + `-9999` handling, static major-reservoir metadata, `--smoke` CLI for the first live-network test.
- `backend/tests/test_cdec_api.py` — unit tests with mocked HTTP, matching `test_ckan_api.py` conventions.

**Phase 1 backend (second commit):**

- `Reservoir` + `ReservoirDaily` models and Alembic migration `w1x2y3z4a5b6` (includes the conditional `calsight_api_ro` SELECT grant).
- `etl/load_reservoirs.py` — metadata + daily-storage upserts; trailing-45-day default run, `--backfill` walks year-sized windows from 2000. Registered as the `reservoirs` daily job.
- `GET /api/water/reservoirs` — latest reading per reservoir with % of capacity and % of the same-day-of-year historical average.
- `GET /api/water/reservoirs/{station_id}/series` — windowed daily time series.
- Tests: loader unit tests (including a guard that every county name in `MAJOR_RESERVOIRS` is a real CA county) + 9 API integration tests. Full backend suite green (830 passed) against a scratch Postgres, which also exercised the migration via `alembic upgrade head`.

**Phase 1 frontend (third commit):**

- `/water` route with nav + bottom-tab entries: statewide summary strip
  (total storage, % of combined capacity, storage-weighted % of historical
  average) over a reservoir card grid. Each card shows % of capacity, % of
  the same-day-of-year average, a storage bar with an average tick, and
  lazy-loads a one-year sparkline on demand.
- `useWaterData.ts` hooks + the shared `summarize`/`formatAcreFeet` helpers.
- SEO touchpoints updated: crawler middleware, sitemap, prefetch
  speculation rules (with the matching CSP hash bump in `_headers`).
- 17 new tests; full frontend suite green (708) plus lint and production
  build.

**Phase 2 — drought (fourth commit):**

- `etl/usdm_api.py` — US Drought Monitor county-statistics client
  (case-insensitive keys, M/D/YYYY params, `--smoke` CLI) +
  `etl/load_drought.py` (FIPS→county mapping, trailing-8-week default,
  `--backfill` from 2000), registered as the weekly `drought` job.
- `drought_county_weekly` table + migration (with the read-role grant).
- `GET /api/water/drought` — latest week: land-area-weighted statewide
  percents + per-county breakdown. `GET /api/water/drought/series` —
  weighted weekly trend.
- Frontend: drought section on `/water` — statewide 100%-stacked severity
  bar, legend with values, hardest-hit county rows. Severity uses a
  sequential warm ramp with separate dark-mode steps (CSS vars
  `--drought-d0..d4`), CVD-checked; the section hides itself until data
  is loaded. Verified visually in light and dark against seeded demo data.
- Suite totals: 856 backend + 716 frontend, green.

**Polish (fifth commit):** statewide drought trend sparkline (two-year
D1+ share from `/api/water/drought/series`), README features/data-source
updates.

**County integration (sixth commit):** drought status row inside the
map's county insight card (single-county mode), fed the county code the
map already resolves — links to `/water`.

**Review pass (seventh commit):** an 8-angle adversarial review of the
whole branch surfaced 10 findings, all fixed: batch upserts now dedupe
on their conflict key (Postgres "cannot affect row a second time");
CDEC/USDM clients delegate to `etl._utils.get_with_retry` instead of
hand-rolled loops that retried 4xx; a null CDEC `sensorNumber` no longer
aborts a run; the drought job schedule is honestly `daily`; the
"has history" check counts contributing years instead of comparing
values; the reservoir series window no longer sends a UTC-lagged end
date; drought weighting is one SQL definition shared by both endpoints;
redundant composite indexes were replaced by an expression index
(station, month, day) INCLUDE (storage_af) that serves the day-of-year
average query.

## Snowpack (P3) — deliberately deferred, and why

Unlike the major reservoirs (whose CDEC codes are household names —
SHA, ORO, FOL), snow-station codes and metadata can't be written down
confidently without querying CDEC, and this sandbox can't reach it.
Rather than ship a fabricated station list, P3 is specced for a session
with live network:

1. Discover stations: CDEC's station search (or the `getStationInfo`
   endpoints) filtered to sensor 3 (snow water content) — pick ~4 per
   Sierra region (North/Central/South), verified active.
2. Reuse `fetch_sensor_data(stations, SENSOR_SNOW_WATER_CONTENT, ...)`
   — the CDEC client is already sensor-generic.
3. Same "% of same-day-of-year average" derivation as reservoirs — no
   external April-1 constants needed to start.

Still to come: live smoke tests (`python -m etl.cdec_api --smoke`,
`python -m etl.usdm_api --smoke` — both hosts blocked in this sandbox),
capacity verification, snowpack per above, county-detail integration.

## Open questions

- Verify CDEC servlet response field names live (`stationId` vs `station_id`, date format) — parser is written defensively but assumes the documented shape.
- Confirm capacities/counties in `MAJOR_RESERVOIRS` against CDEC station pages.
- Does CDEC rate-limit? No published limits; spike defaults to one request per station batch with retries, mirroring `noaa_weather.py` courtesy delays.
- Snow: CDEC point sensors vs. DWR's regional snowpack indices — decide at P3.
