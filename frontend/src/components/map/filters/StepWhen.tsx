import { useState, useRef, useEffect } from "react";
import { YEARS } from "../../../hooks/useFilterParams";
import type { StagedFilters } from "../../../hooks/useStagedFilters";
import type { YearMonth } from "../../../hooks/useFilterParams";
import FilterChip from "./FilterChip";

const MONTHS = [
  { value: 1, label: "Jan" }, { value: 2, label: "Feb" }, { value: 3, label: "Mar" },
  { value: 4, label: "Apr" }, { value: 5, label: "May" }, { value: 6, label: "Jun" },
  { value: 7, label: "Jul" }, { value: 8, label: "Aug" }, { value: 9, label: "Sep" },
  { value: 10, label: "Oct" }, { value: 11, label: "Nov" }, { value: 12, label: "Dec" },
];

interface StepWhenProps {
  staged: StagedFilters;
  onToggleYear: (year: number) => void;
  onSetAllYears: () => void;
  onSetDateRange?: (start: YearMonth | null, end: YearMonth | null) => void;
  yearCounts?: Record<number, number>;
  loading?: boolean;
}

function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return n.toLocaleString();
}

export default function StepWhen({ staged, onToggleYear, onSetAllYears, onSetDateRange, yearCounts, loading }: StepWhenProps) {
  const usingRange = !!staged.dateRange;
  const usingYears = staged.selectedYears.size > 0;
  const allSelected = !usingRange && !usingYears;
  const [showMonthRange, setShowMonthRange] = useState(usingRange);

  const start = staged.dateRange?.start ?? null;
  const end = staged.dateRange?.end ?? null;

  const handleToggleYear = (year: number) => {
    if (onSetDateRange) onSetDateRange(null, null);
    setShowMonthRange(false);
    onToggleYear(year);
  };

  const handleAllYears = () => {
    onSetAllYears();
    if (onSetDateRange) onSetDateRange(null, null);
    setShowMonthRange(false);
  };

  const handleSetRange = (s: YearMonth | null, e: YearMonth | null) => {
    if (onSetDateRange) {
      onSetAllYears();
      onSetDateRange(s, e);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-4 bg-surface-container-high rounded w-40" />
        <div className="h-3 bg-surface-container-high rounded w-64" />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 12 }, (_, j) => (
            <div key={j} className="h-8 bg-surface-container-high rounded-full w-16" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-bold text-on-surface mb-1">When did it happen?</h3>
        <p className="text-[11px] text-on-surface-variant leading-snug">
          Select years or use the month range for precision. They don't overlap.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <FilterChip label="All Years" active={allSelected} onClick={handleAllYears} />
        {[...YEARS].reverse().map((year) => {
          const count = yearCounts?.[year];
          const hasData = count === undefined || count > 0;
          return (
            <FilterChip
              key={year}
              label={String(year)}
              count={count != null ? fmtCount(count) : undefined}
              active={usingYears && staged.selectedYears.has(year)}
              disabled={!hasData}
              onClick={() => handleToggleYear(year)}
            />
          );
        })}
      </div>

      {usingYears && (
        <p className="text-[11px] text-on-surface-variant">
          {staged.selectedYears.size} year{staged.selectedYears.size > 1 ? "s" : ""} selected
        </p>
      )}

      {usingRange && (
        <p className="text-[11px] text-primary font-semibold">
          Using month range — year chips disabled
        </p>
      )}

      {onSetDateRange && (
        <div className="space-y-3">
          <button
            onClick={() => setShowMonthRange((v) => !v)}
            className="text-[11px] font-semibold text-primary hover:text-primary/80 transition-colors flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[14px]">
              {showMonthRange ? "expand_less" : "expand_more"}
            </span>
            {showMonthRange ? "Hide month range" : "Set specific month range"}
          </button>

          {showMonthRange && (
            <div className="space-y-3 bg-surface-container rounded-xl p-3">
              <p className="text-[10px] text-on-surface-variant font-semibold uppercase tracking-widest">Month Range</p>
              <div className="space-y-2">
                <MonthYearRow label="From" value={start} onChange={(v) => handleSetRange(v, end)} />
                <MonthYearRow label="To" value={end} onChange={(v) => handleSetRange(start, v)} />
              </div>
              {(start || end) && (
                <button
                  onClick={handleAllYears}
                  className="text-[10px] font-semibold text-on-surface-variant hover:text-on-surface"
                >
                  Clear range
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {(allSelected || (usingYears && [...staged.selectedYears].some((y) => y >= 2016))) && (
        <div className="flex items-center gap-2 bg-tertiary-container/30 rounded-lg px-3 py-2">
          <span className="material-symbols-outlined text-[14px] text-tertiary">info</span>
          <p className="text-[10px] text-on-surface-variant">
            2016+ years unlock involvement and driver age filters in Step 3.
          </p>
        </div>
      )}
    </div>
  );
}

function InlineSelect({ ariaLabel, value, placeholder, options, onChange }: {
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
        className="w-full flex items-center justify-between px-3 py-3 rounded-lg text-sm bg-surface-container-lowest text-on-surface border-none text-left"
      >
        <span className={selected ? "text-on-surface" : "text-on-surface-variant"}>
          {selected?.label ?? placeholder}
        </span>
        <span className="material-symbols-outlined text-[14px] text-on-surface-variant ml-1 shrink-0">expand_more</span>
      </button>
      {open && (
        <div className="absolute z-50 left-0 right-0 max-h-40 overflow-y-auto bg-surface-container-lowest rounded-lg shadow-lg border border-outline-variant/15 bottom-full mb-1">
          <button
            type="button"
            onClick={() => { onChange(""); setOpen(false); }}
            className="w-full px-3 py-2 text-sm text-left text-on-surface-variant hover:bg-surface-container transition-colors"
          >
            {placeholder}
          </button>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={`w-full px-3 py-2 text-sm text-left hover:bg-surface-container transition-colors ${
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

function MonthYearRow({ label, value, onChange }: {
  label: string;
  value: YearMonth | null;
  onChange: (v: YearMonth | null) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 shrink-0 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
        {label}
      </span>
      <InlineSelect
        ariaLabel={`${label} month`}
        value={value?.month?.toString() ?? ""}
        placeholder="Month"
        options={MONTHS.map((m) => ({ value: m.value.toString(), label: m.label }))}
        onChange={(v) => {
          if (v === "") { onChange(null); return; }
          onChange({ year: value?.year ?? YEARS[YEARS.length - 1], month: Number(v) });
        }}
      />
      <InlineSelect
        ariaLabel={`${label} year`}
        value={value?.year?.toString() ?? ""}
        placeholder="Year"
        options={[...YEARS].reverse().map((y) => ({ value: y.toString(), label: y.toString() }))}
        onChange={(v) => {
          if (v === "") { onChange(null); return; }
          onChange({ year: Number(v), month: value?.month ?? 1 });
        }}
      />
    </div>
  );
}
