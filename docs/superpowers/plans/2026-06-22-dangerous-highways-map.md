# Dangerous Highways Map Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw California highways as lines on the Map page, colored by crash danger, clickable for that highway's stats.

**Architecture:** Static `ca-highways.geojson` (one simplified line per canonical route, built by ETL from Caltrans SHN) supplies geometry; the existing `/api/stats/highways` supplies per-route danger. A new `HighwayDangerLayer` Leaflet component (mirroring `CountyBoundaries`) joins them by `route_number` and colors each line via the existing choropleth binning/palette utilities. v1 colors whole routes; the rendering consumes generic "danger features" so a future per-segment phase swaps only the data source.

**Tech Stack:** React 19, react-leaflet 5 / Leaflet, @tanstack/react-query, vitest, Playwright (frontend); Python, shapely, requests (ETL).

## Global Constraints

- The Highway-danger layer is OFF by default (no-default-filters/no-default-layers convention; `DEFAULT_YEARS`/`DEFAULT_SEVERITIES` stay empty).
- No new backend endpoint in v1 — reuse `/api/stats/highways`.
- No PostGIS in v1 (crashes use plain lat/lng; per-segment phase B adds PostGIS later).
- Frontend API base: `import { API_BASE } from "../config"` → `${API_BASE}/api/...`.
- Canonical route IDs come from `backend/app/ca_highways.py` (`I-5`, `US-101`, `SR-99`). Geometry must key on those exact IDs.
- Reuse existing utilities: `lib/choropleth/binning` (`quantileBuckets`, `bucketFor`), `lib/choropleth/palettes` (`getPalette`), and the `useHighwayRankings` hook (returns `HighwayRow[]`).
- Spec lives at `docs/superpowers/specs/2026-06-22-dangerous-highways-map-design.md` (untracked). Plans/specs are NOT committed to the repo.

---

## Prerequisite (operational, not a code task): backfill `route_number`

`crashes.route_number` is NULL on all prod rows, so `/api/stats/highways` returns empty. Before the layer shows anything:

- [ ] Run `backend/etl/extract_route_number.py` against prod (via the ETL pipeline or a one-off `[backfill]`-tagged run), then confirm `curl "$API/api/stats/highways?limit=5"` returns non-empty rows. This also lights up the existing Stats-page highway table. (Coordinate with Jeff — this is a prod ETL run over ~11M rows.)

---

## Task 1: ETL — build `ca-highways.geojson` from Caltrans SHN

**Files:**
- Create: `backend/etl/build_highway_geometry.py`
- Create: `backend/tests/test_build_highway_geometry.py`
- Output (generated artifact, untracked unless decided otherwise): `frontend/public/ca-highways.geojson`

**Interfaces:**
- Consumes: `app.ca_highways.CA_HIGHWAYS` (dict[int, Highway]), `app.ca_highways.resolve_route(number) -> Highway | None`.
- Produces:
  - `route_id_from_caltrans(route_field: str) -> str | None` — maps a Caltrans SHN `Route` value (e.g. `"5"`, `"101"`, `"SR99"`) to a canonical ID (`"I-5"`) via `resolve_route`, or `None` if unknown.
  - `build_geojson(features: list[dict], simplify_tolerance: float = 0.001) -> dict` — groups input LineString features by canonical route id, unions per route, simplifies, returns a FeatureCollection `{type, features:[{type:"Feature", properties:{route_number}, geometry:MultiLineString}]}`.

**Source:** Caltrans State Highway Network lines (Caltrans GIS open data, "State Highway Network" layer; has a numeric `Route` attribute). Download the GeoJSON once and pass its `features` to `build_geojson`. Document the source URL in the module docstring; vendor the raw download under `backend/data/shn_raw.geojson` (gitignored) so re-runs are reproducible.

- [ ] **Step 1: Write the failing test for route mapping**
```python
# backend/tests/test_build_highway_geometry.py
from etl.build_highway_geometry import route_id_from_caltrans

def test_route_id_maps_known_interstate():
    assert route_id_from_caltrans("5") == "I-5"

def test_route_id_maps_known_us_route():
    assert route_id_from_caltrans("101") == "US-101"

def test_route_id_unknown_returns_none():
    assert route_id_from_caltrans("9999") is None
```

- [ ] **Step 2: Run test, verify it fails**
Run: `cd backend && ./.venv/Scripts/python.exe -m pytest tests/test_build_highway_geometry.py -v`
Expected: FAIL (`ModuleNotFoundError: etl.build_highway_geometry`).

- [ ] **Step 3: Implement `route_id_from_caltrans`**
```python
# backend/etl/build_highway_geometry.py
"""Build frontend/public/ca-highways.geojson from the Caltrans State Highway
Network (SHN) line layer. One simplified MultiLineString per canonical route.

Source: Caltrans GIS open data — "State Highway Network" (lines). The layer's
`Route` attribute is the bare route number; we resolve it to the canonical ID
(I-5 / US-101 / SR-99) via app.ca_highways and only keep routes we know.
"""
import json
import re
from pathlib import Path

from shapely.geometry import shape, mapping
from shapely.ops import unary_union

from app.ca_highways import resolve_route

_DIGITS = re.compile(r"(\d+)")


def route_id_from_caltrans(route_field: str) -> str | None:
    m = _DIGITS.search(str(route_field))
    if not m:
        return None
    hw = resolve_route(int(m.group(1)))
    return hw.canonical_id if hw else None
```

- [ ] **Step 4: Run test, verify it passes**
Run: `cd backend && ./.venv/Scripts/python.exe -m pytest tests/test_build_highway_geometry.py -v`
Expected: PASS.

- [ ] **Step 5: Write the failing test for `build_geojson`**
```python
from etl.build_highway_geometry import build_geojson

def _line(coords):
    return {"type": "Feature", "properties": {"Route": "5"},
            "geometry": {"type": "LineString", "coordinates": coords}}

def test_build_geojson_groups_by_route():
    fc = build_geojson([_line([[0,0],[1,1]]), _line([[1,1],[2,2]])])
    assert fc["type"] == "FeatureCollection"
    assert len(fc["features"]) == 1
    f = fc["features"][0]
    assert f["properties"]["route_number"] == "I-5"
    assert f["geometry"]["type"] in ("MultiLineString", "LineString")

def test_build_geojson_drops_unknown_routes():
    bad = {"type":"Feature","properties":{"Route":"9999"},
           "geometry":{"type":"LineString","coordinates":[[0,0],[1,1]]}}
    assert build_geojson([bad])["features"] == []
```

- [ ] **Step 6: Run test, verify it fails**
Run: `cd backend && ./.venv/Scripts/python.exe -m pytest tests/test_build_highway_geometry.py -v`
Expected: FAIL (`build_geojson` not defined).

- [ ] **Step 7: Implement `build_geojson` + CLI**
```python
def build_geojson(features: list[dict], simplify_tolerance: float = 0.001) -> dict:
    by_route: dict[str, list] = {}
    for feat in features:
        rid = route_id_from_caltrans(feat.get("properties", {}).get("Route", ""))
        if rid is None:
            continue
        by_route.setdefault(rid, []).append(shape(feat["geometry"]))

    out = []
    for rid in sorted(by_route):
        merged = unary_union(by_route[rid]).simplify(simplify_tolerance, preserve_topology=True)
        out.append({
            "type": "Feature",
            "properties": {"route_number": rid},
            "geometry": mapping(merged),
        })
    return {"type": "FeatureCollection", "features": out}


def main() -> None:
    raw = json.loads(Path("backend/data/shn_raw.geojson").read_text())
    fc = build_geojson(raw["features"])
    out = Path("frontend/public/ca-highways.geojson")
    out.write_text(json.dumps(fc))
    print(f"wrote {len(fc['features'])} routes -> {out}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 8: Run tests, verify they pass**
Run: `cd backend && ./.venv/Scripts/python.exe -m pytest tests/test_build_highway_geometry.py -v`
Expected: PASS (all 5).

- [ ] **Step 9: Generate the artifact + sanity-check size**
Run: download SHN to `backend/data/shn_raw.geojson`, then `cd backend && ./.venv/Scripts/python.exe -m etl.build_highway_geometry`. Confirm `frontend/public/ca-highways.geojson` exists, has ~150–250 features, and is < ~1 MB (raise `simplify_tolerance` if larger).

- [ ] **Step 10: Commit**
```bash
git add backend/etl/build_highway_geometry.py backend/tests/test_build_highway_geometry.py frontend/public/ca-highways.geojson
git commit -m "feat(highways): ETL to build ca-highways.geojson from Caltrans SHN"
```

---

## Task 2: Frontend — load highway geometry (`useHighwayGeoJson`)

**Files:**
- Create: `frontend/src/hooks/useHighwayGeoJson.ts`
- Create: `frontend/src/hooks/useHighwayGeoJson.test.tsx`

**Interfaces:**
- Produces: `useHighwayGeoJson() -> { data: GeoJSON.FeatureCollection | undefined, isLoading, error }` — fetches `/ca-highways.geojson` once, cached forever (geometry is static). Mirror the existing `useCountyGeoJson` hook.

- [ ] **Step 1: Write the failing test**
```tsx
// frontend/src/hooks/useHighwayGeoJson.test.tsx
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useHighwayGeoJson } from "./useHighwayGeoJson";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

it("loads the highway geojson", async () => {
  const fc = { type: "FeatureCollection", features: [] };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => fc }));
  const { result } = renderHook(() => useHighwayGeoJson(), { wrapper });
  await waitFor(() => expect(result.current.data).toEqual(fc));
});
```

- [ ] **Step 2: Run test, verify it fails**
Run: `cd frontend && npx vitest run src/hooks/useHighwayGeoJson.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement (mirror `useCountyGeoJson`)**
```ts
// frontend/src/hooks/useHighwayGeoJson.ts
import { useQuery } from "@tanstack/react-query";

export function useHighwayGeoJson() {
  return useQuery<GeoJSON.FeatureCollection>({
    queryKey: ["highway-geojson"],
    queryFn: async () => {
      const res = await fetch(`${import.meta.env.BASE_URL}ca-highways.geojson`);
      if (!res.ok) throw new Error(`highway geojson ${res.status}`);
      return res.json();
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
```

- [ ] **Step 4: Run test, verify it passes**
Run: `cd frontend && npx vitest run src/hooks/useHighwayGeoJson.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/hooks/useHighwayGeoJson.ts frontend/src/hooks/useHighwayGeoJson.test.tsx
git commit -m "feat(highways): useHighwayGeoJson hook for static geometry"
```

---

## Task 3: Frontend — join geometry + danger into colored features

**Files:**
- Create: `frontend/src/lib/map/highwayDanger.ts`
- Create: `frontend/src/lib/map/highwayDanger.test.ts`

**Interfaces:**
- Consumes: `HighwayRow` (from `hooks/useHighwayRankings`); `HighwaySort` as the metric key; `quantileBuckets`, `bucketFor` from `lib/choropleth/binning`; `getPalette` from `lib/choropleth/palettes`.
- Produces:
  - `type DangerFeature = { route_number: string; geometry: GeoJSON.Geometry; value: number | null; color: string; row: HighwayRow | null }`
  - `buildDangerFeatures(geo: GeoJSON.FeatureCollection, rows: HighwayRow[], metric: HighwaySort, palette: string, noDataColor: string) -> DangerFeature[]` — left-joins geometry to danger rows by `route_number`; `value` = `row[metric]` (null when route absent or metric is `crashes_per_mile` with null miles); `color` from the palette bucket, or `noDataColor` when `value` is null.

- [ ] **Step 1: Write the failing test**
```ts
// frontend/src/lib/map/highwayDanger.test.ts
import { buildDangerFeatures } from "./highwayDanger";

const geo = { type: "FeatureCollection", features: [
  { type: "Feature", properties: { route_number: "I-5" }, geometry: { type: "LineString", coordinates: [[0,0],[1,1]] } },
  { type: "Feature", properties: { route_number: "SR-99" }, geometry: { type: "LineString", coordinates: [[2,2],[3,3]] } },
]} as GeoJSON.FeatureCollection;
const rows = [
  { route_number: "I-5", crash_count: 100, total_killed: 5, total_injured: 50, fatality_rate: 0.05, miles: 796, crashes_per_mile: 0.13 },
];

it("joins danger to geometry and grays no-data routes", () => {
  const out = buildDangerFeatures(geo, rows, "crash_count", "reds", "#cccccc");
  const i5 = out.find(f => f.route_number === "I-5")!;
  const sr99 = out.find(f => f.route_number === "SR-99")!;
  expect(i5.value).toBe(100);
  expect(i5.color).not.toBe("#cccccc");
  expect(sr99.value).toBeNull();
  expect(sr99.color).toBe("#cccccc");
});
```

- [ ] **Step 2: Run test, verify it fails**
Run: `cd frontend && npx vitest run src/lib/map/highwayDanger.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement (read `lib/choropleth/binning` + `palettes` for exact signatures first, then mirror `CountyBoundaries` coloring)**
```ts
// frontend/src/lib/map/highwayDanger.ts
import type { HighwayRow, HighwaySort } from "../../hooks/useHighwayRankings";
import { quantileBuckets, bucketFor } from "../choropleth/binning";
import { getPalette } from "../choropleth/palettes";

export interface DangerFeature {
  route_number: string;
  geometry: GeoJSON.Geometry;
  value: number | null;
  color: string;
  row: HighwayRow | null;
}

export function buildDangerFeatures(
  geo: GeoJSON.FeatureCollection,
  rows: HighwayRow[],
  metric: HighwaySort,
  palette: string,
  noDataColor: string,
): DangerFeature[] {
  const byRoute = new Map(rows.map((r) => [r.route_number, r]));
  const values = rows
    .map((r) => r[metric])
    .filter((v): v is number => v != null);
  const edges = quantileBuckets(values);          // confirm arity vs binning.ts
  const colors = getPalette(palette, edges.length); // confirm arity vs palettes.ts

  return geo.features.map((f) => {
    const id = String(f.properties?.route_number ?? "");
    const row = byRoute.get(id) ?? null;
    const value = row ? (row[metric] as number | null) : null;
    const color = value == null ? noDataColor : colors[bucketFor(value, edges)];
    return { route_number: id, geometry: f.geometry as GeoJSON.Geometry, value, color, row };
  });
}
```
NOTE for implementer: open `frontend/src/lib/choropleth/binning.ts` and `palettes.ts` and adjust the `quantileBuckets`/`bucketFor`/`getPalette` calls to their real signatures (used the same way in `CountyBoundaries.tsx`). Match that usage exactly.

- [ ] **Step 4: Run test, verify it passes**
Run: `cd frontend && npx vitest run src/lib/map/highwayDanger.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/lib/map/highwayDanger.ts frontend/src/lib/map/highwayDanger.test.ts
git commit -m "feat(highways): join geometry + danger into colored features"
```

---

## Task 4: Frontend — `HighwayDangerLayer` Leaflet component

**Files:**
- Create: `frontend/src/components/map/HighwayDangerLayer.tsx`
- Create: `frontend/src/components/map/HighwayDangerLayer.test.tsx`

**Interfaces:**
- Consumes: `useHighwayGeoJson` (Task 2), `useHighwayRankings` (existing), `buildDangerFeatures` (Task 3), `useLayersState` (for `palette` + the new `highwayDanger` toggle + a `highwayMetric`), `useFilterParams` (to build `StatsFilters` exactly as `CountyBoundaries` does).
- Props: `{ onSelectHighway: (row: HighwayRow) => void }`.
- Behavior: when the layer is off, render nothing. When on, draw each `DangerFeature` as an `L.geoJSON` polyline styled `{ color, weight: 4, opacity: 0.85 }`; on click, call `onSelectHighway(row)`. Mirror `CountyBoundaries.tsx` for the `useMap()` + `useEffect` add/remove + cleanup pattern.

- [ ] **Step 1: Write the failing test** (jsdom; mock react-leaflet `useMap` to a fake map and assert a layer is added when toggled on). Model it on `CountyBoundaries.test.tsx`.
```tsx
// frontend/src/components/map/HighwayDangerLayer.test.tsx
import { render } from "@testing-library/react";
import HighwayDangerLayer from "./HighwayDangerLayer";
// See CountyBoundaries.test.tsx for the react-leaflet/useMap + provider mocks to copy.
it("renders nothing when the layer is off", () => {
  // arrange: useLayersState mock with highwayDanger=false
  const { container } = render(<HighwayDangerLayer onSelectHighway={() => {}} />);
  expect(container).toBeTruthy();
});
```

- [ ] **Step 2: Run test, verify it fails**
Run: `cd frontend && npx vitest run src/components/map/HighwayDangerLayer.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — copy the structure of `CountyBoundaries.tsx` (the `memo`, `useMap`, build `filters` from `useFilterParams`, `useEffect` that creates an `L.geoJSON` layer and `map.addLayer`/`removeLayer` with cleanup). Differences: data = `buildDangerFeatures(geo, rows, metric, palette, NO_DATA)`; style each feature `{ color: f.color, weight: 4, opacity: 0.85 }`; `onEachFeature` binds a click → `onSelectHighway(f.row)`. Gate the whole effect on `otherLayers.highwayDanger`.

- [ ] **Step 4: Run test, verify it passes**
Run: `cd frontend && npx vitest run src/components/map/HighwayDangerLayer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/components/map/HighwayDangerLayer.tsx frontend/src/components/map/HighwayDangerLayer.test.tsx
git commit -m "feat(highways): HighwayDangerLayer leaflet component"
```

---

## Task 5: Layer state + LayersPanel toggle + metric selector + legend

**Files:**
- Modify: `frontend/src/hooks/useLayersState.tsx` (add `highwayDanger` to `otherLayers`; add `highwayMetric: HighwaySort` with setter, default `"fatality_rate"`)
- Modify: `frontend/src/hooks/useLayersState.test.tsx` (cover the new state)
- Modify: `frontend/src/components/map/LayersPanel.tsx` (add the "Highway danger" toggle + metric selector)
- Modify: `frontend/src/components/map/ChoroplethLegend.tsx` (or add a sibling legend) to show the line color scale when the layer is on

**Interfaces:**
- Produces (from `useLayersState`): `otherLayers.highwayDanger: boolean`, `setOtherLayer("highwayDanger", boolean)`, `highwayMetric: HighwaySort`, `setHighwayMetric(m: HighwaySort)`. Default OFF, default metric `"fatality_rate"`.

- [ ] **Step 1: Write failing test** for the new state (extend `useLayersState.test.tsx`): toggling `highwayDanger` and setting `highwayMetric` round-trips; default is off / `fatality_rate`.
- [ ] **Step 2: Run, verify fail.** Run: `cd frontend && npx vitest run src/hooks/useLayersState.test.tsx` — FAIL.
- [ ] **Step 3: Implement** the state additions in `useLayersState.tsx` (follow the existing `otherLayers` + `setOtherLayer` pattern already used for `heatmapCounty`/`heatmapStatewide`).
- [ ] **Step 4: Run, verify pass.** Same command — PASS.
- [ ] **Step 5: Wire the UI** — add the toggle + metric `<select>` (crash_count / fatality_rate / crashes_per_mile) to `LayersPanel.tsx`, and render the line-color legend when `highwayDanger` is on (reuse `ChoroplethLegend` bucket rendering). Mount `<HighwayDangerLayer onSelectHighway={...}/>` inside the map in `MapPage.tsx`.
- [ ] **Step 6: Run the full unit suite.** Run: `cd frontend && npm run test` — all green.
- [ ] **Step 7: Commit**
```bash
git add frontend/src/hooks/useLayersState.tsx frontend/src/hooks/useLayersState.test.tsx frontend/src/components/map/LayersPanel.tsx frontend/src/components/map/ChoroplethLegend.tsx frontend/src/pages/MapPage.tsx
git commit -m "feat(highways): layer toggle, metric selector, legend, map wiring"
```

---

## Task 6: Click → SidePanel highway stats

**Files:**
- Create: `frontend/src/components/map/HighwaySidePanelContent.tsx`
- Create: `frontend/src/components/map/HighwaySidePanelContent.test.tsx`
- Modify: `frontend/src/pages/MapPage.tsx` (open the side panel with the selected highway; pass `onSelectHighway` to the layer)

**Interfaces:**
- Consumes: `HighwayRow`.
- Produces: `HighwaySidePanelContent({ row }: { row: HighwayRow }) -> JSX` — renders route_number, crash_count, total_killed, total_injured, fatality_rate (as %), crashes_per_mile (or "—" when null).

- [ ] **Step 1: Write failing test** — render `HighwaySidePanelContent` with a row, assert the route id and the formatted stats appear; a null `crashes_per_mile` shows "—".
- [ ] **Step 2: Run, verify fail.** Run: `cd frontend && npx vitest run src/components/map/HighwaySidePanelContent.test.tsx` — FAIL.
- [ ] **Step 3: Implement** the presentational component (formatting only).
- [ ] **Step 4: Run, verify pass.** Same command — PASS.
- [ ] **Step 5: Wire** `MapPage.tsx`: `onSelectHighway={(row) => { setActivePanel("highway"); setSelectedHighway(row); }}`, render `HighwaySidePanelContent` in the existing `SidePanel` when `activePanel === "highway"`.
- [ ] **Step 6: Run the full unit suite + build.** Run: `cd frontend && npm run test && npm run build` — green.
- [ ] **Step 7: Commit**
```bash
git add frontend/src/components/map/HighwaySidePanelContent.tsx frontend/src/components/map/HighwaySidePanelContent.test.tsx frontend/src/pages/MapPage.tsx
git commit -m "feat(highways): side panel stats on highway click"
```

---

## Task 7: E2E (Playwright)

**Files:**
- Create: `frontend/tests/highway-danger.spec.ts`

**Interfaces:** none (drives the running app; needs the local stack: seeded backend on :8000 with `route_number` populated, vite on :5174 — see the session's stack-up steps).

- [ ] **Step 1: Write the spec**
```ts
// frontend/tests/highway-danger.spec.ts
import { test, expect } from "@playwright/test";
const BASE_URL = "http://localhost:5174";

test("toggle highway-danger layer draws lines and click opens stats", async ({ page }) => {
  await page.goto(`${BASE_URL}/map`);
  await page.getByRole("button", { name: /layers/i }).click();
  await page.getByLabel(/highway danger/i).check();
  // a highway polyline appears (leaflet renders <path> in the overlay pane)
  const line = page.locator(".leaflet-overlay-pane path").first();
  await expect(line).toBeVisible({ timeout: 15000 });
  await line.click({ force: true });
  await expect(page.getByText(/fatality rate/i)).toBeVisible();
});
```

- [ ] **Step 2: Run it** against the local stack.
Run: `cd frontend && npx playwright test highway-danger.spec.ts`
Expected: PASS (seed must include crashes with `route_number` set — the conftest seed already does).

- [ ] **Step 3: Commit**
```bash
git add frontend/tests/highway-danger.spec.ts
git commit -m "test(highways): e2e for highway-danger layer + click panel"
```

---

## Self-Review

- **Spec coverage:** Step 0 backfill ✓ (prereq); Caltrans SHN → static geojson ✓ (T1); reuse `/api/stats/highways` ✓ (T3/T4); B-ready danger-feature contract ✓ (T3 `DangerFeature`); layer off by default + metric selector + legend ✓ (T5); click → side panel ✓ (T6); error handling — no-data gray ✓ (T3), geojson load failure surfaced by the query `error` ✓ (T2, handle in T4/T5 UI); tests at ETL/unit/e2e ✓ (T1/T3/T7).
- **Placeholder scan:** Tasks 4–6 intentionally say "mirror `CountyBoundaries`/existing pattern" with the exact file to copy rather than reproducing large Leaflet/context boilerplate I can't reproduce verbatim without the live files — the implementer copies the real pattern. The pure-logic tasks (T1, T3) have complete code. Acceptable per "follow established patterns."
- **Type consistency:** `HighwayRow`/`HighwaySort` reused verbatim from `useHighwayRankings`; `DangerFeature` defined in T3 and consumed in T4; `otherLayers.highwayDanger` + `highwayMetric` defined in T5 and consumed in T4. Consistent.
- **Gap to confirm during impl:** exact signatures of `quantileBuckets`/`bucketFor`/`getPalette` (T3) and `useCountyGeoJson` (T2 mirror) — flagged inline to verify against the live files.
