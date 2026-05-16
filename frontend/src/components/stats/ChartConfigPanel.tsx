import { useState } from "react";
import { DIMENSIONS, DIMENSION_LABELS, MEASURE_LABELS, defaultChartType } from "../../lib/dashboard/types";
import type { Dimension, Measure, ChartType } from "../../lib/dashboard/types";

interface Props {
  initial?: { dimension: Dimension; measure: Measure; chartType: ChartType; splitBy?: Dimension };
  onConfirm: (config: { dimension: Dimension; measure: Measure; chartType: ChartType; splitBy?: Dimension }) => void;
  onCancel: () => void;
}

const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: "bar", label: "Bar" },
  { value: "hbar", label: "H-Bar" },
  { value: "lollipop", label: "Lollipop" },
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "donut", label: "Donut" },
  { value: "treemap", label: "Treemap" },
  { value: "polar", label: "Polar" },
  { value: "radar", label: "Radar" },
  { value: "gauge", label: "Gauge" },
  { value: "stat", label: "Stat" },
];

const SUPPORTED_MEASURES: { value: Measure; label: string }[] = [
  { value: "count", label: MEASURE_LABELS.count },
  { value: "killed", label: MEASURE_LABELS.killed },
  { value: "injured", label: MEASURE_LABELS.injured },
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
        <div role="radiogroup" aria-label="Chart type" className="flex flex-wrap gap-1 bg-surface-container-high rounded-xl p-1">
          {CHART_TYPES.map((ct) => (
            <button
              key={ct.value}
              role="radio"
              aria-checked={chartType === ct.value}
              onClick={() => setChartType(ct.value)}
              className={`flex-1 min-w-[60px] px-2 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                chartType === ct.value
                  ? "bg-primary text-on-primary"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
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
