import { useState } from "react";
import { DIMENSIONS, DIMENSION_LABELS, MEASURE_LABELS, defaultChartType } from "../../lib/dashboard/types";
import type { Dimension, Measure, ChartType, ChartOptions } from "../../lib/dashboard/types";

interface ChartConfig {
  dimension: Dimension;
  measure: Measure;
  secondaryMeasure?: Measure;
  chartType: ChartType;
  splitBy?: Dimension;
  options?: ChartOptions;
}

interface Props {
  initial?: ChartConfig;
  onConfirm: (config: ChartConfig) => void;
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
  { value: "scatter", label: "Scatter" },
  { value: "gauge", label: "Gauge" },
  { value: "stat", label: "Stat" },
];

const SUPPORTED_MEASURES: { value: Measure; label: string }[] = [
  { value: "count", label: MEASURE_LABELS.count },
  { value: "killed", label: MEASURE_LABELS.killed },
  { value: "injured", label: MEASURE_LABELS.injured },
  { value: "percentage", label: MEASURE_LABELS.percentage },
  { value: "fatality_rate", label: MEASURE_LABELS.fatality_rate },
  { value: "yoy_change", label: MEASURE_LABELS.yoy_change },
];

const SUPPORTS_DUAL_AXIS = new Set<ChartType>(["line", "area"]);
// scatter always draws its own regression line unconditionally — no toggle needed
const SUPPORTS_TREND = new Set<ChartType>(["line", "area"]);
const SUPPORTS_MEAN = new Set<ChartType>(["bar", "line", "area"]);
// logScale, cumulative, movingAvg are not implemented in any chart component
const SUPPORTS_LOG = new Set<ChartType>([]);
const SUPPORTS_CUMULATIVE = new Set<ChartType>([]);
const SUPPORTS_MA = new Set<ChartType>([]);
const SUPPORTS_STD = new Set<ChartType>(["line", "area"]);
// outliers marker is only implemented in SimpleLineChart, not SimpleBarChart
const SUPPORTS_OUTLIERS = new Set<ChartType>(["line", "area"]);
const SUPPORTS_FORECAST = new Set<ChartType>(["line", "area"]);

export default function ChartConfigPanel({ initial, onConfirm, onCancel }: Props) {
  const [dimension, setDimension] = useState<Dimension>(initial?.dimension ?? "hour");
  const [measure, setMeasure] = useState<Measure>(initial?.measure ?? "count");
  const [secondaryMeasure, setSecondaryMeasure] = useState<Measure | undefined>(initial?.secondaryMeasure);
  const [chartType, setChartType] = useState<ChartType>(initial?.chartType ?? defaultChartType("hour"));
  const [options, setOptions] = useState<ChartOptions>(initial?.options ?? {});

  function handleDimensionChange(dim: Dimension) {
    setDimension(dim);
    setChartType(defaultChartType(dim));
  }

  function toggle(key: keyof ChartOptions) {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const hasOptions = SUPPORTS_TREND.has(chartType) || SUPPORTS_MEAN.has(chartType) ||
    SUPPORTS_LOG.has(chartType) || SUPPORTS_CUMULATIVE.has(chartType) || SUPPORTS_MA.has(chartType) ||
    SUPPORTS_STD.has(chartType) || SUPPORTS_OUTLIERS.has(chartType);

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

      {SUPPORTS_DUAL_AXIS.has(chartType) && (
        <div>
          <label htmlFor="cfg-secondary" className="block text-xs font-medium text-on-surface-variant mb-1">
            Secondary Measure (Right Axis)
          </label>
          <select
            id="cfg-secondary"
            value={secondaryMeasure ?? ""}
            onChange={(e) => setSecondaryMeasure(e.target.value ? e.target.value as Measure : undefined)}
            className="w-full rounded-lg bg-surface-container px-3 py-2 text-sm text-on-surface"
          >
            <option value="">None (single axis)</option>
            {SUPPORTED_MEASURES.filter((m) => m.value !== measure).map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          {secondaryMeasure && (
            <p className="text-[10px] text-on-surface-variant mt-1">
              Dual axis: {MEASURE_LABELS[measure]} (left) vs {MEASURE_LABELS[secondaryMeasure]} (right)
            </p>
          )}
        </div>
      )}

      <div>
        <div className="text-xs font-medium text-on-surface-variant mb-1">Chart Type</div>
        <div role="radiogroup" aria-label="Chart type" className="grid grid-cols-4 gap-1 bg-surface-container-high rounded-xl p-1">
          {CHART_TYPES.map((ct) => (
            <button
              key={ct.value}
              role="radio"
              aria-checked={chartType === ct.value}
              onClick={() => setChartType(ct.value)}
              className={`min-h-[44px] px-2 py-2 rounded-lg text-[11px] font-medium transition-colors ${
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

      {hasOptions && (
        <div>
          <div className="text-xs font-medium text-on-surface-variant mb-1.5">Overlays &amp; Transforms</div>
          <div className="flex flex-wrap gap-1.5">
            {SUPPORTS_TREND.has(chartType) && (
              <button
                onClick={() => toggle("trendLine")}
                aria-pressed={!!options.trendLine}
                className={`px-3 py-2 min-h-[44px] rounded-full text-[10px] font-medium border transition-colors flex items-center ${
                  options.trendLine ? "bg-primary text-on-primary border-primary" : "border-outline-variant text-on-surface-variant hover:text-on-surface"
                }`}
              >
                Trend Line
              </button>
            )}
            {SUPPORTS_MEAN.has(chartType) && (
              <button
                onClick={() => toggle("meanLine")}
                aria-pressed={!!options.meanLine}
                className={`px-3 py-2 min-h-[44px] rounded-full text-[10px] font-medium border transition-colors flex items-center ${
                  options.meanLine ? "bg-primary text-on-primary border-primary" : "border-outline-variant text-on-surface-variant hover:text-on-surface"
                }`}
              >
                Mean Line
              </button>
            )}
            {SUPPORTS_LOG.has(chartType) && (
              <button
                onClick={() => toggle("logScale")}
                aria-pressed={!!options.logScale}
                className={`px-3 py-2 min-h-[44px] rounded-full text-[10px] font-medium border transition-colors flex items-center ${
                  options.logScale ? "bg-primary text-on-primary border-primary" : "border-outline-variant text-on-surface-variant hover:text-on-surface"
                }`}
              >
                Log Scale
              </button>
            )}
            {SUPPORTS_CUMULATIVE.has(chartType) && (
              <button
                onClick={() => toggle("cumulative")}
                aria-pressed={!!options.cumulative}
                className={`px-3 py-2 min-h-[44px] rounded-full text-[10px] font-medium border transition-colors flex items-center ${
                  options.cumulative ? "bg-primary text-on-primary border-primary" : "border-outline-variant text-on-surface-variant hover:text-on-surface"
                }`}
              >
                Cumulative
              </button>
            )}
            {SUPPORTS_STD.has(chartType) && (
              <button
                onClick={() => toggle("stdBand")}
                aria-pressed={!!options.stdBand}
                className={`px-3 py-2 min-h-[44px] rounded-full text-[10px] font-medium border transition-colors flex items-center ${
                  options.stdBand ? "bg-primary text-on-primary border-primary" : "border-outline-variant text-on-surface-variant hover:text-on-surface"
                }`}
              >
                ±1σ Band
              </button>
            )}
            {SUPPORTS_OUTLIERS.has(chartType) && (
              <button
                onClick={() => toggle("outliers")}
                aria-pressed={!!options.outliers}
                className={`px-3 py-2 min-h-[44px] rounded-full text-[10px] font-medium border transition-colors flex items-center ${
                  options.outliers ? "bg-primary text-on-primary border-primary" : "border-outline-variant text-on-surface-variant hover:text-on-surface"
                }`}
              >
                Outliers
              </button>
            )}
            {SUPPORTS_MA.has(chartType) && (
              <button
                onClick={() => setOptions((prev) => ({ ...prev, movingAvg: prev.movingAvg ? undefined : 3 }))}
                aria-pressed={!!options.movingAvg}
                className={`px-3 py-2 min-h-[44px] rounded-full text-[10px] font-medium border transition-colors flex items-center ${
                  options.movingAvg ? "bg-primary text-on-primary border-primary" : "border-outline-variant text-on-surface-variant hover:text-on-surface"
                }`}
              >
                Moving Avg
              </button>
            )}
            {SUPPORTS_FORECAST.has(chartType) && dimension === "year" && (
              <button
                onClick={() => toggle("forecast")}
                aria-pressed={!!options.forecast}
                className={`px-3 py-2 min-h-[44px] rounded-full text-[10px] font-medium border transition-colors flex items-center ${
                  options.forecast ? "bg-tertiary text-on-tertiary border-tertiary" : "border-outline-variant text-on-surface-variant hover:text-on-surface"
                }`}
              >
                Forecast
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <button
          onClick={onCancel}
          className="flex-1 px-4 py-2 min-h-[44px] rounded-full text-sm font-medium text-on-surface-variant bg-surface-container hover:bg-surface-container-high transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => {
            const hasOpts = Object.values(options).some(v => v !== undefined && v !== false);
            onConfirm({ dimension, measure, secondaryMeasure, chartType, options: hasOpts ? options : undefined });
          }}
          className="flex-1 px-4 py-2 min-h-[44px] rounded-full text-sm font-medium text-on-primary bg-primary hover:opacity-90 transition-opacity"
        >
          {initial ? "Update" : "Add"}
        </button>
      </div>
    </div>
  );
}
