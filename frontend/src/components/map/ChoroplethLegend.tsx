import { useLayersState } from "../../hooks/useLayersState";
import { MEASURES, type MeasureKey } from "../../lib/choropleth/measures";
import { getPalette } from "../../lib/choropleth/palettes";
import { useIsDark } from "../../context/ThemeContext";

type Props = {
  /** From useChoroplethData.demographicsAvailable — when false,
   *  per-capita measures are disabled in the dropdown. */
  demographicsAvailable: boolean;
  /** From useChoroplethData.isLoading. When true, the color bar shows a
   *  pulsing skeleton so users understand data is still arriving. */
  isLoading?: boolean;
  /** From useChoroplethData.isError. When true, the legend surfaces an
   *  inline error message with a retry callback. */
  isError?: boolean;
  onRetry?: () => void;
};

export default function ChoroplethLegend({ demographicsAvailable, isLoading, isError, onRetry }: Props) {
  const { choroplethOn, measure, palette, bucketEdges, setMeasure } = useLayersState();
  const isDark = useIsDark();

  if (!choroplethOn) return null;

  const colors = getPalette(palette, isDark);
  const activeMeasure = MEASURES[measure];

  return (
    <div
      data-testid="choropleth-legend"
      className="absolute bottom-4 right-4 z-20 bg-surface-container-lowest/95 backdrop-blur-md rounded-xl p-3 w-[220px] ghost-border"
    >
      <label
        className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2"
        htmlFor="choropleth-measure"
      >
        Measure
      </label>
      <select
        id="choropleth-measure"
        className="w-full text-sm font-semibold text-on-surface bg-transparent mb-3 focus:outline-none"
        value={measure}
        onChange={(e) => setMeasure(e.target.value as MeasureKey)}
      >
        {Object.values(MEASURES).map((m) => (
          <option
            key={m.key}
            value={m.key}
            disabled={m.kind === "perCapita" && !demographicsAvailable}
          >
            {m.label}
          </option>
        ))}
      </select>

      <div className={`flex h-3 rounded-sm overflow-hidden ${isLoading ? "animate-pulse opacity-40" : ""}`}>
        {colors.map((c, i) => (
          <div key={i} className="flex-1" style={{ backgroundColor: c }} />
        ))}
      </div>

      {isLoading ? (
        <div className="text-[10px] text-on-surface-variant mt-1 italic">
          Loading data…
        </div>
      ) : bucketEdges ? (
        <div className="flex justify-between text-[10px] text-on-surface-variant mt-1 font-mono">
          {bucketEdges.map((e, i) => (
            <span key={i}>{activeMeasure.formatLabel(e)}</span>
          ))}
        </div>
      ) : (
        <div className="text-[10px] text-on-surface-variant mt-1 italic">
          Pan or zoom out to compute scale
        </div>
      )}

      {isError && (
        <div role="alert" className="text-[10px] text-error mt-2 flex justify-between items-center">
          <span>Couldn't load data</span>
          {onRetry && (
            <button onClick={onRetry} className="underline font-semibold">
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}
