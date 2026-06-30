# Next Data Sources — Vetted Backlog (correlation matrix frontier)

**Updated:** 2026-06-29. Purpose: a *pre-vetted* shortlist of candidate datasets to add
to the Stats-page correlation matrix, ranked by feasibility, so we don't sink effort into
dead-ends (cf. **DUI**, which had no machine-readable per-county source — OpenJustice buckets
DUI into "all other felonies" and the DMV DUI-MIS is dashboards/PDF only).

**Two hard requirements for the correlation matrix** (it's county-keyed, 58 CA counties,
one value per county via most-recent-year):
1. **County-keyable** — has a county FIPS/name, or lat/long we can map to a county.
2. **Machine-readable** — CSV / JSON / API / spreadsheet. **Not** PDF-table or dashboard-only
   (that's what killed DUI). Verify the *actual download format* before building.

The proven build pattern (FARS, lived-density): `etl/<source>.py` (pure helpers + I/O) →
`<source>` table + migration → `/api/<source>` → `useCorrelationData.ts` field. ~5 TDD tasks.

---

## Tier A — Build-ready (county-keyable + confirmed machine-readable)

### A1. EV charging station density — `chargers_per_100k`
- **Source:** US DOE **AFDC Alternative Fueling Station Locator** — public **API + CSV**
  (`https://developer.nrel.gov/api/alt-fuel-stations/v1`), every station with lat/long,
  city, state, and often county. Filter `state=CA`, `fuel_type=ELEC`.
- **County-key:** county field or lat/long → county (reuse the point-in-county logic the
  coord-validation ETL already has).
- **Signal:** charging *infrastructure* density — distinct from the existing `ev_pct`
  (registration *adoption*). Tests an "EV-readiness vs crash patterns" angle.
- **Feasibility:** HIGH. Clean API, free key (same NREL family; we already use NREL-style
  keys). Mirrors FARS almost exactly.
- **Caveat:** modest analytical novelty (correlates with density/affluence we already have).

---

## Tier B — High value, but VERIFY FORMAT FIRST (format risk)

### B1. County VMT (vehicle-miles-traveled) — `crashes_per_vmt` ⭐ highest analytical value
- **Why it matters most:** VMT is the **exposure denominator** crash analysis actually wants.
  Right now every "rate" is per-capita; **crashes per VMT** (or per-million-VMT) is the
  gold-standard normalization and would materially upgrade the whole matrix's honesty.
- **Source:** Caltrans **"California Public Road Data" / HPMS**, annual county VMT
  (`https://dot.ca.gov/programs/traffic-operations/census`, HPMS GIS Data Library).
- **FORMAT RISK:** historically published as **PDF** ("California Public Road Data" annual
  PDFs) — a DUI-style dead-end if that's all there is. BUT the Traffic Census program also
  notes **yearly spreadsheets** + a **GIS data library**. **Action: confirm a CSV/XLSX or
  GIS attribute table of county VMT exists** before committing. If yes → top priority build.
- **Feasibility:** HIGH value, MEDIUM confidence (pending format check).

### B2. Transit ridership (FTA National Transit Database) — `transit_trips_per_capita`
- **Source:** FTA **NTD** monthly/annual data files (machine-readable Excel/CSV).
- **County-key:** reported per **transit agency** → needs an agency→county mapping
  (agencies serve urbanized areas; a lookup table or HQ-county heuristic). Non-trivial.
- **Signal:** transit mode-share vs crash exposure (more transit ↔ fewer VMT/crashes?).
- **Feasibility:** MEDIUM. Machine-readable, but the agency→county join is the work.

---

## Tier X — Do NOT pursue for the county matrix (fails a hard requirement)

- **NHTSA recalls** (`api.nhtsa.gov/recalls`) — by manufacturer/vehicle, **not geographic**.
  No county dimension → can't enter a county-keyed matrix. (Could feed a *different* feature.)
- **Gas prices** (EIA) — published at **state** (CA) level, not county → zero county variation
  to correlate. Skip.
- **Road construction / work zones** (Caltrans LCS) — transient, fragmented, no stable
  annual per-county metric. Skip (matches the earlier "fragmented" assessment).
- **DUI arrests** — already investigated + parked: no machine-readable per-county source
  (OpenJustice buckets DUI; DMV DUI-MIS is dashboards/PDF). See the DUI investigation.

---

## Recommended order
1. **B1 county VMT** *if* a CSV/XLSX/GIS table verifies — biggest analytical upgrade
   (exposure-normalized rates). Spend 15 min confirming format first.
2. **A1 EV chargers** — cleanest build, no format risk; good if you want a quick win.
3. **B2 transit** — only if the agency→county mapping is worth it.

## Cross-cutting caveats (apply to any new field)
- **Validate parsing against ONE real file even under "no live load"** (the FARS REST_USE
  bug — `pct_unrestrained` was silently 0% — slipped because nothing exercised real data).
- **Small-county instability:** 5 of 58 counties are tiny; rates swing wildly. Consider a
  min-denominator guard or noting it in methodology.
- **Don't over-claim causation** — the matrix is correlational; keep insight copy honest.
