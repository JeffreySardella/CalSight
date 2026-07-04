import { useEffect } from "react";
import { useLayersState } from "../../hooks/useLayersState";
import { MEASURES } from "../../lib/choropleth/measures";
import { PALETTES, getPalette, type PaletteKey } from "../../lib/choropleth/palettes";
import type { HighwaySort } from "../../hooks/useHighwayRankings";
import { useIsDark } from "../../context/ThemeContext";

const HIGHWAY_METRICS: { key: HighwaySort; label: string }[] = [
  { key: "fatality_rate", label: "Fatality Rate" },
  { key: "crash_count", label: "Total Crashes" },
  { key: "crashes_per_mile", label: "Per Mile" },
];

interface ToggleProps {
  enabled: boolean;
  onToggle: () => void;
  /** Accessible name — mirrors the visible row label next to the toggle. */
  label: string;
  /** When locked the toggle can't be flipped; announced via aria-disabled. */
  locked?: boolean;
  /** Screen-reader-only explanation of why the toggle is locked. */
  lockedHint?: string;
}

function Toggle({ enabled, onToggle, label, locked = false, lockedHint }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      aria-disabled={locked || undefined}
      onClick={onToggle}
      className={`w-8 h-4 rounded-full relative transition-colors ${
        enabled ? "bg-primary" : "bg-surface-container-high"
      }`}
    >
      <div
        className={`absolute top-0.5 w-3 h-3 bg-surface-container-lowest rounded-full transition-all ${
          enabled ? "right-0.5" : "left-0.5"
        }`}
      />
      {locked && lockedHint && <span className="sr-only">{lockedHint}</span>}
    </button>
  );
}

const PALETTE_LABELS: Record<PaletteKey, string> = {
  default: "Default",
  warm: "Warm",
  cool: "Cool",
  colorblind: "Colorblind Safe",
};

export default function LayersPanel() {
  const {
    choroplethOn, setChoroplethOn,
    measure, setMeasure,
    palette: activePalette, setPalette,
    otherLayers, toggleOtherLayer, setOtherLayer,
    highwayMetric, setHighwayMetric,
    heatmapResolution, setHeatmapResolution,
    reset,
  } = useLayersState();
  const isDark = useIsDark();

  useEffect(() => {
    function handleReset() {
      reset();
    }
    window.addEventListener("layers:reset-defaults", handleReset);
    return () => window.removeEventListener("layers:reset-defaults", handleReset);
  }, [reset]);

  // At least one of choroplethOn / heatmapStatewide must always be active.
  // If one is the sole active layer, its toggle is locked (can't be turned off).
  const choroplethLocked = choroplethOn && !otherLayers.heatmapStatewide;
  const heatmapStatewideL = !choroplethOn && otherLayers.heatmapStatewide;

  return (
    <div className="space-y-8 pb-32 px-0">
      {/* County Colors */}
      <div className="space-y-4">
        <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body">
          County Colors
        </span>
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className={`text-sm font-medium ${choroplethOn ? "text-on-surface" : "text-on-surface-variant"}`}>
              Shade by Measure
            </span>
            <div className="relative">
              <Toggle
                enabled={choroplethOn}
                label="Shade by Measure"
                locked={choroplethLocked}
                lockedHint="At least one base layer must be active. Enable Statewide Heatmap first to turn this off."
                onToggle={() => {
                  if (choroplethLocked) return;
                  const next = !choroplethOn;
                  setChoroplethOn(next);
                  if (next) setOtherLayer("heatmapStatewide", false);
                }}
              />
              {choroplethLocked && (
                <span
                  aria-hidden="true"
                  title="At least one base layer must be active"
                  className="absolute inset-0 cursor-not-allowed rounded-full"
                />
              )}
            </div>
          </div>
          {choroplethLocked && (
            <p className="text-[10px] text-on-surface-variant/60 leading-tight pl-1 italic">
              Enable Statewide Heatmap first to turn this off
            </p>
          )}
          {choroplethOn && (
            <p className="text-[10px] text-on-surface-variant leading-tight pl-1">
              Colors each county by the selected measure below
            </p>
          )}
        </div>
      </div>

      {/* Crash Heatmap */}
      <div className="space-y-4">
        <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body">
          Crash Heatmap
        </span>
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className={`text-sm font-medium ${otherLayers.heatmapStatewide ? "text-on-surface" : "text-on-surface-variant"}`}>
              Statewide
            </span>
            <div className="relative">
              <Toggle
                enabled={otherLayers.heatmapStatewide}
                label="Statewide"
                locked={heatmapStatewideL}
                lockedHint="At least one base layer must be active. Enable County Colors first to turn this off."
                onToggle={() => {
                  if (heatmapStatewideL) return;
                  const next = !otherLayers.heatmapStatewide;
                  setOtherLayer("heatmapStatewide", next);
                  if (next) setChoroplethOn(false);
                  else setChoroplethOn(true);
                }}
              />
              {heatmapStatewideL && (
                <span
                  aria-hidden="true"
                  title="At least one base layer must be active"
                  className="absolute inset-0 cursor-not-allowed rounded-full"
                />
              )}
            </div>
          </div>
          {heatmapStatewideL && (
            <p className="text-[10px] text-on-surface-variant/60 leading-tight pl-1 italic">
              Enable County Colors first to turn this off
            </p>
          )}
          {otherLayers.heatmapStatewide && (
            <div className="space-y-2 pl-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                Resolution
              </span>
              <div className="flex gap-1.5" role="group" aria-label="Heatmap resolution">
                {([
                  { key: "low" as const, label: "Low" },
                  { key: "medium" as const, label: "Medium" },
                ]).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setHeatmapResolution(key)}
                    aria-pressed={heatmapResolution === key}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                      heatmapResolution === key
                        ? "bg-primary text-on-primary"
                        : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-on-surface-variant leading-tight">
                Higher resolution shows finer detail but loads slower
              </p>
            </div>
          )}
          <div className="flex justify-between items-center">
            <span className={`text-sm font-medium ${otherLayers.heatmapCounty ? "text-on-surface" : "text-on-surface-variant"}`}>
              County Detail
            </span>
            <Toggle enabled={otherLayers.heatmapCounty} label="County Detail" onToggle={() => toggleOtherLayer("heatmapCounty")} />
          </div>
          {otherLayers.heatmapCounty && (
            <p className="text-[10px] text-on-surface-variant leading-tight pl-1">
              Shows individual crash locations when you click a county
            </p>
          )}
          <div className="flex justify-between items-center">
            <span className={`text-sm font-medium ${otherLayers.coordMismatches ? "text-on-surface" : "text-on-surface-variant"}`}>
              Coord Mismatches
            </span>
            <Toggle enabled={otherLayers.coordMismatches} label="Coord Mismatches" onToggle={() => toggleOtherLayer("coordMismatches")} />
          </div>
          {otherLayers.coordMismatches && (
            <p className="text-[10px] text-on-surface-variant leading-tight pl-1">
              Shows crashes whose lat/lng falls outside their assigned county (requires county selected)
            </p>
          )}
          <div className="flex justify-between items-center">
            <span className={`text-sm font-medium ${otherLayers.coordIncludeRivers ? "text-on-surface" : "text-on-surface-variant"}`}>
              Hide River Crashes
            </span>
            <Toggle enabled={otherLayers.coordIncludeRivers} label="Hide River Crashes" onToggle={() => toggleOtherLayer("coordIncludeRivers")} />
          </div>
          {otherLayers.coordIncludeRivers && (
            <p className="text-[10px] text-on-surface-variant leading-tight pl-1">
              Excludes crashes over rivers and small water bodies from the heatmap
            </p>
          )}
        </div>
      </div>

      {/* Highways */}
      <div className="space-y-4">
        <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body">
          Highways
        </span>
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className={`text-sm font-medium ${otherLayers.highwayDanger ? "text-on-surface" : "text-on-surface-variant"}`}>
              Highway Danger
            </span>
            <Toggle
              enabled={otherLayers.highwayDanger}
              label="Highway Danger"
              onToggle={() => toggleOtherLayer("highwayDanger")}
            />
          </div>
          {otherLayers.highwayDanger ? (
            <div className="space-y-2 pl-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                Color By
              </span>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Highway color metric">
                {HIGHWAY_METRICS.map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setHighwayMetric(key)}
                    aria-pressed={highwayMetric === key}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                      highwayMetric === key
                        ? "bg-primary text-on-primary"
                        : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-on-surface-variant leading-tight">
                Colors state highways by crash danger. Click a route for its stats.
              </p>
            </div>
          ) : (
            <p className="text-[10px] text-on-surface-variant leading-tight pl-1">
              Draws California state highways colored by crash danger
            </p>
          )}
        </div>
      </div>

      {/* Intersections */}
      <div className="space-y-4">
        <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body">
          Intersections
        </span>
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className={`text-sm font-medium ${otherLayers.topIntersections ? "text-on-surface" : "text-on-surface-variant"}`}>
              Top intersections
            </span>
            <Toggle
              enabled={otherLayers.topIntersections}
              onToggle={() => toggleOtherLayer("topIntersections")}
              label="Top intersections"
            />
          </div>
          <p className="text-[10px] text-on-surface-variant leading-tight pl-1">
            {otherLayers.topIntersections
              ? "Plots the top intersections by severity score. Click a marker for its stats."
              : "Ranked by severity"}
          </p>
        </div>
      </div>

      {/* Measure */}
      <div className="space-y-4">
        <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body">
          Measure
        </span>
        <div className="space-y-2" role="group" aria-label="Measure">
          {Object.values(MEASURES).map((m) => {
            const active = measure === m.key;
            return (
              <button
                key={m.key}
                onClick={() => setMeasure(m.key)}
                aria-pressed={active}
                className="flex items-center gap-3 w-full text-left cursor-pointer"
              >
                <span className={`w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center transition-colors ${
                  active ? "bg-primary" : "bg-surface-container-high"
                }`}>
                  {active && <span className="w-1.5 h-1.5 rounded-full bg-on-primary" />}
                </span>
                <span className={`text-sm ${active ? "text-on-surface font-medium" : "text-on-surface-variant"}`}>
                  {m.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>


      {/* Color Palette */}
      <div className="space-y-4">
        <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body">
          Color Palette
        </span>
        <div className="grid grid-cols-2 gap-3" role="group" aria-label="Color palette">
          {(Object.keys(PALETTES) as PaletteKey[]).map((key) => (
            <button
              key={key}
              onClick={() => setPalette(key)}
              aria-pressed={activePalette === key}
              className={`p-2 rounded-xl text-left transition-all ${
                activePalette === key ? "bg-primary-container" : "hover:bg-surface-container"
              }`}
            >
              <div
                className="h-12 w-full rounded-lg mb-2"
                style={{ background: `linear-gradient(to right, ${getPalette(key, isDark).join(", ")})` }}
              />
              <span className={`text-[10px] font-semibold block text-center ${
                activePalette === key ? "text-on-primary-container" : "text-on-surface-variant"
              }`}>
                {PALETTE_LABELS[key]}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function LayersPanelFooter() {
  return (
    <button
      onClick={() => {
        window.dispatchEvent(new CustomEvent("layers:reset-defaults"));
      }}
      className="w-full bg-surface-container-high text-on-surface-variant py-4 rounded-md text-[11px] font-bold tracking-[0.2em] uppercase hover:opacity-90 transition-all"
    >
      Reset to Defaults
    </button>
  );
}
