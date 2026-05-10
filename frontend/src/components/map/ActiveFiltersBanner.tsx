import type { DateRangeFilter } from "../../hooks/useFilterParams";
import { formatYearMonth } from "../../hooks/useFilterParams";

interface ActiveFiltersBannerProps {
  dateRange: DateRangeFilter | null;
  severities: Set<string>;
  causes: Set<string>;
  alcohol: boolean;
  distracted: boolean;
  pedestrian: boolean;
  cyclist: boolean;
  drug: boolean;
  driverAge: string | null;
  totalCrashes: number;
  isLoading: boolean;
  onClear: () => void;
  searchOpen?: boolean;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

export default function ActiveFiltersBanner({
  dateRange,
  severities,
  causes,
  alcohol,
  distracted,
  pedestrian,
  cyclist,
  drug,
  driverAge,
  totalCrashes,
  isLoading,
  onClear,
  searchOpen,
}: ActiveFiltersBannerProps) {
  const chips: string[] = [];

  if (dateRange) {
    const s = dateRange.start ? formatYearMonth(dateRange.start) : "earliest";
    const e = dateRange.end ? formatYearMonth(dateRange.end) : "latest";
    chips.push(`${s} – ${e}`);
  }
  if (severities.size > 0 && severities.size < 3) {
    chips.push(...severities);
  }
  if (causes.size > 0 && causes.size < 10) {
    chips.push(`${causes.size} cause${causes.size > 1 ? "s" : ""}`);
  }
  if (alcohol) chips.push("Alcohol");
  if (distracted) chips.push("Distracted");
  if (pedestrian) chips.push("Ped. Involved");
  if (cyclist) chips.push("Cyclist");
  if (drug) chips.push("Drug");
  if (driverAge) chips.push(`Age ${driverAge}`);

  const hasInvolvement = alcohol || distracted || pedestrian || cyclist || drug || !!driverAge;

  if (chips.length === 0) return null;

  return (
    <div className={`hidden md:block absolute top-20 left-16 right-auto max-w-[500px] z-20 transition-opacity duration-200 ${searchOpen ? "opacity-0 pointer-events-none" : ""}`}>
      <div className="bg-surface-container-lowest/95 backdrop-blur-md ghost-border rounded-xl px-3 py-2 ambient-shadow">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="material-symbols-outlined text-[14px] text-primary shrink-0">filter_list</span>
          <span className={`text-[11px] font-bold text-on-surface ${isLoading ? "animate-pulse" : ""}`}>
            {isLoading ? "Updating..." : `${fmt(totalCrashes)} crashes`}
          </span>
          <span className="text-[10px] text-on-surface-variant">|</span>
          {chips.map((chip) => (
            <span
              key={chip}
              className="text-[10px] font-semibold bg-primary-container text-on-primary-container px-2 py-0.5 rounded-full"
            >
              {chip}
            </span>
          ))}
          {hasInvolvement && (
            <span className="text-[10px] font-semibold bg-tertiary-container text-on-tertiary-container px-2 py-0.5 rounded-full">
              2016+ only
            </span>
          )}
          <button
            onClick={onClear}
            className="text-[10px] font-bold text-on-surface-variant hover:text-on-surface transition-colors ml-auto"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
