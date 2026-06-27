# Dangerous Highways Map Layer — Design

**Date:** 2026-06-22
**Status:** Approved (design), pending implementation plan
**Author:** Jeff (with Claude)

## Summary

A connected "Roads & Highways" experience on the **Map page**: California highways
drawn as **lines colored by crash danger**, clickable to inspect that highway's
stats in the existing side panel. Backed by a new Caltrans centerline geometry
source. Built in phases — **v1 colors each whole highway one color** (fast, no
PostGIS); a future **v2 colors per-segment** ("deadly stretches" gradient) without
changing the frontend.

This reuses the highway crash-burden aggregation already shipped in #313
(`/api/stats/highways`) and the `route_number` column on `crashes`.

## Goals

- Show *which roads are more dangerous* spatially — highways colored red/yellow by
  crash danger, on the existing Leaflet map.
- Surface highway/road data that is currently computed but not visualized.
- Respect the existing map filters so danger reflects the active query
  (e.g. "fatal crashes, 2023").
- Architect so per-segment danger (v2) is an additive change, not a rewrite.

## Non-Goals (v1)

- Per-segment / "deadly stretches" gradient coloring (deferred to v2 — needs PostGIS).
- County-level road-infra analysis (AADT, speed limits, road-miles) — separate future work.
- Local-street / non-state-highway roads (only the Caltrans State Highway Network).
- Changing the already-shipped Stats-page highway table (it keeps working off the same data).

## Prerequisite (Step 0): backfill `route_number`

The `route_number` column on `crashes` is NULL on all ~11M prod rows. The danger
data for both the existing Stats table and this new map layer comes from
`/api/stats/highways`, which aggregates on `route_number`. So before anything is
visible:

- Run the existing `backend/etl/extract_route_number.py` over the crashes table to
  populate `route_number` (canonical IDs like `I-5`, `US-101`, `SR-99`).
- This is the same extractor #313 shipped; it is text-based (parses `primary_road`),
  not spatial.
- Trigger it via the ETL pipeline or a one-off run; confirm `/api/stats/highways`
  returns non-empty before building the layer.

## Architecture

### Data flow (v1)

```
Caltrans SHN GeoJSON  --ETL-->  frontend/public/ca-highways.geojson
                                 (one simplified line per canonical highway)
                                          |
crashes.route_number  --/api/stats/highways-->  per-route danger metrics
                                          |
                          Map page joins geometry + danger by route_number
                                          |
                          Leaflet GeoJSON layer, lines colored by danger
                                          |
                          click line --> SidePanel shows highway stats
```

### Components / units

**1. ETL: SHN geometry → static GeoJSON** (`backend/etl/build_highway_geometry.py`, new)
- Input: Caltrans State Highway Network centerlines (download or vendored raw file).
- Group/dissolve segments by route number; map each to the canonical ID using the
  existing `app.ca_highways` table.
- Simplify geometry (Douglas-Peucker, shapely) to keep payload web-friendly.
- Output: `frontend/public/ca-highways.geojson` — a FeatureCollection, one Feature
  per highway: `{ properties: { route_number: "I-5" }, geometry: MultiLineString }`.
- One purpose: produce the static geometry artifact. Re-runnable; geometry changes
  rarely.

**2. Backend danger data** (existing `/api/stats/highways`, no change for v1)
- Already returns `route_number, crash_count, total_killed, total_injured,
  fatality_rate, miles, crashes_per_mile`, respecting all map filters.
- v1 adds no backend endpoint.

**3. Frontend: highway-danger map layer** (`frontend/src/components/map/HighwayDangerLayer.tsx`, new)
- Loads `ca-highways.geojson` once (cached).
- Calls `/api/stats/highways` with the active filters (new hook
  `useHighwayDanger` or reuse `useHighwayRankings`).
- Joins geometry + danger by `route_number` into "danger features."
- Renders a Leaflet GeoJSON layer; line color = scale over the selected metric.

**4. The B-ready contract (the key architectural decision)**
- The layer renders **danger features**: each is a GeoJSON feature with a geometry
  and a numeric `danger` value (+ tooltip stats).
- **v1** produces one feature per highway (whole-route color).
- **v2** produces many segment features per highway (gradient) from a future
  PostGIS-backed `/api/stats/highway-segments` GeoJSON endpoint.
- The rendering component is identical for both; only the feature source swaps. This
  is what lets v2 ship without a frontend rewrite.

**5. Layer controls + legend** (extend existing `LayersPanel`, `ChoroplethLegend`)
- New "Highway danger" toggle, **off by default** (no-default-filters convention).
- Metric selector: `crash_count` (busiest) / `fatality_rate` (deadliest) /
  `crashes_per_mile` (most concentrated).
- Legend reuses the choropleth color-scale pattern for line colors.

**6. Click-to-inspect** (reuse existing `SidePanel`)
- Clicking a highway line opens the side panel with that highway's stats:
  crash count, killed/injured, fatality rate, crashes/mile, and (if cheap) top causes.
- Reuses the `/api/stats/highways` row already loaded for that route.

## Data details

- **Coloring metric default:** `fatality_rate` (matches "which roads are more
  *dangerous*"). User can switch to crash_count or crashes_per_mile.
- **Filters:** the layer's `/api/stats/highways` call passes the current map filter
  state, so colors update with the active query.
- **Geometry size:** ~250 routes; simplified MultiLineStrings. Target a payload small
  enough to load like `ca-counties.geojson` (a few hundred KB); tune simplification
  tolerance to hit that.

## Error handling

- Route in geometry but **not** in danger response (no crashes in filter) → drawn in a
  neutral/grey "no data" color.
- Route in danger response but **no geometry match** → not drawn; log once for ETL
  follow-up (extend `ca_highways` / geometry source).
- Route with crashes but **no miles** → still colored by crash_count / fatality_rate;
  excluded only when the metric is crashes_per_mile.
- `ca-highways.geojson` fails to load → layer toggle shows an error state; the rest of
  the map keeps working (follow the existing tile-error-banner pattern).

## Testing

- **ETL** (`tests/test_build_highway_geometry.py`): route→canonical-ID matching,
  dissolve correctness, simplification produces valid geometry, output schema.
- **Frontend** (vitest): geometry+danger join by route_number; color-scale buckets;
  "no data" handling for routes absent from the danger response.
- **E2E** (Playwright): toggle the Highway-danger layer → lines render; switch metric →
  colors change; click a line → side panel opens with that highway's stats.

## Rollout / phasing

- **v1 (this spec):** Step 0 backfill + ETL geometry artifact + map layer (whole-route
  color) + metric selector + legend + click panel + tests.
- **v2 (future, separate spec):** add PostGIS; segment the SHN geometry; spatial-join
  the ~11M crashes to nearest segment; new `/api/stats/highway-segments` GeoJSON
  endpoint emitting per-segment danger features. Frontend rendering unchanged.

## Open items to resolve during planning

- Source/licensing of the Caltrans SHN geometry file and where the raw input lives
  (vendored in repo vs downloaded in ETL).
- Whether the Stats-page highway table and the map layer should share one "metric"
  selection (nice-to-have, not required for v1).
