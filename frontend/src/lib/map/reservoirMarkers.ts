import type { ReservoirCondition } from "../../hooks/useWaterData";

// Marker diameter range (px). Area scales with capacity via a square-root
// ramp, so Shasta (4.55M AF) doesn't dwarf Pyramid (180K AF) into a speck.
const MIN_SIZE = 26;
const MAX_SIZE = 46;

// Fill color steps by percent of capacity. The color is never the only
// carrier — the percent is printed on the marker itself — but the hue gives
// an at-a-glance read: amber = low pool, blues = healthy.
const FILL_LOW = "#d97706"; // < 40% of capacity
const FILL_MID = "#38bdf8"; // 40–70%
const FILL_HIGH = "#1d4ed8"; // > 70%

/** Diameter for a reservoir, square-root-scaled against the batch's largest. */
export function markerSizePx(capacityAf: number, maxCapacityAf: number): number {
  if (maxCapacityAf <= 0) return MIN_SIZE;
  const frac = Math.sqrt(Math.max(0, Math.min(1, capacityAf / maxCapacityAf)));
  return Math.round(MIN_SIZE + frac * (MAX_SIZE - MIN_SIZE));
}

export function fillColorFor(pctOfCapacity: number): string {
  if (pctOfCapacity < 40) return FILL_LOW;
  if (pctOfCapacity <= 70) return FILL_MID;
  return FILL_HIGH;
}

/**
 * Custom SVG gauge marker: a circle "filled" from the bottom to the
 * reservoir's percent of capacity, with the percent printed on top.
 * Pure string builder so it is unit-testable without Leaflet.
 */
export function reservoirIconHtml(r: ReservoirCondition, sizePx: number): string {
  const pct = Math.max(0, Math.min(100, r.pct_of_capacity));
  const fill = fillColorFor(r.pct_of_capacity);
  // ViewBox is 40×40 with an 18-radius circle; the water rect rises from
  // the circle's bottom (y=38) by pct% of its 36px diameter.
  const waterHeight = (36 * pct) / 100;
  const clipId = `res-clip-${r.station_id}`;
  return (
    `<div role="img" aria-label="${r.name}: ${Math.round(r.pct_of_capacity)}% of capacity">` +
    `<svg width="${sizePx}" height="${sizePx}" viewBox="0 0 40 40" aria-hidden="true">` +
    `<defs><clipPath id="${clipId}"><circle cx="20" cy="20" r="18"/></clipPath></defs>` +
    `<circle cx="20" cy="20" r="18" fill="#f8fafc" fill-opacity="0.92"/>` +
    `<rect x="2" y="${(38 - waterHeight).toFixed(1)}" width="36" height="${waterHeight.toFixed(1)}" fill="${fill}" clip-path="url(#${clipId})"/>` +
    `<circle cx="20" cy="20" r="18" fill="none" stroke="#0f172a" stroke-opacity="0.55" stroke-width="2"/>` +
    `<text x="20" y="24.5" text-anchor="middle" font-size="13" font-weight="700" fill="#0f172a" stroke="#f8fafc" stroke-width="2.5" paint-order="stroke">${Math.round(r.pct_of_capacity)}</text>` +
    `</svg></div>`
  );
}
