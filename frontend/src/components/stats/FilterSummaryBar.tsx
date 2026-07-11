/**
 * Filter summary bar for the Stats dashboard — extracted from StatsPage so
 * the sticky-on-mobile behavior (#256) is testable in isolation.
 *
 * On small viewports the bar sticks below the fixed mobile nav (with iOS
 * safe-area handling) via the `.sticky-filter-bar` class in index.css; on
 * md+ it flows normally. z-index stays at 30 — inside the page's 0–50 band,
 * under the fixed chrome (nav z-50).
 */

export interface FilterChip {
  label: string;
  /** Chip removes itself. Chips without onRemove open the filter editor instead. */
  onRemove?: () => void;
  onOpen?: () => void;
  variant?: "default" | "tertiary";
}

interface FilterSummaryBarProps {
  chips: FilterChip[];
  onEditFilters: () => void;
}

export default function FilterSummaryBar({ chips, onEditFilters }: FilterSummaryBarProps) {
  return (
    <section
      aria-label="Active filters"
      className="sticky-filter-bar bg-surface-container-low rounded-lg px-4 md:px-6 py-3 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 md:gap-0"
    >
      <div className="flex items-center gap-3 overflow-x-auto no-scrollbar scroll-fade-r pr-8 w-full md:w-auto min-w-0">
        <span className="text-on-surface-variant text-xs font-semibold uppercase tracking-widest mr-2 flex-shrink-0">
          Filters:
        </span>
        <div className="flex items-center gap-2">
          {chips.map((chip) => (
            chip.onRemove ? (
              <span
                key={chip.label}
                className={`inline-flex items-center gap-1 px-3 py-2.5 min-h-[44px] rounded-full text-xs font-medium whitespace-nowrap ${
                  chip.variant === "tertiary"
                    ? "bg-tertiary/15 text-tertiary border border-tertiary/30"
                    : "bg-surface-container-highest text-on-surface"
                }`}
              >
                {chip.label}
                <button
                  type="button"
                  aria-label={`Remove ${chip.label} filter`}
                  onClick={chip.onRemove}
                  className="hover:text-error transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center -my-2 -mr-2"
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              </span>
            ) : (
              <button
                key={chip.label}
                type="button"
                onClick={chip.onOpen}
                className="inline-flex items-center gap-1 bg-surface-container-high px-3 py-2.5 min-h-[44px] rounded-full text-xs font-medium text-on-surface-variant whitespace-nowrap hover:text-on-surface transition-colors"
              >
                {chip.label}
                <span className="material-symbols-outlined text-[14px]">tune</span>
              </button>
            )
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={onEditFilters}
        className="text-primary text-xs font-bold uppercase tracking-wider flex items-center gap-1 hover:underline flex-shrink-0 min-h-[44px] py-2"
      >
        Edit Filters
        <span className="material-symbols-outlined text-[16px]">tune</span>
      </button>
    </section>
  );
}
