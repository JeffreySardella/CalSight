import { useState, useEffect } from "react";
import type { ChartSlot, Dimension, Measure, ChartType } from "../../lib/dashboard/types";
import type { ChartDataItem } from "../../hooks/useDashboardData";
import ChartCard from "./ChartCard";
import AddChartCard from "./AddChartCard";
import ChartConfigPanel from "./ChartConfigPanel";
import ChartConfigSheet from "./ChartConfigSheet";

function slotKey(slot: ChartSlot): string {
  return `${slot.dimension}:${slot.measure}`;
}

type ChartConfig = { dimension: Dimension; measure: Measure; chartType: ChartType; splitBy?: Dimension };

interface Props {
  charts: ChartSlot[];
  dataBySlot: Record<string, ChartDataItem[]>;
  mode: "simple" | "advanced";
  onAddChart: (config: ChartConfig) => void;
  onRemoveChart: (id: string) => void;
  onUpdateChart: (id: string, updates: Partial<ChartConfig>) => void;
  onMoveChart: (id: string, direction: "up" | "down") => void;
}

export default function DashboardGrid({
  charts, dataBySlot, mode, onAddChart, onRemoveChart, onUpdateChart, onMoveChart,
}: Props) {
  const [configOpen, setConfigOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addKey, setAddKey] = useState(0);

  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const isAdvanced = mode === "advanced";
  const editingSlot = editingId ? charts.find((c) => c.id === editingId) : undefined;

  const sheetOpen = isMobile && (configOpen || !!editingId);
  const sheetInitial = editingId ? editingSlot : undefined;

  function handleAdd(config: ChartConfig) {
    onAddChart(config);
    setConfigOpen(false);
    setAddKey((k) => k + 1);
  }

  function handleEdit(id: string, config: ChartConfig) {
    onUpdateChart(id, config);
    setEditingId(null);
  }

  function handleSheetConfirm(config: ChartConfig) {
    if (editingId) {
      handleEdit(editingId, config);
    } else {
      handleAdd(config);
    }
  }

  function handleSheetCancel() {
    setConfigOpen(false);
    setEditingId(null);
  }

  return (
    <>
      {isAdvanced && charts.length === 0 && !configOpen && (
        <p className="text-sm text-on-surface-variant mb-2">Build your own dashboard — choose any combination of dimensions and chart types.</p>
      )}
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
              data={dataBySlot[slotKey(slot)] ?? []}
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
            key={`add-${addKey}`}
            onConfirm={handleAdd}
            onCancel={() => setConfigOpen(false)}
          />
        )}
      </div>

      {isMobile && (
        <ChartConfigSheet
          key={editingId ?? "add"}
          open={sheetOpen}
          initial={sheetInitial}
          onConfirm={handleSheetConfirm}
          onCancel={handleSheetCancel}
        />
      )}
    </>
  );
}
