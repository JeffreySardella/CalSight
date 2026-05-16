import { useMemo } from "react";

export type SparklineTrend = "up" | "down" | "flat";

export interface SparklineProps {
  /** Array of numeric values to plot */
  data: number[];
  /** Width of the SVG (default: 60) */
  width?: number;
  /** Height of the SVG (default: 20) */
  height?: number;
  /** Override stroke color — if not set, auto-colors by trend */
  color?: string;
  /** Show filled area under the line */
  showArea?: boolean;
  /** Show a dot on the last data point */
  showEndDot?: boolean;
  /** Stroke width (default: 1.5) */
  strokeWidth?: number;
  /** Whether "up" is good (green) or bad (red). For crash data, up = bad. Default: false (up = bad) */
  upIsGood?: boolean;
  /** Accessible label for screen readers */
  label?: string;
  /** Additional CSS class on the wrapper */
  className?: string;
}

/**
 * Computes trend direction from data: compares last value to first value.
 * Returns "up" if last > first, "down" if last < first, "flat" otherwise.
 */
export function computeTrend(data: number[]): SparklineTrend {
  if (data.length < 2) return "flat";
  const first = data[0];
  const last = data[data.length - 1];
  if (last > first * 1.02) return "up";
  if (last < first * 0.98) return "down";
  return "flat";
}

/**
 * Returns the appropriate CSS color variable based on trend and context.
 * For crash statistics: going UP is bad (error/red), going DOWN is good (primary/green).
 * Pass upIsGood=true to flip this for metrics where increase is positive.
 */
function trendColor(trend: SparklineTrend, upIsGood: boolean): string {
  if (trend === "flat") return "rgb(var(--on-surface-variant))";
  if (trend === "up") {
    return upIsGood ? "rgb(var(--primary))" : "rgb(var(--error))";
  }
  // trend === "down"
  return upIsGood ? "rgb(var(--error))" : "rgb(var(--primary))";
}

/**
 * Mini sparkline SVG component — a tiny inline chart for use in cards,
 * table cells, filter chips, and preset buttons.
 *
 * Renders a polyline path scaled to fill the provided width/height with
 * appropriate padding. Automatically color-codes based on trend direction.
 */
export default function Sparkline({
  data,
  width = 60,
  height = 20,
  color,
  showArea = true,
  showEndDot = true,
  strokeWidth = 1.5,
  upIsGood = false,
  label,
  className,
}: SparklineProps) {
  const trend = useMemo(() => computeTrend(data), [data]);
  const resolvedColor = color ?? trendColor(trend, upIsGood);

  const { pathD, areaD, lastPoint } = useMemo(() => {
    if (data.length < 2) {
      return { pathD: "", areaD: "", lastPoint: null };
    }

    const padX = 2;
    const padY = 3;
    const plotW = width - padX * 2;
    const plotH = height - padY * 2;

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1; // avoid division by zero

    const points = data.map((v, i) => ({
      x: padX + (i / (data.length - 1)) * plotW,
      y: padY + plotH - ((v - min) / range) * plotH,
    }));

    const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

    const area = `${d} L ${points[points.length - 1].x.toFixed(1)} ${(padY + plotH).toFixed(1)} L ${points[0].x.toFixed(1)} ${(padY + plotH).toFixed(1)} Z`;

    return {
      pathD: d,
      areaD: area,
      lastPoint: points[points.length - 1],
    };
  }, [data, width, height]);

  if (data.length < 2) return null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={label ?? `Sparkline trend: ${trend}`}
      style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0 }}
    >
      {showArea && areaD && (
        <path
          d={areaD}
          fill={resolvedColor}
          fillOpacity={0.12}
          stroke="none"
        />
      )}
      {pathD && (
        <path
          d={pathD}
          fill="none"
          stroke={resolvedColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {showEndDot && lastPoint && (
        <circle
          cx={lastPoint.x}
          cy={lastPoint.y}
          r={2}
          fill={resolvedColor}
        />
      )}
    </svg>
  );
}
