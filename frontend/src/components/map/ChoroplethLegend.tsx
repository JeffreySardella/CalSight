import { useState, useRef, useEffect } from "react";
import { useLayersState } from "../../hooks/useLayersState";
import { MEASURES } from "../../lib/choropleth/measures";
import { getPalette, type PaletteKey } from "../../lib/choropleth/palettes";
import { useIsDark } from "../../context/ThemeContext";


const MISMATCH_DOT_COLORS: Record<PaletteKey, string> = {
  default: "#f97316",
  warm: "#a78bfa",
  cool: "#fb7185",
  colorblind: "#17becf",
};
import type { DataSummary } from "../../hooks/useChoroplethData";
import type { CoordCoverage } from "../../hooks/useCoordCoverage";
import { useCoordValidation } from "../../hooks/useCoordValidation";

type Props = {
  demographicsAvailable: boolean;
  dataSummary?: DataSummary;
  coordCoverage?: CoordCoverage | null;
  isLoading?: boolean;
  isError?: boolean;
  is422?: boolean;
  searchOpen?: boolean;
  onRetry?: () => void;
  heatmapCrashes?: number | null;
  heatmapDisplayed?: number | null;
  heatmapLoading?: boolean;
  countyActive?: boolean;
  countyTotalCrashes?: number | null;
  mismatchCount?: number | null;
};

function formatYearList(years: number[]): string {
  if (years.length <= 2) return years.join(", ");
  const sorted = [...years].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (last - first + 1 === sorted.length) return `${first}-${last}`;
  return sorted.join(", ");
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

const EMPTY_SUMMARY: DataSummary = { totalCrashes: 0, missingDemoYears: [], partialDemoYears: [], sparseYears: [] };

export default function ChoroplethLegend({ demographicsAvailable, dataSummary = EMPTY_SUMMARY, coordCoverage, isLoading, isError, is422, searchOpen, onRetry, heatmapCrashes, heatmapDisplayed, heatmapLoading, countyActive, countyTotalCrashes, mismatchCount }: Props) {
  const { choroplethOn, measure, palette, bucketEdges, setMeasure } = useLayersState();
  const coordValidation = useCoordValidation();
  const isDark = useIsDark();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const [mobileExpanded, setMobileExpanded] = useState(false);

  if (!choroplethOn && !countyActive) return null;

  const colors = getPalette(palette, isDark);
  const activeMeasure = MEASURES[measure];
  const allMeasures = Object.values(MEASURES);

  return (
    <div
      data-testid="choropleth-legend"
      className={`absolute z-20 bg-surface-container-lowest/95 backdrop-blur-md rounded-xl p-2 md:p-3 w-[200px] md:w-[250px] ghost-border transition-all duration-300 top-3 left-2 md:top-2 md:left-auto md:right-4 ${searchOpen ? "hidden md:block" : ""}`}
    >
      {countyActive ? (
        <span className="text-[9px] font-bold uppercase tracking-widest text-on-surface-variant mb-1 block">
          Crash Detail
        </span>
      ) : (
        <>
          <div
            role="button"
            tabIndex={0}
            className="md:hidden flex items-center justify-between mb-1 cursor-pointer"
            onClick={() => setMobileExpanded((v) => !v)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setMobileExpanded((v) => !v); } }}
            aria-expanded={mobileExpanded}
          >
            <span className="text-[9px] font-bold uppercase tracking-widest text-on-surface-variant">{activeMeasure.label}</span>
            <span className="material-symbols-outlined text-[14px] text-on-surface-variant transition-transform" style={{ transform: mobileExpanded ? "rotate(180deg)" : undefined }}>
              expand_less
            </span>
          </div>
          <span
            className="hidden md:block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2"
            id="choropleth-measure-label"
          >
            Measure
          </span>
        </>
      )}
      <div ref={containerRef} className={`relative mb-3 ${countyActive ? "hidden" : mobileExpanded ? "" : "hidden md:block"}`}>
        <button
          type="button"
          aria-labelledby="choropleth-measure-label"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          onClick={() => setIsOpen((v) => !v)}
          className="w-full flex items-center justify-between text-sm font-semibold text-on-surface bg-surface-container-high rounded-lg py-2 px-3 cursor-pointer hover:bg-surface-variant transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <span>{activeMeasure.label}</span>
          <span className={`material-symbols-outlined text-[16px] text-on-surface-variant transition-transform ${isOpen ? "rotate-180" : ""}`}>
            expand_more
          </span>
        </button>

        {isOpen && (
          <div
            role="listbox"
            aria-labelledby="choropleth-measure-label"
            className="absolute z-50 left-0 right-0 top-full mt-1 bg-surface-container-lowest rounded-lg shadow-lg border border-outline-variant/15 overflow-y-auto max-h-[50vh]"
          >
            {allMeasures.map((m) => {
              const isSelected = m.key === measure;
              const needsDemo = m.kind === "perCapita" || m.kind === "perIncome" || m.kind === "demographic" || m.kind === "crashDemographic";
              const isDisabled = needsDemo && !demographicsAvailable;
              return (
                <button
                  key={m.key}
                  role="option"
                  aria-selected={isSelected}
                  disabled={isDisabled}
                  onClick={() => {
                    setMeasure(m.key);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm text-left transition-colors ${
                    isDisabled
                      ? "opacity-40 cursor-not-allowed"
                      : "hover:bg-surface-container cursor-pointer"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`material-symbols-outlined text-[16px] ${
                      isSelected ? "text-primary" : "text-transparent"
                    }`}
                  >
                    check
                  </span>
                  <span className={isSelected ? "text-on-surface font-medium" : "text-on-surface-variant"}>
                    {m.label}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {!countyActive ? (
        <div className={`flex h-3 rounded-sm overflow-hidden ${isLoading ? "animate-pulse opacity-40" : ""}`}>
          {colors.map((c, i) => (
            <div key={i} className="flex-1" style={{ backgroundColor: c }} />
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colors[colors.length - 1] }} />
            <span className="text-[10px] text-on-surface-variant font-semibold">Crash</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#dc2626" }} />
            <span className="text-[10px] text-on-surface-variant font-semibold">Fatal</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#f59e0b" }} />
            <span className="text-[10px] text-on-surface-variant font-semibold">Injury</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#6b7280" }} />
            <span className="text-[10px] text-on-surface-variant font-semibold" title="Property Damage Only">PDO</span>
          </div>
          {mismatchCount != null && mismatchCount > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: MISMATCH_DOT_COLORS[palette] }} />
              <span className="text-[10px] text-on-surface-variant font-semibold">Mismatched</span>
            </div>
          )}
        </div>
      )}

      {/* Statewide summary — hide when county focused */}
      {!mobileExpanded && !isLoading && dataSummary.totalCrashes > 0 && !countyActive && (
        <div className="md:hidden text-[10px] text-on-surface-variant mt-1 font-mono font-semibold">
          {formatCount(dataSummary.totalCrashes)} crashes
        </div>
      )}

      {(heatmapLoading || (heatmapCrashes != null && heatmapCrashes > 0)) && (
        <div className="text-[10px] text-on-surface-variant mt-1 font-mono font-semibold">
          {heatmapLoading
            ? "Loading heatmap..."
            : countyActive && countyTotalCrashes && heatmapDisplayed != null
              ? `${formatCount(heatmapDisplayed)} mapped (${Math.round((heatmapDisplayed / countyTotalCrashes) * 100)}%)${mismatchCount ? ` · ${formatCount(mismatchCount)} bad coords` : ""}`
              : heatmapDisplayed != null && heatmapDisplayed < heatmapCrashes!
                ? `${formatCount(heatmapDisplayed)} of ${formatCount(heatmapCrashes!)} mapped`
                : `${formatCount(heatmapCrashes!)} mapped`}
        </div>
      )}

      {/* Bucket labels — hide when county heatmap active */}
      {!countyActive && (
        <div className={mobileExpanded ? "" : "hidden md:block"}>
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
        </div>
      )}

      {!countyActive && activeMeasure.kind === "perCapita" && (dataSummary.missingDemoYears.length > 0 || dataSummary.partialDemoYears.length > 0) && (
        <div role="alert" className="bg-red-500/15 rounded-md px-2 py-1.5 mt-1.5 text-[10px] text-red-600 dark:text-red-400 font-semibold">
          {dataSummary.missingDemoYears.length > 0 && (
            <div>No census data for {formatYearList(dataSummary.missingDemoYears)}</div>
          )}
          <button
            className="block mt-1 underline"
            onClick={() => setMeasure("crashes_raw")}
          >
            Switch to Total Crashes
          </button>
        </div>
      )}

      <div className={mobileExpanded ? "" : "hidden md:block"}>
      {!countyActive && !isLoading && dataSummary.totalCrashes > 0 && (
        <div data-testid="data-summary" className="text-[11px] sm:text-[10px] text-on-surface-variant mt-2 leading-snug">
          <span className="font-mono font-semibold">{formatCount(dataSummary.totalCrashes)}</span> crashes

          {coordValidation && coordValidation.mismatched > 0 && (
            <div className="mt-0.5 text-[10px] text-on-surface-variant">
              <span className="font-mono">{formatCount(coordValidation.mismatched)}</span> audited outside county
            </div>
          )}
          {coordCoverage && (
            <div className="mt-0.5 text-[10px]">
              <span className="font-mono">{formatCount(coordCoverage.mapped - (coordValidation?.mismatched ?? 0))}</span> of{" "}
              <span className="font-mono">{formatCount(coordCoverage.total)}</span> mapped (
              <span className="font-mono">{Math.round((coordCoverage.mapped - (coordValidation?.mismatched ?? 0)) / coordCoverage.total * 100)}%</span>)
            </div>
          )}

          {dataSummary.sparseYears.length > 0 && (
            <div className="mt-1">
              {dataSummary.sparseYears.map((s) => (
                <div key={s.year}>
                  {s.year}: {s.count.toLocaleString()} crashes (in progress)
                </div>
              ))}
            </div>
          )}

        </div>
      )}

      {is422 && (
        <div role="status" className="text-[10px] text-on-surface-variant mt-2 flex items-center gap-1">
          <span className="material-symbols-outlined text-[12px]">warning</span>
          <span>A filter value was rejected — showing last good result</span>
        </div>
      )}

      {isError && !is422 && (
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
    </div>
  );
}
