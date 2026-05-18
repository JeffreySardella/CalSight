import React, { useRef, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import SimpleBarChart from "../charts/SimpleBarChart";
import SimpleDonutChart from "../charts/SimpleDonutChart";
import SimpleLineChart from "../charts/SimpleLineChart";
import DualAxisLineChart from "../charts/DualAxisLineChart";
import type { DualAxisPoint } from "../charts/DualAxisLineChart";
import SimpleTreemap from "../charts/SimpleTreemap";
import SimpleGauge from "../charts/SimpleGauge";
import StatCard from "../charts/StatCard";
import SimplePolarArea from "../charts/SimplePolarArea";
import SimpleLollipop from "../charts/SimpleLollipop";
import SimpleRadar from "../charts/SimpleRadar";
import SimpleScatter from "../charts/SimpleScatter";
import ChartDataTable from "./ChartDataTable";
import ChartSkeleton from "../charts/ChartSkeleton";
import ChartNarrative from "./ChartNarrative";
import type { ChartNarrativeResult } from "../../hooks/useNarrativeInsights";
import type { ChartSlot, Dimension } from "../../lib/dashboard/types";
import { DIMENSION_LABELS, MEASURE_LABELS } from "../../lib/dashboard/types";
import type { ChartDataItem } from "../../hooks/useDashboardData";
import { useFilterParams } from "../../hooks/useFilterParams";
import { useCustomTheme } from "../../context/CustomThemeContext";
import { exportChartPng, exportChartCsv } from "../../lib/export/chartExport";
import { forecast as computeForecast } from "../../lib/dashboard/stats";
import type { ForecastPoint } from "../charts/SimpleLineChart";
import type { DragHandleProps } from "../../hooks/useDragReorder";
import type { CrossFilterAPI } from "../../hooks/useCrossFilter";
import type { BarHighlight } from "../charts/SimpleBarChart";

const CROSS_FILTER_DIMS: Dimension[] = ["severity", "cause", "year"];

interface Props {
  slot: ChartSlot;
  data: ChartDataItem[];
  secondaryData?: ChartDataItem[];
  editing: boolean;
  loading?: boolean;
  compact?: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
  enterDelay?: number;
  dragHandleProps?: DragHandleProps | null;
  narrativeResult?: ChartNarrativeResult | null;
  crossFilter?: CrossFilterAPI;
  onBarClick?: (label: string, dimension: Dimension) => void;
}

function buildTitle(slot: ChartSlot): string {
  const measure = MEASURE_LABELS[slot.measure];
  const dim = DIMENSION_LABELS[slot.dimension];
  const primary = measure === "Crash Count" ? "Crashes" : measure;
  if (slot.secondaryMeasure) {
    const secondary = MEASURE_LABELS[slot.secondaryMeasure];
    return `${primary} vs ${secondary} by ${dim}`;
  }
  if (measure === "Crash Count") return `Crashes by ${dim}`;
  return `${measure} by ${dim}`;
}

function fmtValue(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString();
}

const TEXT_DIMS: Dimension[] = ["cause", "county", "weather", "lighting", "collision_type"];

function thinLabelFormatter(total: number, dim: Dimension) {
  const isText = TEXT_DIMS.includes(dim);
  const step = isText ? (total > 12 ? 4 : total > 8 ? 3 : total > 5 ? 2 : 1)
    : (total > 16 ? 4 : total > 10 ? 3 : total > 7 ? 2 : 1);
  const maxLen = isText ? 10 : 20;

  return (label: string, idx: number) => {
    if (step > 1 && idx % step !== 0 && idx !== total - 1) return null;
    const display = label.length > maxLen ? label.slice(0, maxLen) + "…" : label;
    return (
      <text
        textAnchor="middle"
        fontSize={isText ? 9 : 10}
        fontWeight={600}
        fill="rgb(var(--on-surface-variant))"
        fontFamily="'Inter Variable', Inter, sans-serif"
      >
        {display}
      </text>
    );
  };
}

function Tip({ label, value }: { label: string; value: number }) {
  return (
    <>
      <p className="font-headline font-bold text-on-surface">{label}</p>
      <p className="text-on-surface-variant mt-0.5">{fmtValue(value)}</p>
    </>
  );
}

function DonutLegend({ data }: { data: ChartDataItem[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2" role="list">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-1.5 text-[11px]" role="listitem">
          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: d.color ?? "rgb(var(--primary))" }} aria-hidden="true" />
          <span className="text-on-surface-variant">
            {d.label} {total > 0 ? `${Math.round((d.value / total) * 100)}%` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

function ChartCard({
  slot, data, secondaryData, editing, loading, compact, onEdit, onRemove, onMoveUp, onMoveDown, isFirst, isLast, enterDelay, dragHandleProps, narrativeResult, crossFilter, onBarClick,
}: Props) {
  const [showTable, setShowTable] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { selectedCounties } = useFilterParams();
  const { chartColors } = useCustomTheme();
  const title = buildTitle(slot);

  // Cross-filter: determine if this chart's dimension supports brushing
  const canCrossFilter = CROSS_FILTER_DIMS.includes(slot.dimension);
  const isSourceChart = crossFilter?.state.sourceChartId === slot.id;

  const handleCrossFilterClick = useMemo(() => {
    if (!crossFilter || !canCrossFilter) return undefined;
    return (label: string) => {
      crossFilter.toggleCategory(slot.id, slot.dimension, label);
    };
  }, [crossFilter, canCrossFilter, slot.id, slot.dimension]);

  const getHighlight = useMemo(() => {
    if (!crossFilter?.state.selection) return undefined;
    const { dimension, values } = crossFilter.state.selection;
    // Only highlight bars on the same dimension as the active cross-filter
    if (dimension !== slot.dimension) return undefined;
    return (item: { label: string }): BarHighlight => {
      return values.includes(item.label) ? "selected" : "dimmed";
    };
  }, [crossFilter?.state.selection, slot.dimension]);
  // Apply chart palette colors to data items that don't already have a color
  const coloredData = useMemo(() =>
    data.map((d, i) => d.color ? d : { ...d, color: chartColors[i % chartColors.length] }),
  [data, chartColors]);

  const hasData = data.length > 0 && data.some((d) => d.value > 0);
  const isScatter = slot.chartType === "scatter";
  const valueLabel = MEASURE_LABELS[slot.measure];
  const hasDualAxis = !!slot.secondaryMeasure && !!secondaryData && secondaryData.length > 0;

  const forecastData = useMemo<ForecastPoint[] | undefined>(() => {
    if (!slot.options?.forecast || data.length < 4) return undefined;
    const method = slot.options.forecastMethod ?? "linear";
    const horizon = slot.options.forecastHorizon ?? 3;
    const values = data.map(d => d.value);
    const lastLabel = data[data.length - 1]?.label ?? "";
    const result = computeForecast(values, horizon, method);
    const isYear = slot.dimension === "year";
    return result.values.map((v, i) => ({
      label: isYear ? String(parseInt(lastLabel, 10) + i + 1) : `+${i + 1}`,
      value: v,
      upper: result.upper[i],
      lower: result.lower[i],
    }));
  }, [data, slot.options?.forecast, slot.options?.forecastMethod, slot.options?.forecastHorizon, slot.dimension]);

  // Merge primary + secondary data into DualAxisPoint[] for dual-axis rendering
  const dualAxisData = useMemo<DualAxisPoint[]>(() => {
    if (!hasDualAxis || !secondaryData) return [];
    // Build a lookup from label -> secondary value
    const secondaryMap = new Map(secondaryData.map((d) => [d.label, d.value]));
    return data.map((d) => ({
      label: d.label,
      primary: d.value,
      secondary: secondaryMap.get(d.label) ?? 0,
    }));
  }, [data, secondaryData, hasDualAxis]);

  const handleExplainChart = () => {
    const countyPart = selectedCounties.size > 0
      ? ` in ${[...selectedCounties].join(", ")}`
      : "";
    const question = `Explain the "${title}" chart${countyPart}. What are the key takeaways?`;
    navigate(`/ask?q=${encodeURIComponent(question)}`);
  };

  const handleExportPng = () => {
    const svg = cardRef.current?.querySelector("svg");
    if (svg) exportChartPng(svg as SVGSVGElement, title);
  };

  const handleExportCsv = () => {
    exportChartCsv(data, title, isScatter);
  };

  return (
    <div
      ref={cardRef}
      role="group"
      aria-label={title}
      tabIndex={0} // eslint-disable-line jsx-a11y/no-noninteractive-tabindex -- intentional for keyboard navigation
      data-chart-id={slot.id}
      className={`group/card bg-surface-container-lowest chart-card-themed chart-card-enter focus:outline-2 focus:outline-primary/50 focus:outline-offset-2${isSourceChart ? " ring-2 ring-primary" : ""}`}
      style={{ animationDelay: enterDelay && enterDelay > 0 ? `${enterDelay}ms` : undefined }}
    >
      {/* Title — always full width, never truncated */}
      <div className={compact ? "mb-1" : "mb-2"}>
        <div className="flex items-center gap-1.5">
          {editing && dragHandleProps && (
            <span
              {...dragHandleProps}
              data-drag-handle
              className="drag-handle flex-shrink-0 p-1 rounded hover:bg-surface-container-high text-on-surface-variant cursor-grab active:cursor-grabbing opacity-0 group-hover/card:opacity-100 focus:opacity-100 transition-opacity"
              title="Drag to reorder"
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">drag_indicator</span>
            </span>
          )}
          <h3 className={`font-headline font-bold text-on-surface leading-tight${compact ? " text-xs text-on-surface-variant" : " text-sm"}`}>{title}</h3>
        </div>
      </div>

      {/* Action buttons — absolutely positioned top-right, only visible on hover */}
      <div className="relative">
        {!compact && <div className="absolute right-0 -top-8 z-10 flex items-center gap-0.5 bg-surface-container-lowest/95 rounded-lg px-1 opacity-0 group-hover/card:opacity-100 focus-within:opacity-100 transition-opacity">
          <button
            onClick={handleExplainChart}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-surface-container-high text-on-surface-variant opacity-100 sm:opacity-0 sm:group-hover/card:opacity-100 focus:opacity-100 transition-opacity"
            aria-label={`Explain ${title}`}
            title="Explain this chart"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
              auto_awesome
            </span>
          </button>
          <button
            onClick={handleExportPng}
            className="hidden sm:flex min-h-[44px] min-w-[44px] p-2.5 rounded-full hover:bg-surface-container-high text-on-surface-variant sm:opacity-0 sm:group-hover/card:opacity-100 focus:opacity-100 transition-opacity items-center justify-center"
            aria-label={`Download ${title} as PNG`}
            title="Download PNG"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
              file_download
            </span>
          </button>
          <button
            onClick={handleExportCsv}
            className="hidden sm:flex min-h-[44px] min-w-[44px] px-1.5 py-1 rounded-full hover:bg-surface-container-high text-on-surface-variant text-[11px] font-bold leading-none sm:opacity-0 sm:group-hover/card:opacity-100 focus:opacity-100 transition-opacity items-center justify-center"
            aria-label={`Download ${title} as CSV`}
            title="Download CSV"
          >
            CSV
          </button>
          <button
            onClick={() => setShowTable((v) => !v)}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-surface-container-high text-on-surface-variant opacity-100 sm:opacity-0 sm:group-hover/card:opacity-100 focus:opacity-100 transition-opacity"
            aria-label={showTable ? "Show chart" : "View data"}
            title={showTable ? "Show chart" : "View data"}
          >
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
              {showTable ? "bar_chart" : "table_chart"}
            </span>
          </button>
          {editing && (
            <>
              {!isFirst && (
                <button onClick={onMoveUp} className="p-1.5 rounded-full hover:bg-surface-container-high text-on-surface-variant opacity-0 group-hover/card:opacity-100 focus:opacity-100 transition-opacity" aria-label={`Move ${title} up`}>
                  <span className="material-symbols-outlined text-[16px]" aria-hidden="true">arrow_back_ios</span>
                </button>
              )}
              {!isLast && (
                <button onClick={onMoveDown} className="p-1.5 rounded-full hover:bg-surface-container-high text-on-surface-variant opacity-0 group-hover/card:opacity-100 focus:opacity-100 transition-opacity" aria-label={`Move ${title} down`}>
                  <span className="material-symbols-outlined text-[16px] rotate-180" aria-hidden="true">arrow_back_ios</span>
                </button>
              )}
              <button onClick={onEdit} className="p-1.5 rounded-full hover:bg-surface-container-high text-on-surface-variant opacity-0 group-hover/card:opacity-100 focus:opacity-100 transition-opacity" aria-label={`Edit ${title}`}>
                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">tune</span>
              </button>
              <button onClick={onRemove} className="p-1.5 rounded-full hover:bg-surface-container-high text-error opacity-0 group-hover/card:opacity-100 focus:opacity-100 transition-opacity" aria-label={`Remove ${title}`}>
                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">close</span>
              </button>
            </>
          )}
        </div>}
      </div>

      {loading ? (
        <ChartSkeleton type={slot.chartType} />
      ) : !hasData ? (
        <div className="h-48 flex items-center justify-center text-on-surface-variant text-sm">No data</div>
      ) : showTable ? (
        <ChartDataTable data={data} title={title} isScatter={isScatter} valueLabel={valueLabel} />
      ) : slot.chartType === "donut" ? (
        <>
          <SimpleDonutChart
            data={coloredData.map((d) => ({ label: d.label, value: d.value, color: d.color ?? "rgb(var(--primary))" }))}
            height={140}
            renderTooltip={(item) => <Tip label={item.label} value={item.value} />}
            title={title}
            onSegmentClick={handleCrossFilterClick ? (item) => handleCrossFilterClick(item.label) : undefined}
            getHighlight={getHighlight ? (item) => getHighlight(item) : undefined}
          />
          <DonutLegend data={coloredData} />
        </>
      ) : (slot.chartType === "line" || slot.chartType === "area") && hasDualAxis ? (
        <DualAxisLineChart
          data={dualAxisData}
          height={220}
          showArea={slot.chartType === "area"}
          primaryLabel={MEASURE_LABELS[slot.measure]}
          secondaryLabel={MEASURE_LABELS[slot.secondaryMeasure!]}
          renderTooltip={(item) => (
            <>
              <p className="font-headline font-bold text-on-surface">{item.label}</p>
              <p className="text-on-surface-variant mt-0.5">
                <span style={{ color: "rgb(var(--primary))" }}>{MEASURE_LABELS[slot.measure]}:</span>{" "}
                {fmtValue(item.primary)}
              </p>
              <p className="text-on-surface-variant">
                <span style={{ color: "rgb(var(--tertiary))" }}>{MEASURE_LABELS[slot.secondaryMeasure!]}:</span>{" "}
                {fmtValue(item.secondary)}
              </p>
            </>
          )}
          title={title}
        />
      ) : slot.chartType === "line" || slot.chartType === "area" ? (
        <SimpleLineChart
          data={data}
          height={192}
          showArea={slot.chartType === "area"}
          showDots={slot.chartType === "line"}
          showTrendLine={slot.options?.trendLine ?? false}
          showMeanLine={slot.options?.meanLine ?? false}
          showStdBand={slot.options?.stdBand ?? false}
          showOutliers={slot.options?.outliers ?? false}
          forecastData={forecastData}
          renderTooltip={(item) => <Tip label={item.label} value={item.value} />}
          title={title}
        />
      ) : slot.chartType === "scatter" ? (
        <SimpleScatter
          data={data}
          height={260}
          xLabel="Crashes"
          yLabel="Fatalities"
          renderTooltip={(item) => (
            <>
              <p className="font-headline font-bold text-on-surface">{item.label}</p>
              <p className="text-on-surface-variant mt-0.5">{fmtValue(item.x ?? 0)} crashes</p>
              <p className="text-on-surface-variant">{fmtValue(item.y ?? 0)} fatalities</p>
            </>
          )}
          title={title}
        />
      ) : slot.chartType === "polar" ? (
        <SimplePolarArea
          data={coloredData.map((d) => ({ ...d, color: d.color }))}
          height={220}
          renderTooltip={(item) => <Tip label={item.label} value={item.value} />}
          title={title}
        />
      ) : slot.chartType === "lollipop" ? (
        <div className="overflow-y-auto max-h-[360px]">
          <SimpleLollipop
            data={data}
            height={Math.max(192, data.length * 28)}
            renderTooltip={(item) => <Tip label={item.label} value={item.value} />}
            title={title}
            onItemClick={handleCrossFilterClick ? (item) => handleCrossFilterClick(item.label) : undefined}
            getHighlight={getHighlight ? (item) => getHighlight(item) : undefined}
          />
        </div>
      ) : slot.chartType === "radar" ? (
        <SimpleRadar
          data={data}
          height={220}
          renderTooltip={(item) => <Tip label={item.label} value={item.value} />}
          title={title}
        />
      ) : slot.chartType === "treemap" ? (
        <SimpleTreemap
          data={coloredData.map((d) => ({ ...d, color: d.color }))}
          height={260}
          renderTooltip={(item) => <Tip label={item.label} value={item.value} />}
          title={title}
        />
      ) : slot.chartType === "gauge" ? (
        <SimpleGauge
          data={coloredData.map((d) => ({ ...d, color: d.color }))}
          height={180}
          title={title}
        />
      ) : slot.chartType === "stat" ? (
        <StatCard data={data} height={192} />
      ) : slot.chartType === "hbar" ? (
        <div className="overflow-y-auto max-h-[360px]">
          <SimpleBarChart
            data={data}
            height={Math.max(192, data.length * 28)}
            layout="horizontal"
            renderTooltip={(item) => <Tip label={item.label} value={item.value} />}
            title={title}
            onBarClick={(item) => {
              if (slot.dimension === "county") {
                onBarClick?.(item.label, slot.dimension);
              } else {
                handleCrossFilterClick?.(item.label);
              }
            }}
            getHighlight={getHighlight}
          />
        </div>
      ) : (
        <SimpleBarChart
          data={data}
          height={192}
          showMeanLine={slot.options?.meanLine ?? false}
          labelFormatter={thinLabelFormatter(data.length, slot.dimension)}
          renderTooltip={(item) => <Tip label={item.label} value={item.value} />}
          title={title}
          onBarClick={(item) => {
            if (slot.dimension === "county") {
              onBarClick?.(item.label, slot.dimension);
            } else {
              handleCrossFilterClick?.(item.label);
            }
          }}
          getHighlight={getHighlight}
        />
      )}

      {narrativeResult && <ChartNarrative narrative={narrativeResult} />}
    </div>
  );
}

export default React.memo(ChartCard);
