import { useState, useEffect, useMemo } from "react";
import type { ChartSlot, Dimension, Measure, ChartType } from "../../lib/dashboard/types";
import type { ChartDataItem } from "../../hooks/useDashboardData";
import { useDragReorder } from "../../hooks/useDragReorder";
import ChartCard from "./ChartCard";
import AddChartCard from "./AddChartCard";
import ChartConfigPanel from "./ChartConfigPanel";
import ChartConfigSheet from "./ChartConfigSheet";
import DragDropIndicator from "./DragDropIndicator";

function slotKey(slot: ChartSlot): string {
  const opts = slot.options ?? {};
  const optStr = [
    opts.cumulative && "cum",
    opts.movingAvg && `ma${opts.movingAvg}`,
    opts.logScale && "log",
  ].filter(Boolean).join(",");
  return `${slot.dimension}:${slot.measure}${optStr ? `:${optStr}` : ""}`;
}

function secondarySlotKey(slot: ChartSlot): string | null {
  if (!slot.secondaryMeasure) return null;
  return `${slot.dimension}:${slot.secondaryMeasure}`;
}

type ChartConfig = { dimension: Dimension; measure: Measure; secondaryMeasure?: Measure; chartType: ChartType; splitBy?: Dimension; options?: import("../../lib/dashboard/types").ChartOptions };

interface Props {
  charts: ChartSlot[];
  dataBySlot: Record<string, ChartDataItem[]>;
  mode: "simple" | "advanced";
  onAddChart: (config: ChartConfig) => void;
  onRemoveChart: (id: string) => void;
  onUpdateChart: (id: string, updates: Partial<ChartConfig>) => void;
  onMoveChart: (id: string, direction: "up" | "down") => void;
  onReorderChart?: (fromIndex: number, toIndex: number) => void;
  /** Increment to close any open config panel (used by keyboard shortcut) */
  closeConfigTrigger?: number;
}

export default function DashboardGrid({
  charts, dataBySlot, mode, onAddChart, onRemoveChart, onUpdateChart, onMoveChart, onReorderChart, closeConfigTrigger,
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

  // Close config panel when triggered externally (e.g. Escape keyboard shortcut)
  useEffect(() => {
    if (closeConfigTrigger && closeConfigTrigger > 0) {
      setConfigOpen(false);
      setEditingId(null);
    }
  }, [closeConfigTrigger]);

  const isAdvanced = mode === "advanced";
  const editingSlot = editingId ? charts.find((c) => c.id === editingId) : undefined;

  // Drag-and-drop reorder
  const chartIds = useMemo(() => charts.map((c) => c.id), [charts]);
  const { dragState, containerProps, getItemProps, getHandleProps, announcement } = useDragReorder({
    items: chartIds,
    onReorder: onReorderChart ?? (() => {}),
    enabled: isAdvanced && !!onReorderChart,
  });

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

      {/* Screen reader announcements for drag-and-drop */}
      <div aria-live="assertive" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      <div
        className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 ${dragState.isDragging ? "drag-active" : ""}`}
        {...containerProps}
      >
        {charts.map((slot, idx) => {
          const itemProps = isAdvanced && onReorderChart ? getItemProps(slot.id, idx) : {};
          const handleProps = isAdvanced && onReorderChart ? getHandleProps(slot.id) : null;

          return editingId === slot.id && !isMobile ? (
            <ChartConfigPanel
              key={slot.id}
              initial={slot}
              onConfirm={(config) => handleEdit(slot.id, config)}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <div key={slot.id} className="relative" {...itemProps}>
              {dragState.isDragging && dragState.overIndex === idx && dragState.dragId !== slot.id && (
                <DragDropIndicator position="before" />
              )}
              <ChartCard
                slot={slot}
                data={dataBySlot[slotKey(slot)] ?? []}
                secondaryData={secondarySlotKey(slot) ? dataBySlot[secondarySlotKey(slot)!] : undefined}
                editing={isAdvanced}
                onEdit={() => setEditingId(slot.id)}
                onRemove={() => onRemoveChart(slot.id)}
                onMoveUp={() => onMoveChart(slot.id, "up")}
                onMoveDown={() => onMoveChart(slot.id, "down")}
                isFirst={idx === 0}
                isLast={idx === charts.length - 1}
                enterDelay={idx * 40}
                dragHandleProps={handleProps}
              />
              {dragState.isDragging && dragState.overIndex === idx + 1 && idx === charts.length - 1 && dragState.dragId !== slot.id && (
                <DragDropIndicator position="after" />
              )}
            </div>
          );
        })}
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
