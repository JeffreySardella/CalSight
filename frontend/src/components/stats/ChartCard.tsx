import React from "react";
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
import type { ChartSlot, Dimension } from "../../lib/dashboard/types";
import { DIMENSION_LABELS, MEASURE_LABELS } from "../../lib/dashboard/types";
import type { ChartDataItem } from "../../hooks/useDashboardData";

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
    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-1.5 text-[10px]">
          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: d.color ?? "rgb(var(--primary-container))" }} />
          <span className="text-on-surface-variant">
            {d.label} {total > 0 ? `${Math.round((d.value / total) * 100)}%` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

function ChartCard({
  slot, data, editing, onEdit, onRemove, onMoveUp, onMoveDown, isFirst, isLast,
}: Props) {
  const title = buildTitle(slot);
  const hasData = data.length > 0 && data.some((d) => d.value > 0);

  return (
    <div className="bg-surface-container-lowest rounded-2xl p-4 ambient-shadow">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-headline font-bold text-on-surface">{title}</h3>
        {editing && (
          <div className="flex items-center gap-0.5">
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
          </div>
        )}
      </div>

      {!hasData ? (
        <div className="h-48 flex items-center justify-center text-on-surface-variant text-sm">No data</div>
      ) : slot.chartType === "donut" ? (
        <>
          <SimpleDonutChart
            data={data.map((d) => ({ label: d.label, value: d.value, color: d.color ?? "rgb(var(--primary-container))" }))}
            height={140}
            renderTooltip={(item) => <Tip label={item.label} value={item.value} />}
          />
          <DonutLegend data={data} />
        </>
      ) : slot.chartType === "line" || slot.chartType === "area" ? (
        <SimpleLineChart
          data={data}
          height={192}
          showArea={slot.chartType === "area"}
          showDots={slot.chartType === "line"}
          showTrendLine={slot.options?.trendLine ?? data.length >= 8}
          showMeanLine={slot.options?.meanLine ?? false}
          showStdBand={data.length >= 6}
          showOutliers={data.length >= 6}
          renderTooltip={(item) => <Tip label={item.label} value={item.value} />}
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
        />
      ) : slot.chartType === "polar" ? (
        <SimplePolarArea
          data={data.map((d) => ({ ...d, color: d.color }))}
          height={220}
          renderTooltip={(item) => <Tip label={item.label} value={item.value} />}
        />
      ) : slot.chartType === "lollipop" ? (
        <div className="overflow-y-auto max-h-[360px]">
          <SimpleLollipop
            data={data}
            height={Math.max(192, data.length * 28)}
            renderTooltip={(item) => <Tip label={item.label} value={item.value} />}
          />
        </div>
      ) : slot.chartType === "radar" ? (
        <SimpleRadar
          data={data}
          height={220}
          renderTooltip={(item) => <Tip label={item.label} value={item.value} />}
        />
      ) : slot.chartType === "treemap" ? (
        <SimpleTreemap
          data={data.map((d) => ({ ...d, color: d.color }))}
          height={260}
          renderTooltip={(item) => <Tip label={item.label} value={item.value} />}
        />
      ) : slot.chartType === "gauge" ? (
        <SimpleGauge
          data={data.map((d) => ({ ...d, color: d.color }))}
          height={180}
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
          />
        </div>
      ) : (
        <SimpleBarChart
          data={data}
          height={192}
          showMeanLine={slot.options?.meanLine ?? data.length >= 5}
          labelFormatter={thinLabelFormatter(data.length, slot.dimension)}
          renderTooltip={(item) => <Tip label={item.label} value={item.value} />}
        />
      )}
    </div>
  );
}

export default React.memo(ChartCard);
