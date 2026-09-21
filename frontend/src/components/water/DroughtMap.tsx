import { useEffect, useMemo, useState } from "react";
import { useCountyGeoJson } from "../../hooks/useCountyGeoJson";
import { inDroughtPct, type DroughtCounty } from "../../hooks/useDroughtData";
import { formatAcreFeet, type ReservoirCondition } from "../../hooks/useWaterData";

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

// Area (not radius) carries capacity, so the radius is a sqrt scale. The
// floor keeps the smallest reservoirs above a finger-sized tap target even
// though that breaks strict proportionality down there.
const MIN_R = 6;
const MAX_R = 16;

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
  /** Jumps to (and expands) the selected reservoir's card up the page. */
  onShowInList?: (stationId: string) => void;
}

/**
 * Inline-SVG choropleth of drought share (D1+) per county, with an
 * optional reservoir layer on top. Tile-free and dependency-free:
 * counties come from the same topojson the main map ships, projected with
 * a simple state-scale approximation, and reservoirs ride the very same
 * projector so the two layers cannot drift apart.
 */
export default function DroughtMap({
  counties,
  weekStart,
  reservoirs,
  onShowInList,
}: DroughtMapProps) {
  const { data: geojson } = useCountyGeoJson();
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const selected = dots.find((d) => d.reservoir.station_id === selectedId)?.reservoir;

  // Escape must clear the selection from anywhere — the detail panel takes
  // focus off the circle, so a key handler on the circle alone wouldn't do.
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectedId]);

  if (!paths) return null;
  const hasNoData = paths.some((p) => p.noData);
  const toggle = (stationId: string) =>
    setSelectedId((cur) => (cur === stationId ? null : stationId));

  return (
    <figure className="flex flex-col items-center mt-12">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full max-w-[400px]">
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
        {dots.map((d) => {
          const isSelected = d.reservoir.station_id === selectedId;
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
                cx={d.cx}
                cy={d.cy}
                r={d.r}
                fill={fillForReservoirPct(d.reservoir.pct_of_capacity)}
                fillOpacity={0.92}
                stroke="rgb(var(--inverse-surface))"
                strokeWidth={isSelected ? 3 : 1.25}
                className="cursor-pointer"
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                aria-label={`${d.reservoir.name}, ${d.reservoir.pct_of_capacity.toFixed(0)}% of capacity`}
                onClick={() => toggle(d.reservoir.station_id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggle(d.reservoir.station_id);
                  }
                }}
              />
            </g>
          );
        })}
      </svg>

      {selected && (
        <div
          role="group"
          aria-label={`${selected.name} detail`}
          className="w-full max-w-[400px] mt-4 bg-surface-container-lowest rounded-2xl p-4"
        >
          <div className="flex items-baseline justify-between gap-3">
            <h4 className="font-headline font-bold text-on-surface leading-tight">
              {selected.name}
            </h4>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="text-xs text-on-surface-variant hover:text-on-surface transition-colors shrink-0"
            >
              Close
            </button>
          </div>
          <p className="text-2xl font-headline font-bold text-on-surface tracking-tight mt-2">
            {selected.pct_of_capacity.toFixed(0)}
            <span className="text-base text-on-surface-variant">% of capacity</span>
          </p>
          <p className="text-xs text-on-surface-variant mt-1">
            {formatAcreFeet(selected.storage_af)} of{" "}
            {formatAcreFeet(selected.capacity_af)} acre-feet · {selected.latest_date}
          </p>
          {selected.pct_of_average !== null && (
            <p className="text-xs text-on-surface-variant mt-1">
              {selected.pct_of_average.toFixed(0)}% of average for this date
            </p>
          )}
          {onShowInList && (
            <button
              type="button"
              onClick={() => onShowInList(selected.station_id)}
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
      </figcaption>
    </figure>
  );
}
