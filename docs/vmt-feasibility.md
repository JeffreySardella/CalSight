# VMT Data Feasibility — county-level Vehicle-Miles-Traveled for California

**Created:** 2026-07-03. **Purpose:** decide whether CalSight can add county VMT to power
exposure-normalized crash rates (crashes per 100M VMT) — the biggest analytical differentiator vs.
TIMS (see `feature-data-roadmap.md` A2 / `data-storytelling-plan.md` Lens B). The prior DUI-arrests
effort died because the only source was PDF/dashboard-only, so **machine-readable format is the
deciding factor here.**

## Verdict

**Buildable.** Unlike DUI arrests, machine-readable, all-58-county, annual VMT exists. There are two
viable ingestion paths plus a PDF "truth" reference. This is a **go**, gated on one quick
confirmation (recency of the cleanest source) that can only be done from an environment with
outbound access to `data.ca.gov` — this sandbox's egress policy blocks it (403).

## Source comparison

| Source | Measures | Grain | Format | Years | Feasibility |
|---|---|---|---|---|---|
| **data.ca.gov "Annual Miles Traveled"** (CDPH HCI) | Annual miles by mode (vehicle = total-road VMT); modeled from Caltrans+HPMS+Census | State/region/**county (58)**/city | **CSV via CKAN API** (same `datastore_search` CalSight already uses) | **⚠️ verify** — historical mirror is 2002–2010; may be stale | **HIGH format / MEDIUM overall** |
| **CARB EMFAC** emissions inventory | Modeled annual on-road VMT by county | **County (58)** + air basin/district/MPO | **CSV export** (interactive form / default DB — no clean REST) | **1970–2040+** (EMFAC2021), 2025 model extends further | **MEDIUM** (best recency; ingestion needs form-driving) |
| Caltrans **Public Road Data (PRD/HPMS)** | Authoritative **total-road DVMT** by county | County (58) | **PDF ONLY** (`prdYYYY-a11y.pdf`) | 2003–present | **LOW** — the PDF trap; use as validation cross-check only |
| Caltrans **PeMS** | Sensor-**measured** VMT | State-highway system only | Web app, account required | continuous | **LOW** + wrong denominator (misses local roads) |
| **FHWA** Highway Statistics | VMT by **state** only | State | tables | annual | LOW for county |
| MPO models (SANDAG/SCAG/MTC), CA Household Travel Survey | Modeled regional VMT / periodic survey | Region (patchwork) | mixed | varies | LOW — not a uniform 58-county denominator |

## Recommendation

1. **Try data.ca.gov "Annual Miles Traveled" first** (`https://data.ca.gov/dataset/annual-miles-traveled`).
   It is a **drop-in fit** to CalSight's existing CKAN loader (`etl/load_licensed_drivers.py`) and
   needs the least new code. **Prefer it only if its `reportyear` extends to recent years.**
2. **If it stops ~2010, use CARB EMFAC** (`https://emfac.arb.ca.gov/emissions-inventory/`, region =
   County) for recency/forecast — modeled, CSV export, all counties, but ingestion means driving the
   tool's export POST or shipping EMFAC's default DB.
3. **Cross-check against Caltrans PRD PDFs** for a few counties/years — authoritative total-road
   DVMT — but never put PDF-scraping in the pipeline.

## Confirm before building (the one gate — a single CKAN call in an unrestricted env)

```
GET https://data.ca.gov/api/3/action/package_show?id=annual-miles-traveled
GET https://data.ca.gov/api/3/action/datastore_search?resource_id=<id>&limit=5
```
Confirm: (a) the **`resource_id`** of the CSV resource, (b) the exact **column names**
(expect something like `geotype`, `geoname`/`county_fips`, `mode`, `reportyear`, and an estimate
column), and (c) the **max `reportyear`**. If (c) is recent → Path A; if stale → Path B (EMFAC).

## Statistical caveat — must ship in the UI

Crashes scale **sublinearly** with VMT ("safety in numbers"): fitted exposure exponents ≈ **0.5–0.7**
(Elvik & Goel 2019; arXiv 2605.27889). A naive linear `crashes ÷ VMT × 100M` **overstates** risk on
high-VMT counties (LA) and **understates** it on low-VMT rural counties. So the per-100M-VMT measure
must be labeled as a **normalized exposure rate, not a linear risk multiplier** — and ideally offer a
variance-stabilized/power-adjusted view. (Neutral-voice note, per the storytelling plan.)

## Turnkey build plan (mirrors `load_licensed_drivers.py` + `LicensedDriver`)

Once the resource is confirmed, this is ~1 loader + 1 model + 1 migration + a downstream measure:

1. **Model** — add `Vmt` to `app/models.py` mirroring `LicensedDriver`:
   `county_code` (FK), `year`, `annual_vmt` (BigInteger), `source` (String — "annual-miles-traveled"
   or "EMFAC2025"; a discriminator so modeled sources can coexist and be compared to the PRD PDF).
2. **Migration** — new alembic revision creating the `vmt` table (plain `CREATE TABLE`; add the
   read-only-role SELECT grant if that pattern is in use).
3. **Loader** — `etl/load_vmt.py` copying the CKAN pattern:
   `RESOURCE_ID` const → `datastore_search` via `get_with_retry` → filter to county rows
   (`geotype == "CO"`, vehicle mode) → `name_to_code` lookup (reuse the trailing-whitespace/upper
   normalization already in the drivers loader) → emit `(county_code, year, annual_vmt, source)` →
   upsert; wrap in `@track_etl_run`. **Log distinct `reportyear` values on first run** so staleness
   is immediately visible. Register the job in `etl/jobs.py` (federal/CKAN source type, yearly-ish
   cadence, `depends_on` none, `table_name="vmt"`).
4. **Rate measure** — add `crashes_per_100m_vmt` alongside the existing per-capita / per-driver rates
   (the `mv_crash_rates` materialized view + the stats `rate` group_by and the choropleth "measures"
   layer). Structurally identical to the existing driver/population denominators — no new plumbing,
   just a new measure column and the sublinear-caveat note in the UI.

Every step lands in the same per-county-per-year shape as `demographics` and `licensed_drivers`, so
downstream rate computation and the choropleth need no structural change.

## Sources
Feasibility research (2026-07-03): Caltrans PRD/HPMS, data.ca.gov Annual Miles Traveled (CDPH HCI),
CARB EMFAC, Caltrans PeMS, FHWA Highway Statistics. Sublinear exposure: Elvik & Goel 2019
(ScienceDirect S0001457519303641); arXiv 2605.27889.
