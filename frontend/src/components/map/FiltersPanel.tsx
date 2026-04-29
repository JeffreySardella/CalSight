import { useState } from "react";
import { YEARS, CA_COUNTIES, CAUSES, SEVERITIES } from "../../hooks/useFilterParams";
import SearchableMultiSelect from "../ui/SearchableMultiSelect";

const DISPLAY_YEAR_COUNT = 6;
const displayYears = YEARS.slice(-DISPLAY_YEAR_COUNT);

const PILL_ACTIVE = "px-3 py-1.5 rounded-full text-xs font-semibold bg-primary text-on-primary transition-all";
const PILL_INACTIVE = "px-3 py-1.5 rounded-full text-xs font-semibold bg-surface-container-high text-on-surface-variant hover:bg-surface-variant transition-all";

const countyOptions = [
  { value: "__all__", label: "All Counties (Statewide)" },
  ...CA_COUNTIES.map((c) => ({ value: c, label: c })),
];

/** Stable reference — avoids creating a new Set on every render. */
const ALL_COUNTIES_SET = new Set(["__all__"]);

interface FiltersPanelProps {
  selectedYears: Set<number>;
  selectedSeverities: Set<string>;
  selectedCounties: Set<string>;
  selectedCauses: Set<string>;
  selectedAlcohol: boolean;
  selectedDistracted: boolean;
  onToggleYear: (year: number) => void;
  onSetYearRange: (from: number, to: number) => void;
  onSetYears?: (years: Set<number>) => void;
  onClearYears: () => void;
  onSetAllYears?: () => void;
  onToggleSeverity: (severity: string) => void;
  onSetSeverities?: (severities: Set<string>) => void;
  onSetAllSeverities?: () => void;
  onClearSeverities?: () => void;
  onToggleCounty: (county: string) => void;
  onClearCounties: () => void;
  onToggleCause: (cause: string) => void;
  onSetCauses?: (causes: Set<string>) => void;
  onSetAllCauses?: () => void;
  onClearCauses?: () => void;
  onToggleAlcohol: () => void;
  onToggleDistracted: () => void;
  resetKey?: number;
}

export default function FiltersPanel({
  selectedYears,
  selectedSeverities,
  selectedCounties,
  selectedCauses,
  onToggleYear,
  onSetYearRange,
  onSetYears,
  onClearYears,
  onSetAllYears,
  onToggleSeverity,
  onSetSeverities,
  onSetAllSeverities,
  onClearSeverities,
  onToggleCounty,
  onClearCounties,
  onToggleCause,
  onSetCauses,
  onSetAllCauses,
  onClearCauses,
  resetKey = 0,
}: FiltersPanelProps) {
  // "range" = from–to input, "custom" = single year input, null = default pill view
  const [inputMode, setInputMode] = useState<"range" | "custom" | null>(null);
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [customInput, setCustomInput] = useState("");

  // Stash previous selections so "All" toggle can restore them
  const [prevYears, setPrevYears] = useState<Set<number> | null>(null);
  const [prevCauses, setPrevCauses] = useState<Set<string> | null>(null);
  const [prevSeverities, setPrevSeverities] = useState<Set<string> | null>(null);

  const allYearsSelected = selectedYears.size === YEARS.length;
  const allCausesSelected = selectedCauses.size === CAUSES.length;
  const allSeveritiesSelected = selectedSeverities.size === SEVERITIES.length;

  function makeAllToggle<T>(
    allSelected: boolean,
    current: Set<T>,
    prev: Set<T> | null,
    setPrev: (s: Set<T> | null) => void,
    setAll: (() => void) | undefined,
    clear: (() => void) | undefined,
    restore: ((s: Set<T>) => void) | undefined,
  ) {
    return () => {
      if (allSelected) {
        if (prev && prev.size > 0 && restore) {
          restore(prev);
        } else if (clear) {
          clear();
        }
        setPrev(null);
      } else {
        setPrev(new Set(current));
        setAll?.();
      }
    };
  }

  const sortedYears = [...selectedYears].sort((a, b) => a - b);
  const displaySet = new Set(displayYears);
  const customYears = sortedYears.filter((y) => !displaySet.has(y));

  function handleRangeSubmit() {
    const a = parseInt(rangeFrom, 10);
    const b = parseInt(rangeTo, 10);
    if (Number.isNaN(a) || Number.isNaN(b)) return;
    onSetYearRange(Math.min(a, b), Math.max(a, b));
    setInputMode(null);
    setRangeFrom("");
    setRangeTo("");
  }

  function handleCustomSubmit() {
    const y = parseInt(customInput, 10);
    if (Number.isNaN(y) || !YEARS.includes(y)) return;
    if (!selectedYears.has(y)) onToggleYear(y);
    setCustomInput("");
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
          selected={selectedCounties.size === 0 ? ALL_COUNTIES_SET : selectedCounties}
          nonDismissableValues={ALL_COUNTIES_SET}
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
        <label className="text-[10px] font-bold uppercase tracking-widest">
          Year
        </label>

        {/* Quick pick pills — always visible unless All is active */}
        <div className="flex flex-wrap gap-2">
          {onSetAllYears && (
            <button
              onClick={makeAllToggle(allYearsSelected, selectedYears, prevYears, setPrevYears, onSetAllYears, onClearYears, onSetYears)}
              className={allYearsSelected ? PILL_ACTIVE : PILL_INACTIVE}
            >
              All
            </button>
          )}
          {!allYearsSelected && (
            <>
              {displayYears.map((year) => (
                <button
                  key={year}
                  onClick={() => onToggleYear(year)}
                  className={
                    selectedYears.has(year)
                      ? PILL_ACTIVE
                      : PILL_INACTIVE
                  }
                >
                  {year}
                </button>
              ))}
            </>
          )}
        </div>

        {/* Custom year pills — removable */}
        {!allYearsSelected && customYears.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {customYears.map((y) => (
              <span
                key={y}
                className="inline-flex items-center bg-tertiary-container text-on-tertiary-container rounded-full text-xs font-semibold"
              >
                <span className="pl-2.5 pr-1 py-1">{y}</span>
                <button
                  onClick={() => onToggleYear(y)}
                  className="pr-2 pl-0.5 py-1 hover:opacity-70 transition-opacity"
                >
                  <span className="material-symbols-outlined text-[12px]">close</span>
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Range / Custom input modes */}
        {!allYearsSelected && (
          <>
            {inputMode === "range" ? (
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
                  <button type="button" onClick={handleRangeSubmit} className="p-2.5 rounded-lg bg-primary text-on-primary hover:opacity-90 transition-all">
                    <span className="material-symbols-outlined text-[18px]">check</span>
                  </button>
                  <button type="button" onClick={() => { setInputMode(null); setRangeFrom(""); setRangeTo(""); }} className="text-on-surface-variant hover:text-on-surface">
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  </button>
                </div>
                <p className="text-[10px] text-on-surface-variant">e.g. 2001 – 2015</p>
              </div>
            ) : inputMode === "custom" ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  value={customInput}
                  onChange={(e) => setCustomInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleCustomSubmit(); }}
                  placeholder="Year"
                  autoFocus
                  className="w-20 px-3 py-2.5 rounded-lg text-xs font-semibold bg-surface-container-high text-on-surface border-none focus:ring-2 focus:ring-primary/20 text-center"
                />
                <button type="button" onClick={handleCustomSubmit} className="p-2.5 rounded-lg bg-primary text-on-primary hover:opacity-90 transition-all">
                  <span className="material-symbols-outlined text-[18px]">add</span>
                </button>
                <button type="button" onClick={() => { setInputMode(null); setCustomInput(""); }} className="text-on-surface-variant hover:text-on-surface">
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => setInputMode("range")}
                  className="px-3 py-1.5 rounded-full text-xs font-semibold bg-surface-container-high text-on-surface-variant hover:bg-surface-variant transition-all border border-dashed border-outline-variant"
                >
                  Range
                </button>
                <button
                  onClick={() => setInputMode("custom")}
                  className="px-3 py-1.5 rounded-full text-xs font-semibold bg-surface-container-high text-on-surface-variant hover:bg-surface-variant transition-all border border-dashed border-outline-variant"
                >
                  Custom
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Cause Type */}
      <div className="space-y-3">
        <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body">
          Cause Type
        </label>
        <div className="flex flex-wrap gap-2">
          {onSetAllCauses && onClearCauses && (
            <button
              onClick={makeAllToggle(allCausesSelected, selectedCauses, prevCauses, setPrevCauses, onSetAllCauses, onClearCauses, onSetCauses)}
              className={allCausesSelected ? PILL_ACTIVE : PILL_INACTIVE}
            >
              All
            </button>
          )}
          {!allCausesSelected && CAUSES.map((cause) => (
            <button
              key={cause.value}
              onClick={() => onToggleCause(cause.value)}
              className={`flex items-center gap-1.5 ${selectedCauses.has(cause.value) ? PILL_ACTIVE : PILL_INACTIVE}`}
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
        <label className="text-[10px] font-bold uppercase tracking-widest">
          Severity
        </label>
        <div className="flex flex-wrap gap-2">
          {onSetAllSeverities && onClearSeverities && (
            <button
              onClick={makeAllToggle(allSeveritiesSelected, selectedSeverities, prevSeverities, setPrevSeverities, onSetAllSeverities, onClearSeverities, onSetSeverities)}
              className={
                allSeveritiesSelected
                  ? PILL_ACTIVE
                  : PILL_INACTIVE
              }
            >
              All
            </button>
          )}
          {!allSeveritiesSelected && SEVERITIES.map((severity) => (
            <button
              key={severity}
              onClick={() => onToggleSeverity(severity)}
              className={
                selectedSeverities.has(severity)
                  ? PILL_ACTIVE
                  : PILL_INACTIVE
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
