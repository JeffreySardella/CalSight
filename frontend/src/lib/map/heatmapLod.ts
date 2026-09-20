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

/** Zoom at which individual crash dots take over from the heat field. */
export const DOT_MIN_ZOOM = 14;

/** Full-detail crash points fetched for the visible rectangle at DOT_MIN_ZOOM+. */
export const DOT_LIMIT = 800;

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
