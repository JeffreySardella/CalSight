import { useMemo } from "react";
import type { DataStory, StoryBlock, ChartBlock } from "../../lib/dashboard/stories";
import type { ChartSlot } from "../../lib/dashboard/types";
import type { StatsFilters } from "../../hooks/useStats";
import { useDashboardData } from "../../hooks/useDashboardData";
import { useFilterParams } from "../../hooks/useFilterParams";
import ChartCard from "./ChartCard";

interface Props {
  story: DataStory;
  onBack: () => void;
}

export default function StoryReader({ story, onBack }: Props) {
  const filters = useFilterParams();

  // Base filters from global filter state
  const statsFilters = useMemo<StatsFilters>(() => ({
    dateRange: filters.selectedDateRange,
    severities: [...filters.selectedSeverities],
    causes: [...filters.selectedCauses],
    counties: [...filters.selectedCounties].map((c) => c.toLowerCase().replace(/ /g, "-")),
    alcohol: filters.selectedAlcohol,
    pedestrian: filters.selectedPedestrian,
    cyclist: filters.selectedCyclist,
    drug: filters.selectedDrug,
    distracted: filters.selectedDistracted,
  }), [filters.selectedDateRange, filters.selectedSeverities, filters.selectedCauses, filters.selectedCounties, filters.selectedAlcohol, filters.selectedPedestrian, filters.selectedCyclist, filters.selectedDrug, filters.selectedDistracted]);

  // Only fetch data for chart blocks WITHOUT filterOverrides via the shared batch call
  const globalChartSlots = useMemo<ChartSlot[]>(() => {
    return story.blocks
      .filter((b): b is ChartBlock => b.type === "chart" && !b.filterOverrides)
      .map((b, i) => ({
        id: b.id,
        dimension: b.dimension,
        measure: b.measure,
        chartType: b.chartType,
        order: i,
        options: b.options,
      }));
  }, [story.blocks]);

  const { dataBySlot, loading } = useDashboardData(globalChartSlots, statsFilters);

  return (
    <article className="max-w-2xl mx-auto space-y-8 sm:space-y-10">
      {/* Back button */}
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-primary text-sm font-medium hover:underline transition-colors min-h-[44px]"
      >
        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_back</span>
        Back to Stories
      </button>

      {/* Story header */}
      <header className="space-y-3">
        <h2 className="text-2xl sm:text-3xl font-headline font-bold text-on-surface tracking-tight leading-tight">
          {story.title}
        </h2>
        <p className="text-on-surface-variant text-sm sm:text-base leading-relaxed font-serif italic">
          {story.subtitle}
        </p>
      </header>

      {/* Blocks */}
      {story.blocks.map((block, idx) => (
        <StoryBlockRenderer
          key={idx}
          block={block}
          dataBySlot={dataBySlot}
          loading={loading}
          baseFilters={statsFilters}
        />
      ))}
    </article>
  );
}

function StoryBlockRenderer({
  block,
  dataBySlot,
  loading,
  baseFilters,
}: {
  block: StoryBlock;
  dataBySlot: Record<string, import("../../hooks/useDashboardData").ChartDataItem[]>;
  loading: boolean;
  baseFilters: StatsFilters;
}) {
  switch (block.type) {
    case "narrative":
      return (
        <div
          className={`space-y-2 ${block.isThesis ? "border-l-4 border-tertiary pl-4 sm:pl-5 py-2" : ""}`}
        >
          <h3 className="text-lg sm:text-xl font-headline font-semibold text-on-surface">
            {block.heading}
          </h3>
          <p className="font-serif text-on-surface-variant text-sm sm:text-base leading-[1.8] tracking-[0.01em]">
            {block.body}
          </p>
        </div>
      );

    case "stat-callout":
      return (
        <div className="bg-primary-container/20 rounded-xl px-4 sm:px-6 py-4 sm:py-5 text-center space-y-1">
          <p className="text-3xl sm:text-4xl font-headline font-bold text-primary tracking-tight break-words">
            {block.value}
          </p>
          <p className="text-sm font-semibold text-on-surface">
            {block.label}
          </p>
          {block.context && (
            <p className="text-xs text-on-surface-variant mt-1">
              {block.context}
            </p>
          )}
        </div>
      );

    case "chart": {
      // Charts with filterOverrides get their own data fetch
      if (block.filterOverrides) {
        return <OverriddenChartBlock block={block} baseFilters={baseFilters} />;
      }

      const slot: ChartSlot = {
        id: block.id,
        dimension: block.dimension,
        measure: block.measure,
        chartType: block.chartType,
        order: 0,
        options: block.options,
      };
      const opts = block.options ?? {};
      const optStr = [
        (opts as Record<string, unknown>).cumulative && "cum",
        (opts as Record<string, unknown>).movingAvg && `ma${(opts as Record<string, unknown>).movingAvg}`,
        (opts as Record<string, unknown>).logScale && "log",
      ].filter(Boolean).join(",");
      const key = `${block.dimension}:${block.measure}${optStr ? `:${optStr}` : ""}`;
      const data = dataBySlot[key] ?? [];

      return (
        <div className="bg-surface-container-lowest rounded-2xl p-3 sm:p-5 ambient-shadow overflow-hidden">
          <ChartCard
            slot={slot}
            data={data}
            editing={false}
            loading={loading}
            compact
          />
          {block.caption && (
            <p className="text-xs text-on-surface-variant text-center mt-3 italic font-serif">{block.caption}</p>
          )}
        </div>
      );
    }

    default:
      return null;
  }
}

/**
 * A chart block that fetches its own data using per-block filterOverrides
 * merged with the global base filters. This is a separate component so each
 * overridden chart has its own stable useDashboardData hook call.
 */
function OverriddenChartBlock({
  block,
  baseFilters,
}: {
  block: ChartBlock;
  baseFilters: StatsFilters;
}) {
  const overrides = block.filterOverrides!;

  // Merge base filters with this block's overrides
  const mergedFilters = useMemo<StatsFilters>(() => ({
    ...baseFilters,
    ...(overrides.counties !== undefined && { counties: overrides.counties }),
    ...(overrides.alcohol !== undefined && { alcohol: overrides.alcohol }),
    ...(overrides.pedestrian !== undefined && { pedestrian: overrides.pedestrian }),
  }), [baseFilters, overrides]);

  const chartSlots = useMemo<ChartSlot[]>(() => [{
    id: block.id,
    dimension: block.dimension,
    measure: block.measure,
    chartType: block.chartType,
    order: 0,
    options: block.options,
  }], [block.id, block.dimension, block.measure, block.chartType, block.options]);

  const { dataBySlot, loading } = useDashboardData(chartSlots, mergedFilters);

  const slot: ChartSlot = chartSlots[0];
  const opts = block.options ?? {};
  const optStr = [
    (opts as Record<string, unknown>).cumulative && "cum",
    (opts as Record<string, unknown>).movingAvg && `ma${(opts as Record<string, unknown>).movingAvg}`,
    (opts as Record<string, unknown>).logScale && "log",
  ].filter(Boolean).join(",");
  const key = `${block.dimension}:${block.measure}${optStr ? `:${optStr}` : ""}`;
  const data = dataBySlot[key] ?? [];

  return (
    <div className="bg-surface-container-lowest rounded-2xl p-3 sm:p-5 ambient-shadow overflow-hidden">
      <ChartCard
        slot={slot}
        data={data}
        editing={false}
        loading={loading}
        compact
      />
      {block.caption && (
        <p className="text-xs text-on-surface-variant text-center mt-3 italic font-serif">{block.caption}</p>
      )}
    </div>
  );
}
