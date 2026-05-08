import { useState } from "react";
import {
  YEARS,
  CA_COUNTIES,
  CAUSES,
  SEVERITIES,
  formatYearMonth,
  type DateRangeFilter,
  type YearMonth,
} from "../../hooks/useFilterParams";
import SearchableMultiSelect from "../ui/SearchableMultiSelect";

const PILL_ACTIVE = "px-3 py-1.5 rounded-full text-xs font-semibold bg-primary text-on-primary transition-all";
const PILL_INACTIVE = "px-3 py-1.5 rounded-full text-xs font-semibold bg-surface-container-high text-on-surface-variant hover:bg-surface-variant transition-all";

const countyOptions = [
  { value: "__all__", label: "All Counties (Statewide)" },
  ...CA_COUNTIES.map((c) => ({ value: c, label: c })),
];

/** Stable reference — avoids creating a new Set on every render. */
const ALL_COUNTIES_SET = new Set(["__all__"]);

const MONTHS: { value: number; label: string }[] = [
  { value: 1, label: "Jan" }, { value: 2, label: "Feb" }, { value: 3, label: "Mar" },
  { value: 4, label: "Apr" }, { value: 5, label: "May" }, { value: 6, label: "Jun" },
  { value: 7, label: "Jul" }, { value: 8, label: "Aug" }, { value: 9, label: "Sep" },
  { value: 10, label: "Oct" }, { value: 11, label: "Nov" }, { value: 12, label: "Dec" },
];

interface FiltersPanelProps {
  selectedDateRange: DateRangeFilter | null;
  selectedSeverities: Set<string>;
  selectedCounties: Set<string>;
  selectedCauses: Set<string>;
  selectedAlcohol: boolean;
  selectedDistracted: boolean;
  onSetDateRange: (start: YearMonth | null, end: YearMonth | null) => void;
  onClearDateRange: () => void;
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
  selectedDateRange,
  selectedSeverities,
  selectedCounties,
  selectedCauses,
  onSetDateRange,
  onClearDateRange,
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
  // Stash previous selections so "All" toggle can restore them
  const [prevCauses, setPrevCauses] = useState<Set<string> | null>(null);
  const [prevSeverities, setPrevSeverities] = useState<Set<string> | null>(null);

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

  // Date range — derive partial values so changing year/month either side
  // independently still produces a valid range.
  const start = selectedDateRange?.start ?? null;
  const end = selectedDateRange?.end ?? null;
  const dateRangeActive = start !== null || end !== null;

  function updateStart(next: YearMonth | null) {
    onSetDateRange(next, end);
  }
  function updateEnd(next: YearMonth | null) {
    onSetDateRange(start, next);
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

      {/* Date range */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-bold uppercase tracking-widest">
            Date Range
          </label>
          {dateRangeActive && (
            <button
              type="button"
              onClick={onClearDateRange}
              className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant hover:text-on-surface transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        <div className="space-y-2">
          <MonthYearPicker
            label="From"
            value={start}
            onChange={updateStart}
          />
          <MonthYearPicker
            label="To"
            value={end}
            onChange={updateEnd}
          />
        </div>

        {!dateRangeActive && (
          <p className="text-[10px] text-on-surface-variant">
            All available years (2001–{YEARS[YEARS.length - 1]})
          </p>
        )}
        {dateRangeActive && (
          <p className="text-[10px] text-on-surface-variant">
            {start ? formatYearMonth(start) : "earliest"}
            {" – "}
            {end ? formatYearMonth(end) : "latest"}
          </p>
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

interface MonthYearPickerProps {
  label: string;
  value: YearMonth | null;
  onChange: (next: YearMonth | null) => void;
}

function MonthYearPicker({ label, value, onChange }: MonthYearPickerProps) {
  const handleMonth = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    if (v === "") {
      onChange(null);
      return;
    }
    const month = Number(v);
    const year = value?.year ?? YEARS[YEARS.length - 1];
    onChange({ year, month });
  };

  const handleYear = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    if (v === "") {
      onChange(null);
      return;
    }
    const year = Number(v);
    const month = value?.month ?? 1;
    onChange({ year, month });
  };

  const selectClass = "px-2.5 py-2 rounded-md text-xs font-semibold bg-surface-container-high text-on-surface border-none focus:ring-2 focus:ring-primary/20";

  return (
    <div className="flex items-center gap-2">
      <span className="w-10 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
        {label}
      </span>
      <select
        aria-label={`${label} month`}
        value={value?.month ?? ""}
        onChange={handleMonth}
        className={selectClass}
      >
        <option value="">Month</option>
        {MONTHS.map((m) => (
          <option key={m.value} value={m.value}>{m.label}</option>
        ))}
      </select>
      <select
        aria-label={`${label} year`}
        value={value?.year ?? ""}
        onChange={handleYear}
        className={selectClass}
      >
        <option value="">Year</option>
        {[...YEARS].reverse().map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
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
