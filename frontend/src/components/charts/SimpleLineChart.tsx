import { useState, useRef, useCallback, useEffect, useId } from "react";
import ChartTooltip from "./ChartTooltip";
import { linearRegression, mean as calcMean, stddev as calcStddev } from "../../lib/dashboard/stats";

interface LinePoint {
  label: string;
  value: number;
}

interface SimpleLineChartProps {
  data: LinePoint[];
  height?: number;
  color?: string;
  showDots?: boolean;
  showYAxis?: boolean;
  showArea?: boolean;
  showTrendLine?: boolean;
  showMeanLine?: boolean;
  showStdBand?: boolean;
  showOutliers?: boolean;
  renderTooltip?: (item: LinePoint, idx: number) => React.ReactNode;
  title?: string;
}

function formatNumber(val: number): string {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return val.toLocaleString();
}

export default function SimpleLineChart({
  data,
  height = 180,
  color = "rgb(var(--primary))",
  showDots = true,
  showYAxis = true,
  showArea = false,
  showTrendLine = false,
  showMeanLine = false,
  showStdBand = false,
  showOutliers = false,
  renderTooltip,
  title,
}: SimpleLineChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);
  const [svgWidth, setSvgWidth] = useState(400);
  const titleId = useId();

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSvgWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGCircleElement | SVGRectElement>, idx: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    setHover({ idx, x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

  if (!data.length) return null;

  const maxVal = Math.max(...data.map((d) => d.value), 1);
  const yAxisW = showYAxis ? 50 : 0;
  const padding = { top: 12, right: 12, bottom: 32, left: yAxisW + 8 };
  const chartH = height - padding.top - padding.bottom;
  const chartW = svgWidth - padding.left - padding.right;
  const n = data.length;

  const yTicks = 4;
  const yTickVals = Array.from({ length: yTicks + 1 }, (_, i) => Math.round((maxVal / yTicks) * i));

  const points = n >= 2
    ? data.map((d, i) => ({
        x: padding.left + (i / (n - 1)) * chartW,
        y: padding.top + chartH - (d.value / maxVal) * chartH,
      }))
    : [{ x: padding.left + chartW / 2, y: padding.top + chartH - (data[0].value / maxVal) * chartH }];

  const pathD = points.length >= 2
    ? points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ")
    : "";

  const interval = n > 12 ? Math.ceil(n / 6) : 1;

  return (
    <div className="w-full overflow-visible relative" style={{ height }}>
      <svg ref={svgRef} width="100%" height={height} className="block" role="img" aria-labelledby={title ? titleId : undefined}>
        {title && <title id={titleId}>{title}</title>}
        {showYAxis && yTickVals.map((v) => {
          const y = padding.top + chartH - (v / maxVal) * chartH;
          return (
            <g key={v}>
              <line x1={padding.left} x2="100%" y1={y} y2={y} stroke="rgb(var(--outline-variant))" strokeOpacity={0.2} />
              <text x={padding.left - 6} y={y + 3} textAnchor="end" fontSize={10} fill="rgb(var(--on-surface-variant))" fontFamily="'Inter Variable', Inter, sans-serif">
                {formatNumber(v)}
              </text>
            </g>
          );
        })}

        {pathD && showArea && points.length >= 2 && (
          <path
            d={`${pathD} L ${points[points.length - 1].x} ${padding.top + chartH} L ${points[0].x} ${padding.top + chartH} Z`}
            fill={color}
            fillOpacity={0.2}
            stroke="none"
          />
        )}
        {pathD && <path d={pathD} fill="none" stroke={color} strokeWidth={2} />}

        {points.map((p, i) => (
          <g key={i}>
            {showDots && (
              <circle cx={p.x} cy={p.y} r={3} fill={color} stroke="rgb(var(--surface))" strokeWidth={1.5} />
            )}
            <rect
              x={p.x - (n >= 2 ? chartW / n / 2 : 20)}
              y={padding.top}
              width={n >= 2 ? chartW / n : 40}
              height={chartH}
              fill="transparent"
              onMouseMove={(e) => handleMouseMove(e, i)}
              onMouseLeave={() => setHover(null)}
              className="cursor-pointer"
            />
            {i % interval === 0 && (
              <text
                x={p.x}
                y={height - padding.bottom + 16}
                textAnchor="middle"
                fontSize={10}
                fill="rgb(var(--on-surface-variant))"
                fontFamily="'Inter Variable', Inter, sans-serif"
              >
                {data[i].label}
              </text>
            )}
          </g>
        ))}

        {showMeanLine && (() => {
          const m = calcMean(data.map(d => d.value));
          const yM = padding.top + chartH - (m / maxVal) * chartH;
          return (
            <g>
              <line x1={padding.left} x2={padding.left + chartW} y1={yM} y2={yM} stroke="rgb(var(--error))" strokeWidth={1} strokeDasharray="6 3" strokeOpacity={0.6} />
              <text x={padding.left + chartW - 4} y={yM + 3} textAnchor="end" fontSize={8} fontWeight={700} fill="rgb(var(--error))" fillOpacity={0.7} fontFamily="'Inter Variable', Inter, sans-serif">AVG</text>
            </g>
          );
        })()}

        {showStdBand && points.length >= 3 && (() => {
          const vals = data.map(d => d.value);
          const m = calcMean(vals);
          const sd = calcStddev(vals);
          const yUpper = padding.top + chartH - (Math.min(m + sd, maxVal) / maxVal) * chartH;
          const yLower = padding.top + chartH - (Math.max(m - sd, 0) / maxVal) * chartH;
          return (
            <rect
              x={padding.left}
              y={yUpper}
              width={chartW}
              height={yLower - yUpper}
              fill="rgb(var(--primary))"
              fillOpacity={0.08}
              rx={4}
            />
          );
        })()}

        {showOutliers && points.length >= 4 && (() => {
          const vals = data.map(d => d.value);
          const m = calcMean(vals);
          const sd = calcStddev(vals);
          return points.map((p, i) => {
            const z = sd > 0 ? Math.abs((data[i].value - m) / sd) : 0;
            if (z < 2) return null;
            return (
              <g key={`outlier-${i}`}>
                <circle cx={p.x} cy={p.y} r={8} fill="none" stroke="rgb(var(--error))" strokeWidth={1.5} strokeDasharray="3 2" />
                <text x={p.x} y={p.y - 12} textAnchor="middle" fontSize={8} fontWeight={700} fill="rgb(var(--error))" fontFamily="'Inter Variable', Inter, sans-serif">
                  {z.toFixed(1)}σ
                </text>
              </g>
            );
          });
        })()}

        {showTrendLine && points.length >= 2 && (() => {
          const reg = linearRegression(data.map(d => d.value));
          const y0 = padding.top + chartH - ((reg.intercept) / maxVal) * chartH;
          const yN = padding.top + chartH - ((reg.slope * (n - 1) + reg.intercept) / maxVal) * chartH;
          return (
            <g>
              <line x1={points[0].x} x2={points[points.length - 1].x} y1={y0} y2={yN} stroke="rgb(var(--tertiary))" strokeWidth={1.5} strokeDasharray="8 4" strokeOpacity={0.7} />
              <text x={padding.left + chartW - 4} y={yN - 6} textAnchor="end" fontSize={8} fontWeight={700} fill="rgb(var(--tertiary))" fillOpacity={0.8} fontFamily="'Inter Variable', Inter, sans-serif">
                R²={reg.r2.toFixed(2)}
              </text>
            </g>
          );
        })()}

        {hover !== null && points[hover.idx] && (
          <line
            x1={points[hover.idx].x}
            x2={points[hover.idx].x}
            y1={padding.top}
            y2={padding.top + chartH}
            stroke={color}
            strokeOpacity={0.3}
            strokeDasharray="4 2"
          />
        )}
      </svg>
      <ChartTooltip x={hover?.x ?? 0} y={hover?.y ?? 0} visible={hover !== null} containerRef={svgRef}>
        {hover !== null && renderTooltip?.(data[hover.idx], hover.idx)}
      </ChartTooltip>
    </div>
  );
}
