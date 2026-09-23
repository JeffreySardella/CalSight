import type { HeatmapResolution } from "../../hooks/useLayersState";

/**
 * Level-of-detail rules for the crash heat layer: which grid resolution to ask
 * for at a given zoom, how far the user is allowed to zoom, and how many
 * points we are willing to reproject on a pan.
 */

/**
 * Highest zoom at which each resolution still reads as a heat field rather
 * than a lattice of grid cells. Past it we request the *next finer*
 * resolution instead of refusing to zoom (which is what the old
 * HEATMAP_MAX_ZOOM clamp in MapCanvas did — a phone opening a zoom-7 link got
 * two pinch steps and then a dead gesture).
 *
 * Steps come from backend/app/routers/heatmap.py: low 0.1deg (~7mi),
 * medium 0.01deg (~0.7mi, 0.03deg/~2mi when unscoped), high 0.001deg (~350ft),
 * raw individual crashes.
 */
export const RESOLUTION_MAX_ZOOM: Record<HeatmapResolution, number> = {
  low: 8,
  medium: 9,
  high: 10,
  raw: 18,
};

/**
 * Zoom at which individual crash dots take over from the heat field.
 *
 * Was 14, which left zoom 13 as a wash of grid-aggregated heat with nothing to
 * tap. Measured against the live API (2026-09-22, a phone-sized 375x650 view
 * plus the half-screen pad, `limit=2000`): dense downtown Fresno returns 2,000
 * rows at both zoom 13 and zoom 14 (39,073 vs 16,800 crashes in the rectangle),
 * ~51 KB gzipped / ~0.59 MB of JSON either way, 875 vs 794 of them on screen;
 * downtown Los Angeles is the same shape (2,000 rows, ~53 KB). The row cap
 * makes a zoom-13 request cost what a zoom-14 one already does, and
 * CrashDotLayer draws at most 800, so the phone pays nothing extra — the
 * zoom-13 dots are just a thinner sample, which the faded heat underneath
 * (heatOpacityForZoom) still carries the density for.
 */
export const DOT_MIN_ZOOM = 13;

/**
 * Opacity of the heat canvas at `zoom`: full while it is the only picture,
 * eased back one zoom before the dots arrive and held low under them, so the
 * basemap and the dots read through it instead of a saturated wash.
 */
export function heatOpacityForZoom(zoom: number): number {
  if (zoom < DOT_MIN_ZOOM - 1) return 1;
  if (zoom < DOT_MIN_ZOOM) return 0.7;
  return 0.4;
}

/**
 * Full-detail crash points fetched per dot request at DOT_MIN_ZOOM+. The API's
 * ceiling: the request covers four times the screen (see nextDotFetch), so this
 * keeps roughly the old 800-dot density inside the part that is visible.
 */
export const DOT_LIMIT = 2000;

/** [west, south, east, north] */
export type Bbox = [number, number, number, number];

/** A dot request: the rectangle asked for, and the zoom it was sized for. */
export interface DotFetch {
  bbox: Bbox;
  zoom: number;
}

/** Fraction of the view added on every side of a dot request. */
const DOT_BBOX_PAD = 0.5;

/**
 * The dot request that serves this camera — `fetched` itself (same object)
 * while it still does, so the query key and the dots on screen do not change.
 *
 * Fetching exactly the visible rectangle meant every pan, however small,
 * replaced the dots. Tapping a dot on a phone pans the map to centre its
 * popup, so the tap itself refetched, unmounted the marker and took the popup
 * with it: dots could not be opened at all. A padded rectangle survives that
 * pan and ordinary nudging; a zoom change still refetches because the API caps
 * the count, and the sample for a wider view is too thin for a closer one.
 *
 * Pure on purpose: it is used as a React state updater, which StrictMode runs
 * twice. Tracking the zoom in a ref beside the state made the second run keep
 * a stale rectangle.
 */
export function nextDotFetch(fetched: DotFetch | null, view: Bbox, zoom: number): DotFetch {
  const [w, s, e, n] = view;
  if (fetched && fetched.zoom === zoom) {
    const [fw, fs, fe, fn] = fetched.bbox;
    if (fw <= w && fs <= s && fe >= e && fn >= n) return fetched;
  }
  const dx = (e - w) * DOT_BBOX_PAD;
  const dy = (n - s) * DOT_BBOX_PAD;
  // 4 decimals is about 11 m: shorter URLs, and no float noise in the cache key.
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  return { bbox: [r(w - dx), r(s - dy), r(e + dx), r(n + dy)], zoom };
}

// `raw` and `high` are rejected by the API without a county filter (the
// statewide query would group the whole crashes table on an unindexed
// expression), so an unscoped selection tops out at `medium`.
const SCOPED_LADDER: readonly HeatmapResolution[] = ["low", "medium", "high", "raw"];
const UNSCOPED_LADDER: readonly HeatmapResolution[] = ["low", "medium"];

export function resolutionLadder(scoped: boolean): readonly HeatmapResolution[] {
  return scoped ? SCOPED_LADDER : UNSCOPED_LADDER;
}

/** Ceiling for map.setMaxZoom while a heat layer is on. */
export function heatmapMaxZoom(scoped: boolean): number {
  const ladder = resolutionLadder(scoped);
  return RESOLUTION_MAX_ZOOM[ladder[ladder.length - 1]];
}

/**
 * The resolution to request at `zoom`, never coarser than what the user picked
 * in the Layers panel. A resolution the current scope can't serve (`high` or
 * `raw` with no county filter) starts the ladder from the top rather than
 * pinning it to the finest rung — the zoom is what pulls it finer.
 */
export function resolutionForZoom(
  requested: HeatmapResolution,
  zoom: number,
  scoped: boolean,
): HeatmapResolution {
  const ladder = resolutionLadder(scoped);
  let i = ladder.indexOf(requested);
  if (i === -1) i = 0;
  while (i < ladder.length - 1 && zoom > RESOLUTION_MAX_ZOOM[ladder[i]]) i++;
  return ladder[i];
}

/**
 * How many heat points we ask the API for before it aggregates them onto a
 * grid server-side (`max_points`).
 *
 * leaflet.heat binds `moveend` to `_reset`, which reprojects *every* point
 * through `latLngToContainerPoint` — so this number is the per-pan CPU cost.
 * Measured against a faithful replay of that loop (Mercator project + affine
 * transform + round + origin subtract + the plugin's bounds test and grid
 * bin): 0.052 us/point, median of 9 runs, 107,075 points in 5.5 ms on the dev
 * box. A mid-range phone runs scalar JS roughly 6x slower than that, so
 * ~0.31 us/point; giving the reprojection half of a 16.7 ms frame (simpleheat's
 * draw() — per-cell drawImage plus a full-canvas getImageData/colorize — owns
 * the other half) lands at ~27k. Desktop assumes a 2x rather than 6x factor
 * for an average laptop.
 */
export const HEAT_POINT_BUDGET_TOUCH = 25_000;
export const HEAT_POINT_BUDGET_DESKTOP = 80_000;

export function heatPointBudget(touch: boolean): number {
  return touch ? HEAT_POINT_BUDGET_TOUCH : HEAT_POINT_BUDGET_DESKTOP;
}
