import { useMemo } from "react";
import { useCountyGeoJson } from "../../hooks/useCountyGeoJson";
import { inDroughtPct, type DroughtCounty } from "../../hooks/useDroughtData";

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
}

/**
 * Inline-SVG choropleth of drought share (D1+) per county. Tile-free and
 * dependency-free: counties come from the same topojson the main map
 * ships, projected with a simple state-scale approximation.
 */
export default function DroughtMap({ counties, weekStart }: DroughtMapProps) {
  const { data: geojson } = useCountyGeoJson();

  const byCode = useMemo(
    () => new Map(counties.map((c) => [c.county_code, c])),
    [counties],
  );

  const paths = useMemo(() => {
    if (!geojson) return null;
    const project = buildProjector(geojson.features);
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
  }, [geojson, byCode]);

  if (!paths) return null;
  const hasNoData = paths.some((p) => p.noData);

  return (
    <figure className="flex flex-col items-center mt-12">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full max-w-[400px]"
        role="img"
        aria-label={`Map of California counties shaded by share of land in drought for the week of ${weekStart}. Details per county are in the hardest-hit list below.`}
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
      </svg>
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
      </figcaption>
    </figure>
  );
}
