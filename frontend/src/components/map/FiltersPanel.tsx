import { useState, useRef, useEffect } from "react";
import {
  YEARS,
  CA_COUNTIES,
  CAUSES,
  SEVERITIES,
  INVOLVEMENTS,
  DRIVER_AGE_BRACKETS,
  formatYearMonth,
  type DateRangeFilter,
  type YearMonth,
} from "../../hooks/useFilterParams";
import SearchableMultiSelect from "../ui/SearchableMultiSelect";

const PILL_ACTIVE = "px-3 py-1.5 rounded-full text-xs font-semibold bg-primary text-on-primary transition-colors";
const PILL_INACTIVE = "px-3 py-1.5 rounded-full text-xs font-semibold bg-surface-container-high text-on-surface-variant hover:bg-surface-variant transition-colors";

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
  selectedPedestrian: boolean;
  selectedCyclist: boolean;
  selectedDrug: boolean;
  selectedDriverAge: string | null;
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
  onTogglePedestrian: () => void;
  onToggleCyclist: () => void;
  onToggleDrug: () => void;
  onSetDriverAge: (bracket: string | null) => void;
  resetKey?: number;
}

export default function FiltersPanel({
  selectedDateRange,
  selectedSeverities,
  selectedCounties,
  selectedCauses,
  selectedAlcohol,
  selectedDistracted,
  selectedPedestrian,
  selectedCyclist,
  selectedDrug,
  selectedDriverAge,
  onSetDateRange,
  onClearDateRange,
  onToggleSeverity,
  onSetAllSeverities,
  onClearSeverities,
  onToggleCounty,
  onClearCounties,
  onToggleCause,
  onSetAllCauses,
  onClearCauses,
  onToggleAlcohol,
  onToggleDistracted,
  onTogglePedestrian,
  onToggleCyclist,
  onToggleDrug,
  onSetDriverAge,
  resetKey = 0,
}: FiltersPanelProps) {
  const allCausesSelected = selectedCauses.size === 0 || selectedCauses.size === CAUSES.length;
  const allSeveritiesSelected = selectedSeverities.size === 0 || selectedSeverities.size === SEVERITIES.length;

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
          Cause <span className="normal-case font-medium">(why it happened)</span>
        </label>
        <p className="text-[10px] text-on-surface-variant leading-snug -mt-1">
          The primary factor that caused the crash. Available for all years.
        </p>
        <div className="flex flex-wrap gap-2">
          {onSetAllCauses && onClearCauses && (
            <button
              onClick={() => {
                if (allCausesSelected) return;
                onClearCauses();
              }}
              className={allCausesSelected ? PILL_ACTIVE : PILL_INACTIVE}
            >
              All
            </button>
          )}
          {CAUSES.map((cause) => (
            <button
              key={cause.value}
              onClick={() => {
                if (allCausesSelected && selectedCauses.size === 0) {
                  onSetAllCauses?.();
                  setTimeout(() => onToggleCause(cause.value), 0);
                } else {
                  onToggleCause(cause.value);
                }
              }}
              className={`flex items-center gap-1.5 ${
                allCausesSelected
                  ? PILL_INACTIVE
                  : selectedCauses.has(cause.value) ? PILL_ACTIVE : PILL_INACTIVE
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
        <label className="text-[10px] font-bold uppercase tracking-widest">
          Severity
        </label>
        <p className="text-[10px] text-on-surface-variant leading-snug -mt-1">
          How severe was the crash outcome.
        </p>
        <div className="flex flex-wrap gap-2">
          {onSetAllSeverities && onClearSeverities && (
            <button
              onClick={() => {
                if (allSeveritiesSelected) return;
                onClearSeverities();
              }}
              className={allSeveritiesSelected ? PILL_ACTIVE : PILL_INACTIVE}
            >
              All
            </button>
          )}
          {SEVERITIES.map((severity) => (
            <button
              key={severity}
              onClick={() => {
                if (allSeveritiesSelected && selectedSeverities.size === 0) {
                  onSetAllSeverities?.();
                  setTimeout(() => onToggleSeverity(severity), 0);
                } else {
                  onToggleSeverity(severity);
                }
              }}
              className={
                allSeveritiesSelected
                  ? PILL_INACTIVE
                  : selectedSeverities.has(severity) ? PILL_ACTIVE : PILL_INACTIVE
              }
            >
              {severity}
            </button>
          ))}
        </div>
      </div>

      {/* Involvement Type */}
      <div className="space-y-3">
        <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body">
          Involvement <span className="normal-case font-medium">(who was involved, 2016+)</span>
        </label>
        <p className="text-[10px] text-on-surface-variant leading-snug -mt-1">
          Whether a specific party type was present, regardless of fault. Only available for 2016+ crashes.
        </p>
        <div className="flex flex-wrap gap-2">
          {INVOLVEMENTS.map((inv) => {
            const isActive =
              inv.value === "alcohol" ? selectedAlcohol :
              inv.value === "distracted" ? selectedDistracted :
              inv.value === "pedestrian" ? selectedPedestrian :
              inv.value === "cyclist" ? selectedCyclist :
              inv.value === "drug" ? selectedDrug : false;
            const onToggle =
              inv.value === "alcohol" ? onToggleAlcohol :
              inv.value === "distracted" ? onToggleDistracted :
              inv.value === "pedestrian" ? onTogglePedestrian :
              inv.value === "cyclist" ? onToggleCyclist :
              inv.value === "drug" ? onToggleDrug : () => {};
            return (
              <button
                key={inv.value}
                onClick={onToggle}
                className={`flex items-center gap-1.5 ${isActive ? PILL_ACTIVE : PILL_INACTIVE}`}
              >
                <span className="material-symbols-outlined text-[14px]">
                  {inv.icon}
                </span>
                {inv.label}
              </button>
            );
          })}
        </div>
        <p className="text-[10px] text-on-surface-variant">2016+ data only (CCRS)</p>
      </div>

      {/* Driver Age */}
      <div className="space-y-3">
        <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body">
          At-Fault Driver Age <span className="normal-case font-medium">(2016+)</span>
        </label>
        <p className="text-[10px] text-on-surface-variant leading-snug -mt-1">
          Age of the driver determined to be at fault. Select one bracket at a time.
        </p>
        <div className="flex flex-wrap gap-2">
          {DRIVER_AGE_BRACKETS.map((bracket) => (
            <button
              key={bracket.value}
              onClick={() => onSetDriverAge(selectedDriverAge === bracket.value ? null : bracket.value)}
              className={selectedDriverAge === bracket.value ? PILL_ACTIVE : PILL_INACTIVE}
            >
              {bracket.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-on-surface-variant">2016+ data only (CCRS)</p>
      </div>

    </div>
  );
}

interface MonthYearPickerProps {
  label: string;
  value: YearMonth | null;
  onChange: (next: YearMonth | null) => void;
}

function StyledSelect({ ariaLabel, value, placeholder, options, onChange }: {
  ariaLabel: string;
  value: string;
  placeholder: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative flex-1 min-w-0">
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-3 rounded-lg text-sm bg-surface-container-high text-on-surface border-none focus:ring-2 focus:ring-primary/20 text-left"
      >
        <span className={selected ? "text-on-surface" : "text-outline"}>
          {selected?.label ?? placeholder}
        </span>
        <span className="material-symbols-outlined text-[16px] text-on-surface-variant ml-1 shrink-0">expand_more</span>
      </button>
      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1 max-h-40 overflow-y-auto bg-surface-container-lowest rounded-lg shadow-lg border border-outline-variant/15 bottom-full mb-1 md:bottom-auto md:mb-0 md:top-full md:mt-1">
          <button
            type="button"
            onClick={() => { onChange(""); setOpen(false); }}
            className="w-full px-4 py-2.5 text-sm text-left text-on-surface-variant hover:bg-surface-container transition-colors"
          >
            {placeholder}
          </button>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={`w-full px-4 py-2.5 text-sm text-left hover:bg-surface-container transition-colors ${
                o.value === value ? "text-primary font-semibold" : "text-on-surface"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MonthYearPicker({ label, value, onChange }: MonthYearPickerProps) {
  const handleMonth = (v: string) => {
    if (v === "") { onChange(null); return; }
    const month = Number(v);
    const year = value?.year ?? YEARS[YEARS.length - 1];
    onChange({ year, month });
  };

  const handleYear = (v: string) => {
    if (v === "") { onChange(null); return; }
    const year = Number(v);
    const month = value?.month ?? 1;
    onChange({ year, month });
  };

  return (
    <div className="flex items-center gap-2">
      <span className="w-10 shrink-0 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
        {label}
      </span>
      <StyledSelect
        ariaLabel={`${label} month`}
        value={value?.month?.toString() ?? ""}
        placeholder="Month"
        options={MONTHS.map((m) => ({ value: m.value.toString(), label: m.label }))}
        onChange={handleMonth}
      />
      <StyledSelect
        ariaLabel={`${label} year`}
        value={value?.year?.toString() ?? ""}
        placeholder="Year"
        options={[...YEARS].reverse().map((y) => ({ value: y.toString(), label: y.toString() }))}
        onChange={handleYear}
      />
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
