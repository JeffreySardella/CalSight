import React from "react";
import SimpleBarChart from "../charts/SimpleBarChart";
import SimpleDonutChart from "../charts/SimpleDonutChart";
import SimpleLineChart from "../charts/SimpleLineChart";
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
  if (measure === "Crash Count") return dim;
  return `${measure} by ${dim}`;
}

function fmtValue(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString();
}

const TEXT_DIMS: Dimension[] = ["cause", "weather", "lighting", "collision_type"];

function thinLabelFormatter(total: number, dim: Dimension) {
  const isText = TEXT_DIMS.includes(dim);
  const step = total > 16 ? 4 : total > 10 ? 3 : total > 7 ? 2 : 1;
  const maxLen = isText ? 6 : 20;

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
          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} />
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
      ) : slot.chartType === "line" ? (
        <SimpleLineChart
          data={data}
          height={192}
          renderTooltip={(item) => <Tip label={item.label} value={item.value} />}
        />
      ) : (
        <SimpleBarChart
          data={data}
          height={192}
          labelFormatter={thinLabelFormatter(data.length, slot.dimension)}
          renderTooltip={(item) => <Tip label={item.label} value={item.value} />}
        />
      )}
    </div>
  );
}

export default React.memo(ChartCard);
