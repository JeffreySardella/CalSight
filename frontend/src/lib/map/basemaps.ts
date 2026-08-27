/**
 * Basemap providers, in the order the map tries them.
 *
 * CARTO's basemap CDN now wants an API key: without one it still serves tiles,
 * but stamped with a diagonal "API KEY REQUIRED" watermark across the map. Set
 * VITE_CARTO_API_KEY to use CARTO (the design these styles were built for) and
 * the watermark goes away; leave it unset and the map falls back to a provider
 * that needs no key.
 *
 * The map walks this list on repeated tile failures, so a provider that is
 * unreachable or has changed its URL scheme degrades to the next one instead of
 * leaving a blank canvas. Keep the list ordered best-looking first.
 */

export interface Basemap {
  id: string;
  /** Shown in the console when the map falls through to this provider. */
  name: string;
  /** Tile template for the label-free base layer. */
  base: (dark: boolean) => string;
  /** Separate label overlay, drawn above the data layers. Null = labels are
   *  baked into the base tiles and no overlay is drawn. */
  labels: ((dark: boolean) => string) | null;
  attribution: string;
  /** Highest zoom the provider actually ships tiles for. Leaflet upscales past
   *  it rather than dropping to blank tiles. */
  maxNativeZoom: number;
}

const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/">CARTO</a>';
const ESRI_ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Read at module load; Vite inlines it at build time. */
export const CARTO_API_KEY: string = import.meta.env.VITE_CARTO_API_KEY ?? "";

function cartoUrl(style: string, key: string): string {
  const suffix = key ? `?api_key=${encodeURIComponent(key)}` : "";
  return `https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png${suffix}`;
}

export const CARTO_BASEMAP: Basemap = {
  id: "carto",
  name: "CARTO",
  base: (dark) => cartoUrl(dark ? "dark_nolabels" : "light_nolabels", CARTO_API_KEY),
  labels: (dark) => cartoUrl(dark ? "dark_only_labels" : "light_only_labels", CARTO_API_KEY),
  attribution: CARTO_ATTRIBUTION,
  maxNativeZoom: 20,
};

/** Esri's grey canvas: the closest keyless match to CARTO's Positron/Dark
 *  Matter, and it ships the same base + reference-label split this map needs. */
export const ESRI_BASEMAP: Basemap = {
  id: "esri-canvas",
  name: "Esri Canvas",
  base: (dark) =>
    `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${dark ? "Dark" : "Light"}_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
  labels: (dark) =>
    `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${dark ? "Dark" : "Light"}_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
  attribution: ESRI_ATTRIBUTION,
  maxNativeZoom: 16,
};

/** Last resort only — OSM's tile policy asks apps not to lean on it, so this
 *  sits behind two other providers and is reached only when both have failed.
 *  Labels are part of the tile, so no overlay. */
export const OSM_BASEMAP: Basemap = {
  id: "osm",
  name: "OpenStreetMap",
  base: () => "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  labels: null,
  attribution: OSM_ATTRIBUTION,
  maxNativeZoom: 19,
};

/**
 * Providers in fallback order. CARTO leads only when a key is configured —
 * unkeyed CARTO would paint a watermark over every view, which is worse than
 * a different-looking basemap.
 */
export const BASEMAPS: Basemap[] = CARTO_API_KEY
  ? [CARTO_BASEMAP, ESRI_BASEMAP, OSM_BASEMAP]
  : [ESRI_BASEMAP, OSM_BASEMAP];

/** Consecutive tile failures before giving up on a provider. */
export const TILE_ERROR_LIMIT = 6;
