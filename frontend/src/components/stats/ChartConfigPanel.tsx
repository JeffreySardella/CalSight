import { useState } from "react";
import { DIMENSIONS, DIMENSION_LABELS, MEASURE_LABELS, defaultChartType } from "../../lib/dashboard/types";
import type { Dimension, Measure, ChartType } from "../../lib/dashboard/types";

interface Props {
  initial?: { dimension: Dimension; measure: Measure; chartType: ChartType; splitBy?: Dimension };
  onConfirm: (config: { dimension: Dimension; measure: Measure; chartType: ChartType; splitBy?: Dimension }) => void;
  onCancel: () => void;
}

const CHART_TYPES: { value: ChartType; label: string; icon: string }[] = [
  { value: "bar", label: "Bar", icon: "bar_chart" },
  { value: "line", label: "Line", icon: "show_chart" },
  { value: "donut", label: "Donut", icon: "donut_large" },
];

const SUPPORTED_MEASURES: { value: Measure; label: string }[] = [
  { value: "count", label: MEASURE_LABELS.count },
];

export default function ChartConfigPanel({ initial, onConfirm, onCancel }: Props) {
  const [dimension, setDimension] = useState<Dimension>(initial?.dimension ?? "hour");
  const [measure, setMeasure] = useState<Measure>(initial?.measure ?? "count");
  const [chartType, setChartType] = useState<ChartType>(initial?.chartType ?? defaultChartType("hour"));

  function handleDimensionChange(dim: Dimension) {
    setDimension(dim);
    setChartType(defaultChartType(dim));
  }

  return (
    <div className="bg-surface-container-lowest rounded-2xl p-4 ambient-shadow space-y-4">
      <h3 className="text-sm font-headline font-bold text-on-surface">
        {initial ? "Edit Chart" : "Add Chart"}
      </h3>

      <div>
        <label htmlFor="cfg-dimension" className="block text-xs font-medium text-on-surface-variant mb-1">Dimension (X Axis)</label>
        <select
          id="cfg-dimension"
          value={dimension}
          onChange={(e) => handleDimensionChange(e.target.value as Dimension)}
          className="w-full rounded-lg bg-surface-container px-3 py-2 text-sm text-on-surface"
        >
          {DIMENSIONS.map((d) => (
            <option key={d} value={d}>{DIMENSION_LABELS[d]}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="cfg-measure" className="block text-xs font-medium text-on-surface-variant mb-1">Measure (Y Axis)</label>
        <select
          id="cfg-measure"
          value={measure}
          onChange={(e) => setMeasure(e.target.value as Measure)}
          className="w-full rounded-lg bg-surface-container px-3 py-2 text-sm text-on-surface"
        >
          {SUPPORTED_MEASURES.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>

      <div>
        <div className="text-xs font-medium text-on-surface-variant mb-1">Chart Type</div>
        <div role="radiogroup" aria-label="Chart type" className="flex gap-1 rounded-full bg-surface-container-high p-0.5">
          {CHART_TYPES.map((ct) => (
            <button
              key={ct.value}
              role="radio"
              aria-checked={chartType === ct.value}
              onClick={() => setChartType(ct.value)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                chartType === ct.value
                  ? "bg-primary text-on-primary"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">{ct.icon}</span>
              {ct.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          onClick={onCancel}
          className="flex-1 px-4 py-2 rounded-full text-sm font-medium text-on-surface-variant bg-surface-container hover:bg-surface-container-high transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => onConfirm({ dimension, measure, chartType })}
          className="flex-1 px-4 py-2 rounded-full text-sm font-medium text-on-primary bg-primary hover:opacity-90 transition-opacity"
        >
          {initial ? "Update" : "Add"}
        </button>
      </div>
    </div>
  );
}
