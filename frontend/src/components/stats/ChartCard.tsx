import SimpleBarChart from "../charts/SimpleBarChart";
import SimpleDonutChart from "../charts/SimpleDonutChart";
import SimpleLineChart from "../charts/SimpleLineChart";
import type { ChartSlot } from "../../lib/dashboard/types";
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

export default function ChartCard({
  slot, data, editing, onEdit, onRemove, onMoveUp, onMoveDown, isFirst, isLast,
}: Props) {
  const title = buildTitle(slot);

  return (
    <div className="bg-surface-container-lowest rounded-2xl p-4 ambient-shadow">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-headline font-bold text-on-surface">{title}</h3>
        {editing && (
          <div className="flex items-center gap-1">
            {!isFirst && (
              <button onClick={onMoveUp} className="p-1 rounded-full hover:bg-surface-container-high text-on-surface-variant" aria-label="Move up">
                <span className="material-symbols-outlined text-[18px]">arrow_back_ios</span>
              </button>
            )}
            {!isLast && (
              <button onClick={onMoveDown} className="p-1 rounded-full hover:bg-surface-container-high text-on-surface-variant" aria-label="Move down">
                <span className="material-symbols-outlined text-[18px] rotate-180">arrow_back_ios</span>
              </button>
            )}
            <button onClick={onEdit} className="p-1 rounded-full hover:bg-surface-container-high text-on-surface-variant" aria-label="Edit chart">
              <span className="material-symbols-outlined text-[18px]">tune</span>
            </button>
            <button onClick={onRemove} className="p-1 rounded-full hover:bg-surface-container-high text-error" aria-label="Remove chart">
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        )}
      </div>

      {data.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-on-surface-variant text-sm">No data</div>
      ) : slot.chartType === "donut" ? (
        <SimpleDonutChart
          data={data.map((d) => ({ label: d.label, value: d.value, color: d.color ?? "rgb(var(--primary-container))" }))}
          height={180}
        />
      ) : slot.chartType === "line" ? (
        <SimpleLineChart data={data} height={192} />
      ) : (
        <SimpleBarChart
          data={data.map((d) => ({ label: d.label, value: d.value, color: d.color }))}
          height={192}
        />
      )}
    </div>
  );
}
