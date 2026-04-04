import { useState } from "react";
import { YEARS, CA_COUNTIES, CAUSES } from "../../hooks/useFilterParams";
import SearchableMultiSelect from "../ui/SearchableMultiSelect";

const SEVERITIES = ["Fatal", "Severe Injury", "Minor Injury", "Property Damage Only"] as const;

const DISPLAY_YEAR_COUNT = 6;
const displayYears = YEARS.slice(-DISPLAY_YEAR_COUNT);

const countyOptions = [
  { value: "__all__", label: "All Counties (Statewide)" },
  ...CA_COUNTIES.map((c) => ({ value: c, label: c })),
];

interface FiltersPanelProps {
  selectedYears: Set<number>;
  selectedSeverities: Set<string>;
  selectedCounties: Set<string>;
  selectedCauses: Set<string>;
  onToggleYear: (year: number) => void;
  onSetYearRange: (from: number, to: number) => void;
  onClearYears: () => void;
  onToggleSeverity: (severity: string) => void;
  onToggleCounty: (county: string) => void;
  onClearCounties: () => void;
  onToggleCause: (cause: string) => void;
  resetKey?: number;
}

export default function FiltersPanel({
  selectedYears,
  selectedSeverities,
  selectedCounties,
  selectedCauses,
  onToggleYear,
  onSetYearRange,
  onClearYears,
  onToggleSeverity,
  onToggleCounty,
  onClearCounties,
  onToggleCause,
  resetKey = 0,
}: FiltersPanelProps) {
  const [showRange, setShowRange] = useState(false);
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

  const sortedYears = [...selectedYears].sort((a, b) => a - b);

  // Detect if the selected years form a contiguous range (3+ years in a row)
  const isContiguousRange = sortedYears.length >= 3 && sortedYears.every(
    (y, i) => i === 0 || y === sortedYears[i - 1] + 1,
  );
  const rangeLabel = isContiguousRange
    ? `${sortedYears[0]}–${sortedYears[sortedYears.length - 1]}`
    : null;

  function handleRangeSubmit() {
    const a = parseInt(rangeFrom, 10);
    const b = parseInt(rangeTo, 10);
    if (Number.isNaN(a) || Number.isNaN(b)) return;
    const from = Math.min(a, b);
    const to = Math.max(a, b);
    onSetYearRange(from, to);
    setShowRange(false);
    setRangeFrom("");
    setRangeTo("");
  }

  return (
    <div className="space-y-8 pb-32">
      {/* County */}
      <div className="space-y-2">
        <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body">
          County
        </label>
        <SearchableMultiSelect
          options={countyOptions}
          selected={selectedCounties.size === 0 ? new Set(["__all__"]) : selectedCounties}
          onToggle={(value) => {
            if (value === "__all__") {
              onClearCounties();
            } else {
              onToggleCounty(value);
            }
          }}
          placeholder="Search California Counties..."
          resetKey={resetKey}
        />
      </div>

      {/* Year */}
      <div className="space-y-3">
        <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body">
          Year
        </label>

        {showRange ? (
          /* Range input mode */
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="numeric"
                value={rangeFrom}
                onChange={(e) => setRangeFrom(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleRangeSubmit(); }}
                placeholder="From"
                autoFocus
                className="w-20 px-3 py-2.5 rounded-lg text-xs font-semibold bg-surface-container-high text-on-surface border-none focus:ring-2 focus:ring-primary/20 text-center"
              />
              <span className="text-on-surface-variant text-xs">–</span>
              <input
                type="text"
                inputMode="numeric"
                value={rangeTo}
                onChange={(e) => setRangeTo(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleRangeSubmit(); }}
                placeholder="To"
                className="w-20 px-3 py-2.5 rounded-lg text-xs font-semibold bg-surface-container-high text-on-surface border-none focus:ring-2 focus:ring-primary/20 text-center"
              />
              <button
                type="button"
                onClick={handleRangeSubmit}
                className="p-2.5 rounded-lg bg-primary text-on-primary hover:opacity-90 transition-all"
              >
                <span className="material-symbols-outlined text-[18px]">check</span>
              </button>
              <button
                type="button"
                onClick={() => { setShowRange(false); setRangeFrom(""); setRangeTo(""); }}
                className="text-on-surface-variant hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            <p className="text-[10px] text-on-surface-variant">
              e.g. 2001 – 2015
            </p>
          </div>
        ) : rangeLabel ? (
          /* Range pill — click text to edit, click X to clear */
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center bg-primary text-on-primary rounded-full text-xs font-semibold">
              <button
                onClick={() => {
                  setRangeFrom(String(sortedYears[0]));
                  setRangeTo(String(sortedYears[sortedYears.length - 1]));
                  setShowRange(true);
                }}
                className="pl-3 pr-1 py-1.5 hover:opacity-80 transition-opacity"
              >
                {rangeLabel}
              </button>
              <button
                onClick={() => onClearYears()}
                className="pr-2.5 pl-0.5 py-1.5 hover:opacity-70 transition-opacity"
              >
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            </span>
          </div>
        ) : (
          /* Quick pick mode — individual year pills */
          <div className="flex flex-wrap gap-2">
            {displayYears.map((year) => (
              <button
                key={year}
                onClick={() => onToggleYear(year)}
                className={
                  selectedYears.has(year)
                    ? "px-3 py-1.5 rounded-full text-xs font-semibold bg-primary text-on-primary transition-all"
                    : "px-3 py-1.5 rounded-full text-xs font-semibold bg-surface-container-high text-on-surface-variant hover:bg-surface-variant transition-all"
                }
              >
                {year}
              </button>
            ))}
            <button
              onClick={() => setShowRange(true)}
              className="px-3 py-1.5 rounded-full text-xs font-semibold bg-surface-container-high text-on-surface-variant hover:bg-surface-variant transition-all border border-dashed border-outline-variant"
            >
              Range
            </button>
          </div>
        )}
      </div>

      {/* Cause Type */}
      <div className="space-y-3">
        <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body">
          Cause Type
        </label>
        <div className="flex flex-wrap gap-2">
          {CAUSES.map((cause) => (
            <button
              key={cause.value}
              onClick={() => onToggleCause(cause.value)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                selectedCauses.has(cause.value)
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container-high text-on-surface-variant hover:bg-surface-variant"
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">
                {cause.icon}
              </span>
              {cause.label}
            </button>
          ))}
        </div>
      </div>

      {/* Severity */}
      <div className="space-y-3">
        <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body">
          Severity
        </label>
        <div className="flex flex-wrap gap-2">
          {SEVERITIES.map((severity) => (
            <button
              key={severity}
              onClick={() => onToggleSeverity(severity)}
              className={
                selectedSeverities.has(severity)
                  ? "px-3 py-1.5 rounded-full text-xs font-semibold bg-primary text-on-primary transition-all"
                  : "px-3 py-1.5 rounded-full text-xs font-semibold bg-surface-container-high text-on-surface-variant hover:bg-surface-variant transition-all"
              }
            >
              {severity}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

interface FiltersPanelFooterProps {
  onClear?: () => void;
}

export function FiltersPanelFooter({ onClear }: FiltersPanelFooterProps) {
  return (
    <button
      onClick={() => { if (onClear) onClear(); }}
      className="w-full text-[11px] font-bold uppercase tracking-widest text-on-surface-variant hover:text-on-surface transition-colors underline-offset-4 hover:underline py-4"
    >
      Clear All
    </button>
  );
}
