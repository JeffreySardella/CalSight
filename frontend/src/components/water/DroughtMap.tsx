import { useEffect, useMemo, useRef, useState } from "react";
import { useCountyGeoJson } from "../../hooks/useCountyGeoJson";
import { inDroughtPct, type DroughtCounty } from "../../hooks/useDroughtData";
import type {
  RegionSnowpack,
  SnowStationCondition,
} from "../../hooks/useSnowpackData";
import { formatAcreFeet, type ReservoirCondition } from "../../hooks/useWaterData";
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

// Snow marks are one fixed size: percent of average is the only value
// encoded, and there are up to 110 stations packed along the Sierra, so a
// magnitude-sized mark would only add overlap. R is the half-diagonal.
const SNOW_R = 5;
// Stations are texture, not targets. Measured on production at 375px the
// SVG renders 324px wide, and the 107 marks have a median nearest-neighbour
// distance of 4px — 100 of them have another mark within 12px. No hit-target
// size makes an individual station tappable at that density, so interaction
// lives one level up, at the DWR region.
const REGION_PAD = 6;
// A one-station region still needs a finger: 18 units ≈ 29px across on a
// 375px phone.
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
// floor keeps the smallest reservoirs above a finger-sized tap target even
// though that breaks strict proportionality down there.
const MIN_R = 6;
const MAX_R = 16;
// The map shrinks to ~327px on a 375px phone, so a 6-unit dot renders at
// ~11px across — far under a finger. A transparent hit circle carries the
// interaction instead, leaving the visible radius free to mean capacity.
const MIN_HIT_R = 15;

function radiusForCapacity(capacityAf: number, maxCapacityAf: number): number {
  if (maxCapacityAf <= 0) return MIN_R;
  return Math.max(MIN_R, MAX_R * Math.sqrt(capacityAf / maxCapacityAf));
}

const WIDTH = 400;
const HEIGHT = 460;
const PAD = 8;

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

/** Plate-carrée projection with a cosine longitude correction — fine for
 * a small single-state inset map (no d3-geo dependency needed). */
function buildProjector(features: GeoJSON.Feature[]) {
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
  const midLat = (minLat + maxLat) / 2;
  const lonScale = Math.cos((midLat * Math.PI) / 180);
  const spanX = (maxLon - minLon) * lonScale;
  const spanY = maxLat - minLat;
  const k = Math.min((WIDTH - 2 * PAD) / spanX, (HEIGHT - 2 * PAD) / spanY);
  return ([lon, lat]: number[]): [number, number] => [
    PAD + (lon - minLon) * lonScale * k,
    PAD + (maxLat - lat) * k,
  ];
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

/**
 * Inline-SVG choropleth of drought share (D1+) per county, with an
 * optional reservoir and snow-station layers on top. Tile-free and
 * dependency-free: counties come from the same topojson the main map
 * ships, projected with a simple state-scale approximation, and both
 * point layers ride the very same projector so they cannot drift apart.
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
  // Client→viewBox conversion for the nearest-station tap rule needs the
  // rendered size, which only the element knows.
  const svgRef = useRef<SVGSVGElement>(null);

  const byCode = useMemo(
    () => new Map(counties.map((c) => [c.county_code, c])),
    [counties],
  );

  const project = useMemo(
    () => (geojson ? buildProjector(geojson.features) : null),
    [geojson],
  );

  const paths = useMemo(() => {
    if (!geojson || !project) return null;
    return geojson.features.map((f) => {
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

  const dots = useMemo(() => {
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

  const marks = useMemo(() => {
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
  const regions = useMemo(() => {
    const byRegion = new Map<string, typeof marks>();
    for (const m of marks) {
      const group = byRegion.get(m.station.region);
      if (group) group.push(m);
      else byRegion.set(m.station.region, [m]);
    }
    return [...byRegion]
      .map(([region, group]) => {
        const cx = group.reduce((s, m) => s + m.cx, 0) / group.length;
        const cy = group.reduce((s, m) => s + m.cy, 0) / group.length;
        const far = Math.max(...group.map((m) => Math.hypot(m.cx - cx, m.cy - cy)));
        return {
          region,
          cx,
          cy,
          r: Math.max(far + REGION_PAD, REGION_MIN_R),
          located: group.length,
          api: snowRegions?.find((r) => r.region === region),
        };
      })
      // Biggest first so a small region nested inside a big one keeps its
      // own circle reachable by mouse and by Playwright's centre-click.
      .sort((a, b) => b.r - a.r);
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

  if (!paths) return null;
  const hasNoData = paths.some((p) => p.noData);
  const isSelected = (layer: Selection["layer"], id: string) =>
    selected?.layer === layer && selected.id === id;
  // Selecting in either layer replaces whatever was selected in the other,
  // so only one detail panel is ever open.
  const toggle = (layer: Selection["layer"], id: string) =>
    setSelected((cur) =>
      cur?.layer === layer && cur.id === id ? null : { layer, id },
    );

  /** The region of the located station nearest a tap, or null when the tap
   *  landed on bare map. Region circles overlap along the Sierra, so this —
   *  not which circle happens to be on top — decides the selection. */
  const nearestRegion = (clientX: number, clientY: number): string | null => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect?.width) return null;
    const k = WIDTH / rect.width;
    const x = (clientX - rect.left) * k;
    const y = (clientY - rect.top) * k;
    let best: string | null = null;
    let bestD = REGION_TAP_R;
    for (const m of marks) {
      const d = Math.hypot(m.cx - x, m.cy - y);
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
  const nearestReservoir = (clientX: number, clientY: number): string | null => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect?.width) return null;
    const k = WIDTH / rect.width;
    const x = (clientX - rect.left) * k;
    const y = (clientY - rect.top) * k;
    let best: string | null = null;
    let bestD = Infinity;
    for (const d of dots) {
      const dist = Math.hypot(d.cx - x, d.cy - y);
      // Only reservoirs whose own hit circle contains the tap compete. A
      // click a screen reader or keyboard synthesises can report (0, 0);
      // without this bound it resolved to whichever reservoir sits nearest
      // the map's corner instead of the focused one (callers fall back to
      // the circle that received the click when this returns null).
      if (dist > Math.max(d.r, MIN_HIT_R)) continue;
      if (dist < bestD) {
        bestD = dist;
        best = d.reservoir.station_id;
      }
    }
    return best;
  };

  return (
    <figure className="flex flex-col items-center mt-12">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full max-w-[400px]"
        // A tap anywhere on the map picks the nearest station's region, so
        // the dense Sierra cluster is reachable without aiming. Buttons
        // (reservoir dots, region circles) run their own handler instead.
        onClick={(e) => {
          if ((e.target as Element).closest('[role="button"]')) return;
          const region = nearestRegion(e.clientX, e.clientY);
          if (region) toggle("region", region);
        }}
      >
        <defs>
          <pattern
            id={NO_DATA_PATTERN_ID}
            width={5}
            height={5}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width={5} height={5} fill={NO_DROUGHT_FILL} />
            <line x1={0} y1={0} x2={0} y2={5} stroke={NO_DATA_STRIPE} strokeWidth={1.5} />
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
              stroke="rgb(var(--surface))"
              strokeWidth={1}
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
                points={diamondPoints(m.cx, m.cy, SNOW_R)}
                fill="none"
                stroke="rgb(var(--surface))"
                strokeWidth={3}
              />
              <polygon
                data-testid={`snow-mark-${m.station.station_id}`}
                points={diamondPoints(m.cx, m.cy, SNOW_R)}
                fill={fillForSnowPct(m.station.pct_of_average)}
                fillOpacity={0.92}
                stroke="rgb(var(--inverse-surface))"
                // The selected region's stations wear a heavier outline so
                // the user can see which cluster they picked.
                strokeWidth={isSelected("region", m.station.region) ? 2.5 : 1}
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
              r={g.r}
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
              onClick={(e) => toggle("region", nearestRegion(e.clientX, e.clientY) ?? g.region)}
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
                r={d.r}
                fill="none"
                stroke="rgb(var(--surface))"
                strokeWidth={3}
                pointerEvents="none"
              />
              <circle
                data-testid={`reservoir-dot-${d.reservoir.station_id}`}
                cx={d.cx}
                cy={d.cy}
                r={d.r}
                fill={fillForReservoirPct(d.reservoir.pct_of_capacity)}
                fillOpacity={0.92}
                stroke="rgb(var(--inverse-surface))"
                strokeWidth={on ? 3 : 1.25}
                pointerEvents="none"
              />
              <circle
                cx={d.cx}
                cy={d.cy}
                r={Math.max(d.r, MIN_HIT_R)}
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
                onClick={(e) => toggle("reservoir", nearestReservoir(e.clientX, e.clientY) ?? d.reservoir.station_id)}
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
      </svg>

      {selectedReservoir && (
        <div
          role="group"
          aria-label={`${selectedReservoir.name} detail`}
          className="w-full max-w-[400px] mt-4 bg-surface-container-lowest rounded-2xl p-4"
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
          className="w-full max-w-[400px] mt-4 bg-surface-container-lowest rounded-2xl p-4"
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
