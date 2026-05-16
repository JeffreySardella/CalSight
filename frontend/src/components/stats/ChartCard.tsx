import React, { useRef, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import SimpleBarChart from "../charts/SimpleBarChart";
import SimpleDonutChart from "../charts/SimpleDonutChart";
import SimpleLineChart from "../charts/SimpleLineChart";
import SimpleTreemap from "../charts/SimpleTreemap";
import SimpleGauge from "../charts/SimpleGauge";
import StatCard from "../charts/StatCard";
import SimplePolarArea from "../charts/SimplePolarArea";
import SimpleLollipop from "../charts/SimpleLollipop";
import SimpleRadar from "../charts/SimpleRadar";
import SimpleScatter from "../charts/SimpleScatter";
import ChartDataTable from "./ChartDataTable";
import type { ChartSlot, Dimension } from "../../lib/dashboard/types";
import { DIMENSION_LABELS, MEASURE_LABELS } from "../../lib/dashboard/types";
import type { ChartDataItem } from "../../hooks/useDashboardData";
import { useFilterParams } from "../../hooks/useFilterParams";
import { exportChartPng, exportChartCsv } from "../../lib/export/chartExport";
import { forecast as computeForecast } from "../../lib/dashboard/stats";
import type { ForecastPoint } from "../charts/SimpleLineChart";

interface Props {
  slot: ChartSlot;
  data: ChartDataItem[];
  editing: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
  enterDelay?: number;
}

function buildTitle(slot: ChartSlot): string {
  const measure = MEASURE_LABELS[slot.measure];
  const dim = DIMENSION_LABELS[slot.dimension];
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
        <div key={d.label} className="flex items-center gap-1.5 text-[10px]" role="listitem">
          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: d.color ?? "rgb(var(--primary-container))" }} aria-hidden="true" />
          <span className="text-on-surface-variant">
            {d.label} {total > 0 ? `${Math.round((d.value / total) * 100)}%` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

function ChartCard({
  slot, data, editing, onEdit, onRemove, onMoveUp, onMoveDown, isFirst, isLast, enterDelay,
}: Props) {
  const [showTable, setShowTable] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { selectedCounties } = useFilterParams();
  const title = buildTitle(slot);
  const hasData = data.length > 0 && data.some((d) => d.value > 0);
  const isScatter = slot.chartType === "scatter";
  const valueLabel = MEASURE_LABELS[slot.measure];

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
      className="group/card bg-surface-container-lowest chart-card-themed chart-card-enter focus:outline-2 focus:outline-primary/50 focus:outline-offset-2"
      style={{ animationDelay: enterDelay && enterDelay > 0 ? `${enterDelay}ms` : undefined }}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-headline font-bold text-on-surface">{title}</h3>
        <div className="flex flex-wrap items-center gap-0.5">
          <button
            onClick={handleExplainChart}
            className="p-2.5 rounded-full hover:bg-surface-container-high text-on-surface-variant opacity-100 sm:opacity-0 sm:group-hover/card:opacity-100 focus:opacity-100 transition-opacity"
            aria-label={`Explain ${title}`}
            title="Explain this chart"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
              auto_awesome
            </span>
          </button>
          <button
            onClick={handleExportPng}
            className="hidden sm:flex p-2.5 rounded-full hover:bg-surface-container-high text-on-surface-variant sm:opacity-0 sm:group-hover/card:opacity-100 focus:opacity-100 transition-opacity"
            aria-label={`Download ${title} as PNG`}
            title="Download PNG"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
              file_download
            </span>
          </button>
          <button
            onClick={handleExportCsv}
            className="hidden sm:flex px-1.5 py-1 rounded-full hover:bg-surface-container-high text-on-surface-variant text-[11px] font-bold leading-none sm:opacity-0 sm:group-hover/card:opacity-100 focus:opacity-100 transition-opacity"
            aria-label={`Download ${title} as CSV`}
            title="Download CSV"
          >
            CSV
          </button>
          <button
            onClick={() => setShowTable((v) => !v)}
            className="p-2.5 rounded-full hover:bg-surface-container-high text-on-surface-variant"
            aria-label={showTable ? "Show chart" : "View data"}
            title={showTable ? "Show chart" : "View data"}
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
              {showTable ? "bar_chart" : "table_chart"}
            </span>
          </button>
          {editing && (
            <>
              {!isFirst && (
                <button onClick={onMoveUp} className="p-2.5 rounded-full hover:bg-surface-container-high text-on-surface-variant" aria-label={`Move ${title} up`}>
                  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_back_ios</span>
                </button>
              )}
              {!isLast && (
                <button onClick={onMoveDown} className="p-2.5 rounded-full hover:bg-surface-container-high text-on-surface-variant" aria-label={`Move ${title} down`}>
                  <span className="material-symbols-outlined text-[18px] rotate-180" aria-hidden="true">arrow_back_ios</span>
                </button>
              )}
              <button onClick={onEdit} className="p-2.5 rounded-full hover:bg-surface-container-high text-on-surface-variant" aria-label={`Edit ${title}`}>
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">tune</span>
              </button>
              <button onClick={onRemove} className="p-2.5 rounded-full hover:bg-surface-container-high text-error" aria-label={`Remove ${title}`}>
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">close</span>
              </button>
            </>
          )}
        </div>
      </div>

      {!hasData ? (
        <div className="h-48 flex items-center justify-center text-on-surface-variant text-sm">No data</div>
      ) : showTable ? (
        <ChartDataTable data={data} title={title} isScatter={isScatter} valueLabel={valueLabel} />
      ) : slot.chartType === "donut" ? (
        <>
          <SimpleDonutChart
            data={data.map((d) => ({ label: d.label, value: d.value, color: d.color ?? "rgb(var(--primary-container))" }))}
            height={140}
            renderTooltip={(item) => <Tip label={item.label} value={item.value} />}
            title={title}
          />
          <DonutLegend data={data} />
        </>
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
          data={data.map((d) => ({ ...d, color: d.color }))}
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
          data={data.map((d) => ({ ...d, color: d.color }))}
          height={260}
          renderTooltip={(item) => <Tip label={item.label} value={item.value} />}
          title={title}
        />
      ) : slot.chartType === "gauge" ? (
        <SimpleGauge
          data={data.map((d) => ({ ...d, color: d.color }))}
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
        />
      )}
    </div>
  );
}

export default React.memo(ChartCard);
