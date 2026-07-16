import { Link } from "react-router-dom";
import Sparkline from "../charts/Sparkline";
import DroughtMap from "./DroughtMap";
import { slugify } from "../../hooks/useFilterParams";
import {
  inDroughtPct,
  severePct,
  useCountyNames,
  useDroughtSeries,
  useDroughtSnapshot,
  type DroughtPcts,
} from "../../hooks/useDroughtData";

/** USDM severity classes in draw order. "None" wears a neutral surface
 * tone; D0–D4 climb the validated sequential ramp. Identity is never
 * color-alone: the legend and per-row text carry the labels. */
const CLASSES = [
  { key: "none_pct", label: "No drought", color: "rgb(var(--surface-container-highest))" },
  { key: "d0_pct", label: "D0 Abnormally dry", color: "rgb(var(--drought-d0))" },
  { key: "d1_pct", label: "D1 Moderate", color: "rgb(var(--drought-d1))" },
  { key: "d2_pct", label: "D2 Severe", color: "rgb(var(--drought-d2))" },
  { key: "d3_pct", label: "D3 Extreme", color: "rgb(var(--drought-d3))" },
  { key: "d4_pct", label: "D4 Exceptional", color: "rgb(var(--drought-d4))" },
] as const;

interface SeverityBarProps {
  pcts: DroughtPcts;
  label: string;
  height?: string;
}

/** 100%-stacked severity bar. Segments keep a 2px surface gap; each
 * segment carries a native tooltip, and the group is one labeled img. */
export function SeverityBar({ pcts, label, height = "h-2" }: SeverityBarProps) {
  const segments = CLASSES.map((c) => ({ ...c, value: pcts[c.key] })).filter(
    (s) => s.value >= 0.5,
  );
  const description = segments
    .map((s) => `${s.label}: ${s.value.toFixed(0)}%`)
    .join(", ");

  return (
    <div
      role="img"
      aria-label={`${label} — ${description}`}
      className={`flex w-full ${height} gap-0.5`}
    >
      {segments.map((s) => (
        <div
          key={s.key}
          title={`${s.label}: ${s.value.toFixed(1)}%`}
          className="rounded-full min-w-1"
          style={{ width: `${s.value}%`, backgroundColor: s.color }}
        />
      ))}
    </div>
  );
}

export default function DroughtSection() {
  const { data: snapshot, isLoading, isError } = useDroughtSnapshot();
  const countyNames = useCountyNames();
  // Fetch the trend only once we know the section will render.
  const { data: series } = useDroughtSeries(104, !!snapshot);
  const trend = (series ?? []).map(inDroughtPct);

  // A failed fetch is not the same as "no data loaded yet" (404 → null):
  // the section must not silently vanish on an outage.
  if (isError) {
    return (
      <section aria-label="Drought conditions" className="mt-20">
        <p role="alert" className="text-center text-error py-8">
          Couldn&rsquo;t load drought conditions. Please try again shortly.
        </p>
      </section>
    );
  }

  // No data yet (or still loading) — the page reads fine without this
  // section, so it simply doesn't render.
  if (isLoading || !snapshot) return null;

  const statewide = snapshot.statewide;
  const drought = inDroughtPct(statewide);
  const hardestHit = [...snapshot.counties]
    .filter((c) => inDroughtPct(c) >= 0.5)
    .sort(
      (a, b) => severePct(b) - severePct(a) || inDroughtPct(b) - inDroughtPct(a),
    )
    .slice(0, 8);

  return (
    <section aria-label="Drought conditions" className="mt-20">
      <span className="font-label text-xs uppercase tracking-[0.3em] text-on-surface-variant block text-center">
        US Drought Monitor · week of {snapshot.week_start}
      </span>
      <h2 className="font-headline text-3xl md:text-4xl font-bold tracking-tighter text-on-surface text-center mt-4">
        {drought >= 0.5
          ? `${drought.toFixed(0)}% of California is in drought`
          : "California is drought-free this week"}
      </h2>
      <p className="text-on-surface-variant text-center mt-3 max-w-xl mx-auto">
        Share of land area in each severity class, weighted by county area.
        {statewide.d0_pct >= 0.5 &&
          ` A further ${statewide.d0_pct.toFixed(0)}% is abnormally dry (D0).`}
      </p>

      <div className="max-w-2xl mx-auto mt-8">
        <SeverityBar pcts={statewide} label="Statewide drought severity" height="h-3" />
        {/* Legend — identity by label, never color alone */}
        <ul
          aria-label="Severity legend"
          className="flex flex-wrap justify-center gap-x-5 gap-y-2 mt-4"
        >
          {CLASSES.map((c) => (
            <li key={c.key} className="flex items-center gap-1.5 text-xs text-on-surface-variant">
              <span
                aria-hidden="true"
                className="inline-block w-2.5 h-2.5 rounded-sm"
                style={{ backgroundColor: c.color }}
              />
              {c.label}
              <span className="text-on-surface font-medium">
                {statewide[c.key].toFixed(0)}%
              </span>
            </li>
          ))}
        </ul>
      </div>

      {trend.length > 1 && (
        <div className="max-w-2xl mx-auto mt-10 text-center">
          <Sparkline
            data={trend}
            width={320}
            height={48}
            showEndDot
            label={`Share of California in drought over the past ${trend.length} weeks`}
          />
          <p className="text-[10px] text-on-surface-variant uppercase tracking-widest mt-2">
            % in drought · past {trend.length} weeks
          </p>
        </div>
      )}

      <DroughtMap counties={snapshot.counties} weekStart={snapshot.week_start} />

      {hardestHit.length > 0 && (
        <div className="max-w-2xl mx-auto mt-12">
          <h3 className="font-label text-xs uppercase tracking-[0.2em] text-on-surface-variant mb-4">
            Hardest-hit counties
          </h3>
          <ul className="space-y-3">
            {hardestHit.map((c) => {
              const name = countyNames?.get(c.county_code);
              return (
                <li key={c.county_code} className="grid grid-cols-[9rem_1fr_3.5rem] items-center gap-3">
                  {name ? (
                    // Same ?county= deep link the Stats page uses — the map
                    // focuses the county and opens its insight card.
                    <Link
                      to={`/?county=${slugify(name)}`}
                      title={`View ${name} County on the map`}
                      className="text-sm text-on-surface truncate hover:text-primary hover:underline transition-colors"
                    >
                      {name}
                    </Link>
                  ) : (
                    <span className="text-sm text-on-surface truncate">
                      County {c.county_code}
                    </span>
                  )}
                  <SeverityBar
                    pcts={c}
                    label={`${name ?? `County ${c.county_code}`} drought severity`}
                  />
                  <span className="text-xs text-on-surface-variant text-right tabular-nums">
                    {inDroughtPct(c).toFixed(0)}%
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-[10px] text-on-surface-variant uppercase tracking-widest mt-3 text-right">
            % of county in drought (D1+)
          </p>
        </div>
      )}

      <p className="text-xs text-on-surface-variant text-center mt-10">
        Source: US Drought Monitor, produced by the National Drought Mitigation
        Center, USDA, and NOAA. Map courtesy of NDMC.
      </p>
    </section>
  );
}
