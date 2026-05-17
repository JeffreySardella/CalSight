import { useMemo } from "react";
import type { DataStory, StoryBlock, ChartBlock } from "../../lib/dashboard/stories";
import type { ChartSlot } from "../../lib/dashboard/types";
import { useDashboardData } from "../../hooks/useDashboardData";
import { useFilterParams } from "../../hooks/useFilterParams";
import ChartCard from "./ChartCard";

interface Props {
  story: DataStory;
  onBack: () => void;
}

export default function StoryReader({ story, onBack }: Props) {
  const filters = useFilterParams();

  // Build ChartSlot[] from chart blocks so we can use useDashboardData
  const chartSlots = useMemo<ChartSlot[]>(() => {
    return story.blocks
      .filter((b): b is ChartBlock => b.type === "chart")
      .map((b, i) => ({
        id: b.id,
        dimension: b.dimension,
        measure: b.measure,
        chartType: b.chartType,
        order: i,
        options: b.options,
      }));
  }, [story.blocks]);

  // Build a filters object respecting per-block filter overrides
  // For now, we use the global filters as the base and override for the whole story
  // (individual block overrides are handled by separate queries if needed)
  const statsFilters = useMemo(() => ({
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

  const { dataBySlot, loading } = useDashboardData(chartSlots, statsFilters);

  return (
    <article className="max-w-2xl mx-auto space-y-6 sm:space-y-8">
      {/* Back button */}
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-primary text-sm font-medium hover:underline transition-colors min-h-[44px]"
      >
        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_back</span>
        Back to Dashboard
      </button>

      {/* Story header */}
      <header className="space-y-2">
        <h2 className="text-2xl sm:text-3xl font-headline font-bold text-on-surface tracking-tight">
          {story.title}
        </h2>
        <p className="text-on-surface-variant text-sm sm:text-base leading-relaxed">
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
        />
      ))}
    </article>
  );
}

function StoryBlockRenderer({
  block,
  dataBySlot,
  loading,
}: {
  block: StoryBlock;
  dataBySlot: Record<string, import("../../hooks/useDashboardData").ChartDataItem[]>;
  loading: boolean;
}) {
  switch (block.type) {
    case "narrative":
      return (
        <div
          className={`space-y-2 ${block.isThesis ? "border-l-4 border-primary pl-4 sm:pl-5 py-1" : ""}`}
        >
          <h3 className="text-lg sm:text-xl font-headline font-semibold text-on-surface">
            {block.heading}
          </h3>
          <p className="font-serif text-on-surface-variant text-sm sm:text-base leading-[1.8]">
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
      const slot: ChartSlot = {
        id: block.id,
        dimension: block.dimension,
        measure: block.measure,
        chartType: block.chartType,
        order: 0,
        options: block.options,
      };
      // Build the same key that useDashboardData uses
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
          />
          {block.caption && (
            <p className="text-xs text-on-surface-variant text-center mt-2 italic">{block.caption}</p>
          )}
        </div>
      );
    }

    default:
      return null;
  }
}
