import { useLayersState, type HeatmapResolution } from "../../hooks/useLayersState";
import { getPalette } from "../../lib/choropleth/palettes";
import { useIsDark } from "../../context/ThemeContext";

type Props = {
  totalCrashes: number | null;
  displayed: number | null;
  isLoading: boolean;
  searchOpen?: boolean;
};

const RESOLUTION_LABEL: Record<HeatmapResolution, string> = {
  raw: "Raw",
  low: "Low",
  medium: "Medium",
  high: "High",
};

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

export default function StatewideHeatmapCard({ totalCrashes, displayed, isLoading, searchOpen }: Props) {
  const { palette, heatmapResolution } = useLayersState();
  const isDark = useIsDark();
  const colors = getPalette(palette, isDark);

  const sampled = totalCrashes != null && displayed != null && displayed < totalCrashes;

  return (
    <div
      data-testid="statewide-heatmap-card"
      className={`absolute z-20 bg-surface-container-lowest/95 backdrop-blur-md rounded-xl p-2 md:p-3 w-[200px] md:w-[250px] ghost-border transition-all duration-300 top-16 left-2 md:top-2 md:left-auto md:right-4 ${searchOpen ? "hidden md:block" : ""}`}
    >
      <span className="text-[9px] md:text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2 block">
        Statewide Heatmap
      </span>

      <div className={`flex h-3 rounded-sm overflow-hidden ${isLoading ? "animate-pulse opacity-40" : ""}`}>
        {colors.map((c, i) => (
          <div key={i} className="flex-1" style={{ backgroundColor: c }} />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-on-surface-variant mt-1 font-mono">
        <span>Low</span>
        <span>High</span>
      </div>

      <div className="text-[10px] text-on-surface-variant mt-2 leading-snug">
        {isLoading ? (
          <span className="italic">Loading heatmap…</span>
        ) : totalCrashes == null || totalCrashes === 0 ? (
          <span className="italic">No crashes for current filters</span>
        ) : sampled ? (
          <>
            <span className="font-mono font-semibold">{formatCount(displayed!)}</span>
            {" of "}
            <span className="font-mono font-semibold">{formatCount(totalCrashes)}</span>
            {" mapped"}
          </>
        ) : (
          <>
            <span className="font-mono font-semibold">{formatCount(totalCrashes)}</span>
            {" mapped"}
          </>
        )}
      </div>

      <div className="text-[10px] text-on-surface-variant mt-1">
        Resolution:{" "}
        <span className="font-semibold text-on-surface">{RESOLUTION_LABEL[heatmapResolution]}</span>
      </div>
    </div>
  );
}
