import { useState, useRef, useEffect } from "react";
import { useLayersState } from "../../hooks/useLayersState";
import { MEASURES } from "../../lib/choropleth/measures";
import { getPalette } from "../../lib/choropleth/palettes";
import { useIsDark } from "../../context/ThemeContext";

type Props = {
  demographicsAvailable: boolean;
  isLoading?: boolean;
  isError?: boolean;
  is422?: boolean;
  searchOpen?: boolean;
  onRetry?: () => void;
};

export default function ChoroplethLegend({ demographicsAvailable, isLoading, isError, is422, searchOpen, onRetry }: Props) {
  const { choroplethOn, measure, palette, bucketEdges, setMeasure } = useLayersState();
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

  if (!choroplethOn) return null;

  const colors = getPalette(palette, isDark);
  const activeMeasure = MEASURES[measure];
  const allMeasures = Object.values(MEASURES);

  return (
    <div
      data-testid="choropleth-legend"
      className={`absolute right-4 z-20 bg-surface-container-lowest/95 backdrop-blur-md rounded-xl p-3 w-[220px] ghost-border transition-all duration-300 ${searchOpen ? "bottom-24 md:bottom-4" : "bottom-4"}`}
    >
      <label
        className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2"
        id="choropleth-measure-label"
      >
        Measure
      </label>
      <div ref={containerRef} className="relative mb-3">
        <button
          type="button"
          aria-labelledby="choropleth-measure-label"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          onClick={() => setIsOpen((v) => !v)}
          className="w-full flex items-center justify-between text-sm font-semibold text-on-surface bg-surface-container-high rounded-lg py-2 px-3 cursor-pointer hover:bg-surface-variant transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <span className="truncate">{activeMeasure.label}</span>
          <span className={`material-symbols-outlined text-[16px] text-on-surface-variant transition-transform ${isOpen ? "rotate-180" : ""}`}>
            expand_more
          </span>
        </button>

        {isOpen && (
          <div
            role="listbox"
            aria-labelledby="choropleth-measure-label"
            className="absolute z-50 left-0 right-0 bottom-full mb-1 bg-surface-container-lowest rounded-lg shadow-lg border border-outline-variant/15 overflow-hidden"
          >
            {allMeasures.map((m) => {
              const isSelected = m.key === measure;
              const isDisabled = m.kind === "perCapita" && !demographicsAvailable;
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
  );
}
