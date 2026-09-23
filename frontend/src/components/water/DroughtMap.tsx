import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import {
  AttributionControl,
  MapContainer,
  Pane,
  SVGOverlay,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import type { LatLngBoundsExpression, Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import { useIsDark } from "../../context/ThemeContext";
import { useCountyGeoJson } from "../../hooks/useCountyGeoJson";
import { inDroughtPct, type DroughtCounty } from "../../hooks/useDroughtData";
import type {
  RegionSnowpack,
  SnowStationCondition,
} from "../../hooks/useSnowpackData";
import { formatAcreFeet, type ReservoirCondition } from "../../hooks/useWaterData";
import { prefersReducedMotionNow, scrollBehavior } from "../../lib/a11y/motion";
import { BASEMAPS, TILE_ERROR_LIMIT } from "../../lib/map/basemaps";
import { isMeltSeason } from "./SnowpackSection";

/** Bins for percent-of-county-in-drought (D1+), reusing the validated
 * sequential ramp. A magnitude scale, light→dark. */
const BINS = [
  { min: 20, max: 40, color: "rgb(var(--drought-d1))", label: "20–40%" },
  { min: 40, max: 60, color: "rgb(var(--drought-d2))", label: "40–60%" },
  { min: 60, max: 80, color: "rgb(var(--drought-d3))", label: "60–80%" },
  { min: 80, max: Infinity, color: "rgb(var(--drought-d4))", label: "80%+" },
] as const;
const BIN_UNDER_20 = { color: "rgb(var(--drought-d0))", label: "<20%" };
const NO_DROUGHT_FILL = "rgb(var(--surface-container-highest))";
// Counties absent from the snapshot must not wear the "None" color — a
// missing county-week would otherwise read as verified drought-free. The
// hatch keeps "no data" visually distinct from every data state.
const NO_DATA_PATTERN_ID = "drought-no-data";
const NO_DATA_FILL = `url(#${NO_DATA_PATTERN_ID})`;
const NO_DATA_STRIPE = "rgb(var(--on-surface-variant) / 0.35)";
const NO_DATA_LEGEND_BG = `repeating-linear-gradient(45deg, rgb(var(--surface-container-highest)) 0 2px, rgb(var(--on-surface-variant) / 0.35) 2px 3px)`;
// Just short of opaque so the basemap's roads and water read through the
// choropleth once zoomed in, without washing out the ramp.
const COUNTY_FILL_OPACITY = 0.85;

export function fillForDroughtShare(pct: number): string {
  if (pct < 0.5) return NO_DROUGHT_FILL;
  for (const bin of BINS) {
    if (pct >= bin.min && pct < bin.max) return bin.color;
  }
  return BIN_UNDER_20.color;
}

/** Reservoir fullness ramp — a blue hue family, deliberately unrelated to
 * the orange/brown drought ramp so the two overlaid layers never read as
 * one scale. Four steps, empty→full. */
const RESERVOIR_BINS = [
  { min: 0, max: 25, color: "rgb(var(--reservoir-r0))", label: "<25%" },
  { min: 25, max: 50, color: "rgb(var(--reservoir-r1))", label: "25–50%" },
  { min: 50, max: 75, color: "rgb(var(--reservoir-r2))", label: "50–75%" },
  { min: 75, max: Infinity, color: "rgb(var(--reservoir-r3))", label: "75%+" },
] as const;

export function fillForReservoirPct(pct: number): string {
  for (const bin of RESERVOIR_BINS) {
    if (pct >= bin.min && pct < bin.max) return bin.color;
  }
  return RESERVOIR_BINS[0].color;
}

/** Snow-station ramp — percent of the day-of-year average SWE. A third
 * hue family (violet), and the marks are diamonds rather than circles:
 * under red-green CVD no third hue stays far from both the orange drought
 * ramp and the blue reservoir ramp, so the layers separate by shape. See
 * the --snow-s0..s3 comment in index.css for the measured separations. */
const SNOW_BINS = [
  { min: 0, max: 50, color: "rgb(var(--snow-s0))", label: "<50%" },
  { min: 50, max: 100, color: "rgb(var(--snow-s1))", label: "50–100%" },
  { min: 100, max: 150, color: "rgb(var(--snow-s2))", label: "100–150%" },
  { min: 150, max: Infinity, color: "rgb(var(--snow-s3))", label: "150%+" },
] as const;
// Stations that report SWE but have no usable baseline (<2 years of
// history, or a deep-summer average too small to divide by) still belong
// on the map — they just carry no value, like a no-data county.
const SNOW_NO_PCT_FILL = "rgb(var(--surface-container-highest))";

export function fillForSnowPct(pct: number | null): string {
  if (pct === null) return SNOW_NO_PCT_FILL;
  for (const bin of SNOW_BINS) {
    if (pct >= bin.min && pct < bin.max) return bin.color;
  }
  return SNOW_BINS[SNOW_BINS.length - 1].color;
}

// Every size below is in screen pixels, and holds at every zoom: the
// overlay converts to its own units with the current zoom, so zooming in
// spreads the marks apart instead of blowing them up.
//
// Snow marks are one fixed size: percent of average is the only value
// encoded, and there are up to 110 stations packed along the Sierra, so a
// magnitude-sized mark would only add overlap. R is the half-diagonal.
const SNOW_R = 5;
// Stations are texture, not targets. At the statewide view on a 375px phone
// the 107 marks have a median nearest-neighbour distance of ~4px — 100 of
// them have another mark within 12px. No hit-target size makes an individual
// station tappable at that density, so interaction lives one level up, at
// the DWR region.
const REGION_PAD = 6;
// A one-station region still needs a finger.
const REGION_MIN_R = 18;
// How far from a tap we will still claim a station. Region circles overlap
// heavily along the Sierra, so the nearest-station rule — not the stacking
// order — decides which region a tap lands in.
const REGION_TAP_R = 30;

/** The percent the snowpack section is showing for this region right now —
 * the same melt-season switch, so the map and the list can never disagree.
 * Always the API's regional figure, never a mean of the station marks. */
function regionPct(api: RegionSnowpack | undefined): {
  pct: number | null;
  label: string;
} {
  if (!api) return { pct: null, label: "average" };
  // Loose != null on purpose: a payload cached from before the April-1
  // fields shipped has them undefined, not null.
  const melt = isMeltSeason(api.latest_date) && api.apr1_pct_of_average != null;
  return melt
    ? { pct: api.apr1_pct_of_average ?? null, label: "April 1 average" }
    : { pct: api.pct_of_average ?? null, label: "average" };
}

/** Diamond centred on (cx, cy) with half-diagonal r. */
function diamondPoints(cx: number, cy: number, r: number): string {
  return `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`;
}

// Area (not radius) carries capacity, so the radius is a sqrt scale. The
// floor keeps the smallest reservoirs visible at the statewide view even
// though that breaks strict proportionality down there.
const MIN_R = 6;
const MAX_R = 16;
// A 6px dot is far under a finger. A transparent hit circle carries the
// interaction instead, leaving the visible radius free to mean capacity.
const MIN_HIT_R = 15;

function radiusForCapacity(capacityAf: number, maxCapacityAf: number): number {
  if (maxCapacityAf <= 0) return MIN_R;
  return Math.max(MIN_R, MAX_R * Math.sqrt(capacityAf / maxCapacityAf));
}

type Ring = number[][];

function* rings(geometry: GeoJSON.Geometry): Generator<Ring> {
  if (geometry.type === "Polygon") {
    for (const ring of geometry.coordinates) yield ring as Ring;
  } else if (geometry.type === "MultiPolygon") {
    for (const poly of geometry.coordinates) {
      for (const ring of poly) yield ring as Ring;
    }
  }
}

// The overlay's user space is Web Mercator pixels at REF_ZOOM — the
// projection the basemap tiles are drawn in, so every county edge and mark
// sits exactly on its tile. Leaflet stretches that space to the live zoom
// (and animates it through pinches), so the paths are projected only once.
// At zoom 8 California is ~2,000 units wide: one decimal is sub-pixel all
// the way to MAX_ZOOM.
export const REF_ZOOM = 8;

/** EPSG:3857 pixel coordinates at REF_ZOOM — Leaflet's own formula, inlined
 * so the projection needs no map instance. */
function mercator([lon, lat]: number[]): [number, number] {
  const size = 256 * 2 ** REF_ZOOM;
  const sin = Math.sin((lat * Math.PI) / 180);
  return [
    ((lon + 180) / 360) * size,
    (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  ];
}

// Margin around the counties' bounding box, in degrees, so marks on the
// state line are not clipped by the overlay's own edge.
const OVERLAY_PAD_DEG = 0.3;

function buildProjection(features: GeoJSON.Feature[]) {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const f of features) {
    for (const ring of rings(f.geometry)) {
      for (const [lon, lat] of ring) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  minLon -= OVERLAY_PAD_DEG;
  maxLon += OVERLAY_PAD_DEG;
  minLat -= OVERLAY_PAD_DEG;
  maxLat += OVERLAY_PAD_DEG;
  const [x0, y0] = mercator([minLon, maxLat]);
  const [x1, y1] = mercator([maxLon, minLat]);
  return {
    project: (c: number[]): [number, number] => {
      const [x, y] = mercator(c);
      return [x - x0, y - y0];
    },
    width: x1 - x0,
    height: y1 - y0,
    bounds: [
      [minLat, minLon],
      [maxLat, maxLon],
    ] as LatLngBoundsExpression,
  };
}

function featurePath(
  feature: GeoJSON.Feature,
  project: (c: number[]) => [number, number],
): string {
  const parts: string[] = [];
  for (const ring of rings(feature.geometry)) {
    parts.push(
      "M" +
        ring
          .map((c) => {
            const [x, y] = project(c);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join("L") +
        "Z",
    );
  }
  return parts.join("");
}

// Opening frame: the whole state, whatever the viewport's shape.
const CA_BOUNDS: LatLngBoundsExpression = [
  [32.5, -124.45],
  [42.0, -114.13],
];
// Panning stops a little past the state line rather than wandering off
// into Nevada or the Pacific.
const MAX_BOUNDS: LatLngBoundsExpression = [
  [30.5, -127.5],
  [44.0, -111.0],
];
const MIN_ZOOM = 5;
// Deep enough that the Sierra stations sit well apart; the data layers have
// nothing finer to show past it.
const MAX_ZOOM = 12;
// How long the "use two fingers" hint stays up after a one-finger drag.
const HINT_MS = 1500;

interface DroughtMapProps {
  counties: DroughtCounty[];
  weekStart: string;
  /** Optional overlay. Undefined while the reservoir query loads or after
   *  it fails — the choropleth renders on its own either way. */
  reservoirs?: ReservoirCondition[];
  /** Optional overlay, same contract as `reservoirs`: undefined while the
   *  snowpack query loads or after it fails, and the map is unchanged.
   *  Drawn as non-interactive texture — see REGION_PAD. */
  snowStations?: SnowStationCondition[];
  /** The API's per-region figures, which the region panel quotes verbatim
   *  rather than averaging the stations itself. */
  snowRegions?: RegionSnowpack[];
  /** Jumps to (and expands) the selected reservoir's card up the page. */
  onShowInList?: (stationId: string) => void;
  /** Same, for the selected region's row in the snowpack section. */
  onShowRegionInList?: (region: string) => void;
}

/** One selection across both overlays — picking a snow region clears a
 *  selected reservoir and vice versa. */
type Selection = { layer: "reservoir" | "region"; id: string };

type CountyPath = { key: string | number; d: string; noData: boolean; fill: string; title: string };
type Dot = { r: number; cx: number; cy: number; reservoir: ReservoirCondition };
type Mark = { cx: number; cy: number; station: SnowStationCondition };
type Region = {
  region: string;
  cx: number;
  cy: number;
  /** Spread of the region's stations from its centre, in overlay units. */
  far: number;
  located: number;
  api: RegionSnowpack | undefined;
};

/** Hands the Leaflet map to the zoom buttons, which live outside the map
 *  container so their taps never reach Leaflet's drag and double-click
 *  handlers. Also names the container: Leaflet makes it focusable (arrow
 *  keys pan) but gives it no role or label. */
function MapReady({ onReady }: { onReady: (map: LeafletMap) => void }) {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    el.setAttribute("role", "region");
    el.setAttribute(
      "aria-label",
      "Interactive map of California drought, reservoirs and snowpack. Arrow keys pan, plus and minus zoom.",
    );
    onReady(map);
  }, [map, onReady]);
  return null;
}

interface OverlayProps {
  paths: CountyPath[];
  dots: Dot[];
  marks: Mark[];
  regions: Region[];
  weekStart: string;
  isSelected: (layer: Selection["layer"], id: string) => boolean;
  toggle: (layer: Selection["layer"], id: string) => void;
}

/**
 * The drawn layers, rendered into Leaflet's SVG overlay. Positions are in
 * REF_ZOOM units and never change; sizes are pixels divided by the current
 * scale, so they are recomputed (cheaply — no county path is touched) on
 * every zoomend. Strokes are non-scaling, so they are pixels already.
 */
function DroughtLayers({ paths, dots, marks, regions, weekStart, isSelected, toggle }: OverlayProps) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  // Overlay units per screen pixel at the settled zoom.
  const u = 2 ** (REF_ZOOM - zoom);
  // Where the pointer went down, so a click that ends a mouse drag of the
  // map is not also read as a tap on whatever it was released over.
  const downAt = useRef<[number, number] | null>(null);

  /** A click's position in overlay units, plus overlay units per client
   *  pixel as actually rendered — measured, not derived from `zoom`, so it
   *  stays right mid-animation. */
  const locate = (e: MouseEvent<Element>) => {
    const svg = (e.currentTarget as Element).closest("svg");
    const rect = svg?.getBoundingClientRect();
    const vbWidth = Number(svg?.getAttribute("viewBox")?.split(" ")[2]);
    if (!rect?.width || !vbWidth) return null;
    const k = vbWidth / rect.width;
    return { x: (e.clientX - rect.left) * k, y: (e.clientY - rect.top) * k, k };
  };

  /** The region of the located station nearest a tap, or null when the tap
   *  landed on bare map. Region circles overlap along the Sierra, so this —
   *  not which circle happens to be on top — decides the selection. */
  const nearestRegion = (e: MouseEvent<Element>): string | null => {
    const at = locate(e);
    if (!at) return null;
    let best: string | null = null;
    let bestD = REGION_TAP_R * at.k;
    for (const m of marks) {
      const d = Math.hypot(m.cx - at.x, m.cy - at.y);
      if (d < bestD) {
        bestD = d;
        best = m.station.region;
      }
    }
    return best;
  };

  /** Same idea, for reservoirs: dots are drawn biggest-first so the small
   *  ones stay on top and tappable, but that also means a big reservoir's
   *  hit circle can sit *under* a smaller one drawn later (Shasta under
   *  Trinity). Resolving every reservoir tap to the nearest centre — rather
   *  than trusting which hit circle happens to be topmost — makes every
   *  reservoir tappable at its own centre regardless of draw order. */
  const nearestReservoir = (e: MouseEvent<Element>): string | null => {
    const at = locate(e);
    if (!at) return null;
    let best: string | null = null;
    let bestD = Infinity;
    for (const d of dots) {
      const dist = Math.hypot(d.cx - at.x, d.cy - at.y);
      // Only reservoirs whose own hit circle contains the tap compete. A
      // click a screen reader or keyboard synthesises can report (0, 0);
      // without this bound it resolved to whichever reservoir sits nearest
      // the map's corner instead of the focused one (callers fall back to
      // the circle that received the click when this returns null).
      if (dist > Math.max(d.r, MIN_HIT_R) * at.k) continue;
      if (dist < bestD) {
        bestD = dist;
        best = d.reservoir.station_id;
      }
    }
    return best;
  };

  const dragged = (e: MouseEvent<Element>) =>
    !!downAt.current &&
    Math.hypot(e.clientX - downAt.current[0], e.clientY - downAt.current[1]) > 6;

  return (
    // Leaflet's CSS takes pointer events off image overlays and their
    // paths (it expects a plain picture); this layer is interactive, so it
    // opts back in here and on each county path.
    <g
      style={{ pointerEvents: "auto" }}
      onPointerDown={(e: PointerEvent<Element>) => {
        downAt.current = [e.clientX, e.clientY];
      }}
      // A tap anywhere on the map picks the nearest station's region, so
      // the dense Sierra cluster is reachable without aiming. Buttons
      // (reservoir dots, region circles) run their own handler instead.
      onClick={(e) => {
        if (dragged(e)) return;
        if ((e.target as Element).closest('[role="button"]')) return;
        const region = nearestRegion(e);
        if (region) toggle("region", region);
      }}
    >
      <defs>
        <pattern
          id={NO_DATA_PATTERN_ID}
          width={5 * u}
          height={5 * u}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width={5 * u} height={5 * u} fill={NO_DROUGHT_FILL} />
          <line x1={0} y1={0} x2={0} y2={5 * u} stroke={NO_DATA_STRIPE} strokeWidth={1.5 * u} />
        </pattern>
      </defs>
      {/* The choropleth is one labeled image; the role lives on the group
          rather than the <svg> so the reservoir buttons below it stay in
          the accessibility tree (role="img" makes descendants
          presentational). */}
      <g
        role="img"
        aria-label={`Map of California counties shaded by share of land in drought for the week of ${weekStart}. Details per county are in the hardest-hit list below.`}
      >
        {paths.map((p) => (
          <path
            key={p.key}
            d={p.d}
            fill={p.fill}
            fillOpacity={COUNTY_FILL_OPACITY}
            stroke="rgb(var(--surface))"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            style={{ pointerEvents: "auto" }}
          >
            <title>{p.title}</title>
          </path>
        ))}
      </g>
      {/* Stations are texture: colour carries percent of average, and
          nothing here is focusable or tappable — 107 marks at a 4px
          median spacing cannot each be a target. */}
      <g aria-hidden="true" pointerEvents="none">
        {marks.map((m) => (
          <g key={m.station.station_id}>
            {/* Same halo trick as the reservoir dots: a surface-colored
                outline survives whatever county fill sits underneath. */}
            <polygon
              points={diamondPoints(m.cx, m.cy, SNOW_R * u)}
              fill="none"
              stroke="rgb(var(--surface))"
              strokeWidth={3}
              vectorEffect="non-scaling-stroke"
            />
            <polygon
              data-testid={`snow-mark-${m.station.station_id}`}
              points={diamondPoints(m.cx, m.cy, SNOW_R * u)}
              fill={fillForSnowPct(m.station.pct_of_average)}
              fillOpacity={0.92}
              stroke="rgb(var(--inverse-surface))"
              // The selected region's stations wear a heavier outline so
              // the user can see which cluster they picked.
              strokeWidth={isSelected("region", m.station.region) ? 2.5 : 1}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}
      </g>
      {/* Region hit targets sit under the reservoir dots, so a tap that
          lands on a reservoir still belongs to the reservoir. */}
      {regions.map((g) => {
        const { pct, label } = regionPct(g.api);
        return (
          <circle
            key={g.region}
            data-testid={`snow-region-${g.region}`}
            cx={g.cx}
            cy={g.cy}
            r={Math.max(g.far + REGION_PAD * u, REGION_MIN_R * u)}
            fill="transparent"
            className="cursor-pointer focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
            role="button"
            tabIndex={0}
            aria-pressed={isSelected("region", g.region)}
            aria-label={`${g.region} snowpack, ${
              pct !== null ? `${pct.toFixed(0)}% of ${label}` : "no comparison available"
            }, ${g.located} station${g.located === 1 ? "" : "s"}`}
            // Even a tap inside this circle defers to the nearest station,
            // so overlapping regions resolve the same way everywhere.
            onClick={(e) => {
              if (dragged(e)) return;
              toggle("region", nearestRegion(e) ?? g.region);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggle("region", g.region);
              }
            }}
          />
        );
      })}
      {dots.map((d) => {
        const on = isSelected("reservoir", d.reservoir.station_id);
        return (
          <g key={d.reservoir.station_id}>
            {/* Halo: whichever theme/county fill kills the ring's
                contrast, the surface-colored halo under it survives. */}
            <circle
              cx={d.cx}
              cy={d.cy}
              r={d.r * u}
              fill="none"
              stroke="rgb(var(--surface))"
              strokeWidth={3}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
            <circle
              data-testid={`reservoir-dot-${d.reservoir.station_id}`}
              cx={d.cx}
              cy={d.cy}
              r={d.r * u}
              fill={fillForReservoirPct(d.reservoir.pct_of_capacity)}
              fillOpacity={0.92}
              stroke="rgb(var(--inverse-surface))"
              strokeWidth={on ? 3 : 1.25}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
            <circle
              cx={d.cx}
              cy={d.cy}
              r={Math.max(d.r, MIN_HIT_R) * u}
              fill="transparent"
              // The default ring also fires on a mouse click, which looks
              // like a stuck selection; keyboard focus still rings.
              className="cursor-pointer focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
              role="button"
              tabIndex={0}
              aria-pressed={on}
              aria-label={`${d.reservoir.name}, ${d.reservoir.pct_of_capacity.toFixed(0)}% of capacity`}
              // Even a tap inside this circle defers to the nearest
              // reservoir centre, so overlapping reservoirs (Shasta under
              // Trinity) resolve the same way everywhere.
              onClick={(e) => {
                if (dragged(e)) return;
                toggle("reservoir", nearestReservoir(e) ?? d.reservoir.station_id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggle("reservoir", d.reservoir.station_id);
                }
              }}
            />
          </g>
        );
      })}
    </g>
  );
}

const ZOOM_BUTTON =
  "w-11 h-11 flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors";

/**
 * Interactive choropleth of drought share (D1+) per county, with optional
 * reservoir and snow-station layers on top, on the same basemap as the
 * main map. Counties come from the same topojson the main map ships; all
 * three layers are drawn into one Leaflet SVG overlay in Web Mercator, so
 * they pan and zoom with the tiles and cannot drift apart.
 *
 * Touch: one finger scrolls the page, two fingers pan and pinch the map
 * (Leaflet's pinch handler pans with the pinch midpoint). A map this tall
 * would otherwise swallow every scroll that starts on it.
 */
export default function DroughtMap({
  counties,
  weekStart,
  reservoirs,
  snowStations,
  snowRegions,
  onShowInList,
  onShowRegionInList,
}: DroughtMapProps) {
  const { data: geojson } = useCountyGeoJson();
  const [selected, setSelected] = useState<Selection | null>(null);
  const [map, setMap] = useState<LeafletMap | null>(null);
  const isDark = useIsDark();

  // Read once: Leaflet takes these at construction.
  const [touch] = useState(
    () => typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches,
  );
  const [reducedMotion] = useState(prefersReducedMotionNow);
  // The detail panel opens under a map that fills most of a phone screen,
  // i.e. out of sight; bring it up (only as far as needed) on each pick.
  const panelRef = useRef<HTMLDivElement>(null);

  // Walk the provider list on repeated tile failures, as MapCanvas does:
  // a dead provider costs a few seconds of grey, not the basemap.
  const [basemapIndex, setBasemapIndex] = useState(0);
  const basemap = BASEMAPS[basemapIndex];
  const tileErrors = useRef(0);
  const tileEvents = useMemo(
    () => ({
      tileerror: () => {
        tileErrors.current += 1;
        if (tileErrors.current < TILE_ERROR_LIMIT) return;
        tileErrors.current = 0;
        setBasemapIndex((i) => Math.min(i + 1, BASEMAPS.length - 1));
      },
      tileload: () => {
        tileErrors.current = 0;
      },
    }),
    [],
  );

  const [hint, setHint] = useState(false);
  const hintTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(hintTimer.current), []);

  const byCode = useMemo(
    () => new Map(counties.map((c) => [c.county_code, c])),
    [counties],
  );

  const projection = useMemo(
    () => (geojson ? buildProjection(geojson.features) : null),
    [geojson],
  );
  const project = projection?.project;

  const paths = useMemo(() => {
    if (!geojson || !project) return null;
    return geojson.features.map((f): CountyPath => {
      const code = Number(f.properties?.county_code);
      const name = String(f.properties?.name ?? "");
      const county = byCode.get(code);
      const drought = county ? inDroughtPct(county) : null;
      return {
        key: code || name,
        d: featurePath(f, project),
        noData: drought === null,
        fill: drought === null ? NO_DATA_FILL : fillForDroughtShare(drought),
        title:
          drought === null
            ? `${name} — no data`
            : drought < 0.5
              ? `${name} — no drought`
              : `${name} — ${drought.toFixed(0)}% in drought (D1+)`,
      };
    });
  }, [geojson, byCode, project]);

  const dots = useMemo((): Dot[] => {
    if (!project || !reservoirs?.length) return [];
    // Rows loaded before the coordinate columns existed have no lat/lon.
    const located = reservoirs.filter((r) => r.lat !== null && r.lon !== null);
    const maxCapacity = Math.max(...located.map((r) => r.capacity_af), 0);
    return located
      .map((r) => {
        const [cx, cy] = project([r.lon as number, r.lat as number]);
        return { r: radiusForCapacity(r.capacity_af, maxCapacity), cx, cy, reservoir: r };
      })
      // Biggest first so the small ones land on top and stay tappable.
      .sort((a, b) => b.r - a.r);
  }, [project, reservoirs]);

  const marks = useMemo((): Mark[] => {
    if (!project || !snowStations?.length) return [];
    // Stations synced before the coordinate columns existed have no lat/lon.
    return snowStations
      .filter((s) => s.lat !== null && s.lon !== null)
      .map((s) => {
        const [cx, cy] = project([s.lon as number, s.lat as number]);
        return { cx, cy, station: s };
      })
      // North first, so the draw order is stable across renders rather
      // than following payload order.
      .sort((a, b) => a.cy - b.cy);
  }, [project, snowStations]);

  // One hit target per DWR region: a circle around that region's located
  // stations. The `api` row is the figure the panel quotes — the regional
  // percent is a weighted DWR number, not the mean of these marks.
  const regions = useMemo((): Region[] => {
    const byRegion = new Map<string, Mark[]>();
    for (const m of marks) {
      const group = byRegion.get(m.station.region);
      if (group) group.push(m);
      else byRegion.set(m.station.region, [m]);
    }
    return [...byRegion]
      .map(([region, group]) => {
        const cx = group.reduce((s, m) => s + m.cx, 0) / group.length;
        const cy = group.reduce((s, m) => s + m.cy, 0) / group.length;
        return {
          region,
          cx,
          cy,
          far: Math.max(...group.map((m) => Math.hypot(m.cx - cx, m.cy - cy))),
          located: group.length,
          api: snowRegions?.find((r) => r.region === region),
        };
      })
      // Biggest first so a small region nested inside a big one keeps its
      // own circle reachable by mouse and by Playwright's centre-click.
      .sort((a, b) => b.far - a.far);
  }, [marks, snowRegions]);

  const selectedReservoir =
    selected?.layer === "reservoir"
      ? dots.find((d) => d.reservoir.station_id === selected.id)?.reservoir
      : undefined;
  const selectedRegion =
    selected?.layer === "region"
      ? regions.find((r) => r.region === selected.id)
      : undefined;

  // Escape must clear the selection from anywhere — the detail panel takes
  // focus off the mark, so a key handler on the mark alone wouldn't do.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected]);

  useEffect(() => {
    if (selected) panelRef.current?.scrollIntoView?.({ block: "nearest", behavior: scrollBehavior() });
  }, [selected]);

  if (!paths || !projection) return null;
  const hasNoData = paths.some((p) => p.noData);
  const isSelected = (layer: Selection["layer"], id: string) =>
    selected?.layer === layer && selected.id === id;
  // Selecting in either layer replaces whatever was selected in the other,
  // so only one detail panel is ever open.
  const toggle = (layer: Selection["layer"], id: string) =>
    setSelected((cur) =>
      cur?.layer === layer && cur.id === id ? null : { layer, id },
    );
  const animate = !reducedMotion;

  return (
    <figure className="flex flex-col items-center mt-12">
      <div
        className="relative w-full max-w-3xl h-[65vh] min-h-[320px] max-h-[640px] rounded-2xl overflow-hidden bg-surface-container-lowest"
        // One finger on a touch screen scrolls the page (Leaflet's drag is
        // off there); say how to move the map the moment someone tries.
        onTouchMove={(e) => {
          if (!touch || e.touches.length !== 1) return;
          setHint(true);
          window.clearTimeout(hintTimer.current);
          hintTimer.current = window.setTimeout(() => setHint(false), HINT_MS);
        }}
      >
        <MapContainer
          bounds={CA_BOUNDS}
          boundsOptions={{ padding: [8, 8] }}
          maxBounds={MAX_BOUNDS}
          maxBoundsViscosity={1.0}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          // Quarter steps let the opening frame fill a phone-shaped box
          // instead of rounding down to half the width.
          zoomSnap={0.25}
          dragging={!touch}
          scrollWheelZoom={false}
          zoomControl={false}
          attributionControl={false}
          zoomAnimation={animate}
          fadeAnimation={animate}
          markerZoomAnimation={animate}
          className="h-full w-full z-0"
        >
          <MapReady onReady={setMap} />
          {/* Required tile-provider credit, without Leaflet's own prefix. */}
          <AttributionControl position="bottomright" prefix={false} />
          <TileLayer
            key={basemap.base(isDark)}
            url={basemap.base(isDark)}
            maxNativeZoom={basemap.maxNativeZoom}
            attribution={basemap.attribution}
            eventHandlers={tileEvents}
          />
          <SVGOverlay
            key={`${projection.width}x${projection.height}`}
            bounds={projection.bounds}
            attributes={{
              viewBox: `0 0 ${projection.width} ${projection.height}`,
              preserveAspectRatio: "none",
            }}
          >
            <DroughtLayers
              paths={paths}
              dots={dots}
              marks={marks}
              regions={regions}
              weekStart={weekStart}
              isSelected={isSelected}
              toggle={toggle}
            />
          </SVGOverlay>
          {/* Place names above the choropleth, as on the main map. Tiles
              take no pointer events, so taps fall through to the layers. */}
          {basemap.labels && (
            <Pane name="drought-labels" style={{ zIndex: 450 }}>
              <TileLayer
                key={basemap.labels(isDark)}
                url={basemap.labels(isDark)}
                maxNativeZoom={basemap.maxNativeZoom}
              />
            </Pane>
          )}
        </MapContainer>

        <div className="absolute top-3 right-3 z-10 flex flex-col bg-surface-container-lowest rounded-full shadow-lg">
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => map?.zoomIn(1, { animate })}
            className={ZOOM_BUTTON}
          >
            <span aria-hidden="true" className="material-symbols-outlined">add</span>
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => map?.zoomOut(1, { animate })}
            className={ZOOM_BUTTON}
          >
            <span aria-hidden="true" className="material-symbols-outlined">remove</span>
          </button>
          <button
            type="button"
            aria-label="Show all of California"
            onClick={() => map?.fitBounds(CA_BOUNDS, { padding: [8, 8], animate })}
            className={ZOOM_BUTTON}
          >
            <span aria-hidden="true" className="material-symbols-outlined">restart_alt</span>
          </button>
        </div>

        <div
          aria-hidden="true"
          className={`absolute inset-0 z-10 flex items-center justify-center bg-inverse-surface/50 pointer-events-none transition-opacity duration-300 ${
            hint ? "opacity-100" : "opacity-0"
          }`}
        >
          <p className="px-4 py-2 rounded-full bg-surface-container-lowest text-sm text-on-surface shadow-lg">
            Use two fingers to move the map
          </p>
        </div>
      </div>

      {selectedReservoir && (
        <div
          role="group"
          aria-label={`${selectedReservoir.name} detail`}
          ref={panelRef}
          // Clears the phone's bottom nav bar when scrolled into view.
          className="w-full max-w-3xl mt-4 bg-surface-container-lowest rounded-2xl p-4 scroll-mb-24"
        >
          <div className="flex items-baseline justify-between gap-3">
            <h4 className="font-headline font-bold text-on-surface leading-tight">
              {selectedReservoir.name}
            </h4>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-xs text-on-surface-variant hover:text-on-surface transition-colors shrink-0"
            >
              Close
            </button>
          </div>
          <p className="text-2xl font-headline font-bold text-on-surface tracking-tight mt-2">
            {selectedReservoir.pct_of_capacity.toFixed(0)}
            <span className="text-base text-on-surface-variant">% of capacity</span>
          </p>
          <p className="text-xs text-on-surface-variant mt-1">
            {formatAcreFeet(selectedReservoir.storage_af)} of{" "}
            {formatAcreFeet(selectedReservoir.capacity_af)} acre-feet ·{" "}
            {selectedReservoir.latest_date}
          </p>
          {selectedReservoir.pct_of_average !== null && (
            <p className="text-xs text-on-surface-variant mt-1">
              {selectedReservoir.pct_of_average.toFixed(0)}% of average for this date
            </p>
          )}
          {onShowInList && (
            <button
              type="button"
              onClick={() => onShowInList(selectedReservoir.station_id)}
              className="mt-2 min-h-[44px] inline-flex items-center text-xs font-medium text-primary hover:opacity-80 transition-opacity"
            >
              Show in list
            </button>
          )}
        </div>
      )}

      {selectedRegion && (
        <div
          role="group"
          aria-label={`${selectedRegion.region} detail`}
          ref={panelRef}
          // Clears the phone's bottom nav bar when scrolled into view.
          className="w-full max-w-3xl mt-4 bg-surface-container-lowest rounded-2xl p-4 scroll-mb-24"
        >
          <div className="flex items-baseline justify-between gap-3">
            <h4 className="font-headline font-bold text-on-surface leading-tight">
              {selectedRegion.region}
            </h4>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-xs text-on-surface-variant hover:text-on-surface transition-colors shrink-0"
            >
              Close
            </button>
          </div>
          {(() => {
            const { pct, label } = regionPct(selectedRegion.api);
            return pct !== null ? (
              <p className="text-2xl font-headline font-bold text-on-surface tracking-tight mt-2">
                {pct.toFixed(0)}
                <span className="text-base text-on-surface-variant">% of {label}</span>
              </p>
            ) : (
              <p className="text-xs text-on-surface-variant mt-2">
                No percent of average available for this region.
              </p>
            );
          })()}
          {/* The API's station_count is how many reported on the latest
              date, which in late summer is a fraction of the marks drawn
              (32 mapped, 14 reporting on 2026-09-21) — so it is the
              numerator here, clamped in case a reporting station has no
              coordinates to plot. */}
          <p className="text-xs text-on-surface-variant mt-1">
            {Math.min(selectedRegion.api?.station_count ?? selectedRegion.located, selectedRegion.located)}{" "}
            of {selectedRegion.located} stations reporting
            {selectedRegion.api && ` · ${selectedRegion.api.latest_date}`}
          </p>
          {onShowRegionInList && (
            <button
              type="button"
              onClick={() => onShowRegionInList(selectedRegion.region)}
              className="mt-2 min-h-[44px] inline-flex items-center text-xs font-medium text-primary hover:opacity-80 transition-opacity"
            >
              Show in list
            </button>
          )}
        </div>
      )}

      <figcaption className="mt-4">
        <ul
          aria-label="Map legend: share of county in drought"
          className="flex flex-wrap justify-center gap-x-4 gap-y-1.5"
        >
          {[
            { color: NO_DROUGHT_FILL, label: "None" },
            BIN_UNDER_20,
            ...BINS,
            ...(hasNoData
              ? [{ color: NO_DATA_LEGEND_BG, label: "No data" }]
              : []),
          ].map((bin) => (
            <li
              key={bin.label}
              className="flex items-center gap-1.5 text-[10px] text-on-surface-variant uppercase tracking-wider"
            >
              <span
                aria-hidden="true"
                className="inline-block w-2.5 h-2.5 rounded-sm"
                style={{ background: bin.color }}
              />
              {bin.label}
            </li>
          ))}
        </ul>
        <p className="text-[10px] text-on-surface-variant uppercase tracking-widest text-center mt-2">
          % of county in drought (D1+)
        </p>

        {dots.length > 0 && (
          <>
            <ul
              aria-label="Map legend: reservoirs"
              className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 mt-4"
            >
              {RESERVOIR_BINS.map((bin) => (
                <li
                  key={bin.label}
                  className="flex items-center gap-1.5 text-[10px] text-on-surface-variant uppercase tracking-wider"
                >
                  <span
                    aria-hidden="true"
                    className="inline-block w-2.5 h-2.5 rounded-full border border-inverse-surface"
                    style={{ background: bin.color }}
                  />
                  {bin.label}
                </li>
              ))}
            </ul>
            <p className="text-[10px] text-on-surface-variant uppercase tracking-widest text-center mt-2">
              Reservoirs · circle size = capacity, color = % full
            </p>
          </>
        )}

        {marks.length > 0 && (
          <>
            <ul
              aria-label="Map legend: snow stations"
              className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 mt-4"
            >
              {[...SNOW_BINS, { color: SNOW_NO_PCT_FILL, label: "No average" }].map(
                (bin) => (
                  <li
                    key={bin.label}
                    className="flex items-center gap-1.5 text-[10px] text-on-surface-variant uppercase tracking-wider"
                  >
                    {/* Rotated square = the diamond mark on the map, so the
                        legend keys shape as well as color. */}
                    <span
                      aria-hidden="true"
                      className="inline-block w-2 h-2 rotate-45 border border-inverse-surface"
                      style={{ background: bin.color }}
                    />
                    {bin.label}
                  </li>
                ),
              )}
            </ul>
            <p className="text-[10px] text-on-surface-variant uppercase tracking-widest text-center mt-2">
              Snow stations · colour = % of average · tap a cluster for its region
            </p>
          </>
        )}
      </figcaption>
    </figure>
  );
}
