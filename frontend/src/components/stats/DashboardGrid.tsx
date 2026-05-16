import { useState } from "react";
import type { ChartSlot, Dimension, Measure, ChartType } from "../../lib/dashboard/types";
import type { ChartDataItem } from "../../hooks/useDashboardData";
import ChartCard from "./ChartCard";
import AddChartCard from "./AddChartCard";
import ChartConfigPanel from "./ChartConfigPanel";
import ChartConfigSheet from "./ChartConfigSheet";

type ChartConfig = { dimension: Dimension; measure: Measure; chartType: ChartType; splitBy?: Dimension };

interface Props {
  charts: ChartSlot[];
  dataByDimension: Record<string, ChartDataItem[]>;
  mode: "simple" | "advanced";
  onAddChart: (config: ChartConfig) => void;
  onRemoveChart: (id: string) => void;
  onUpdateChart: (id: string, updates: Partial<ChartConfig>) => void;
  onMoveChart: (id: string, direction: "up" | "down") => void;
}

export default function DashboardGrid({
  charts, dataByDimension, mode, onAddChart, onRemoveChart, onUpdateChart, onMoveChart,
}: Props) {
  const [configOpen, setConfigOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches;

  const isAdvanced = mode === "advanced";
  const editingSlot = editingId ? charts.find((c) => c.id === editingId) : undefined;

  function handleAdd(config: ChartConfig) {
    onAddChart(config);
    setConfigOpen(false);
  }

  function handleEdit(id: string, config: ChartConfig) {
    onUpdateChart(id, config);
    setEditingId(null);
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {charts.map((slot, idx) =>
          editingId === slot.id && !isMobile ? (
            <ChartConfigPanel
              key={slot.id}
              initial={slot}
              onConfirm={(config) => handleEdit(slot.id, config)}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <ChartCard
              key={slot.id}
              slot={slot}
              data={dataByDimension[slot.dimension] ?? []}
              editing={isAdvanced}
              onEdit={() => setEditingId(slot.id)}
              onRemove={() => onRemoveChart(slot.id)}
              onMoveUp={() => onMoveChart(slot.id, "up")}
              onMoveDown={() => onMoveChart(slot.id, "down")}
              isFirst={idx === 0}
              isLast={idx === charts.length - 1}
            />
          ),
        )}
        {isAdvanced && !configOpen && (
          <AddChartCard onClick={() => setConfigOpen(true)} />
        )}
        {isAdvanced && configOpen && !isMobile && (
          <ChartConfigPanel
            onConfirm={handleAdd}
            onCancel={() => setConfigOpen(false)}
          />
        )}
      </div>

      {isMobile && (
        <>
          <ChartConfigSheet
            open={configOpen}
            onConfirm={(config) => { handleAdd(config); }}
            onCancel={() => setConfigOpen(false)}
          />
          <ChartConfigSheet
            open={!!editingId}
            initial={editingSlot}
            onConfirm={(config) => { if (editingId) handleEdit(editingId, config); }}
            onCancel={() => setEditingId(null)}
          />
        </>
      )}
    </>
  );
}
