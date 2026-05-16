import { useState, useRef, useCallback, useEffect, useId } from "react";
import ChartTooltip from "./ChartTooltip";
import { mean as calcMean } from "../../lib/dashboard/stats";

interface BarItem {
  label: string;
  value: number;
  color?: string;
  peakLabel?: string;
}

interface SimpleBarChartProps {
  data: BarItem[];
  height?: number;
  defaultColor?: string;
  gap?: number;
  radius?: number;
  renderTooltip?: (item: BarItem, idx: number) => React.ReactNode;
  layout?: "vertical" | "horizontal";
  labelFormatter?: (label: string, idx: number, isPeak: boolean) => React.ReactNode;
  showXAxis?: boolean;
  showMeanLine?: boolean;
  title?: string;
}

export default function SimpleBarChart({
  data,
  height = 192,
  defaultColor = "rgb(var(--primary-container))",
  gap = 0.15,
  radius = 2,
  renderTooltip,
  layout = "vertical",
  labelFormatter,
  showXAxis = true,
  showMeanLine = false,
  title,
}: SimpleBarChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);
  const [svgWidth, setSvgWidth] = useState(300);
  const titleId = useId();

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSvgWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGRectElement>, idx: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    setHover({ idx, x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

  if (!data.length) return null;
  const maxVal = Math.max(...data.map((d) => d.value), 1);

  if (layout === "horizontal") {
    const barH = 18;
    const labelW = 100;
    const rowH = barH + 10;
    const svgH = Math.max(height, data.length * rowH);
    return (
      <div className="w-full overflow-visible relative" style={{ height: svgH }}>
        <svg ref={svgRef} width="100%" height={svgH} className="block" role="img" aria-labelledby={title ? `${titleId}-h` : undefined}>
          {title && <title id={`${titleId}-h`}>{title}</title>}
          {data.map((d, i) => {
            const y = i * rowH + 4;
            const barW = maxVal > 0 ? (svgWidth - labelW - 16) * (d.value / maxVal) : 0;
            return (
              <g key={d.label}>
                <text x={0} y={y + barH / 2 + 4} fontSize={10} fontWeight={600} fill="rgb(var(--on-surface-variant))" fontFamily="'Inter Variable', Inter, sans-serif">
                  {d.label}
                </text>
                <rect
                  x={labelW}
                  y={y}
                  width={Math.max(barW, 2)}
                  height={barH}
                  rx={radius}
                  fill={d.color ?? defaultColor}
                  onMouseMove={(e) => handleMouseMove(e, i)}
                  onMouseLeave={() => setHover(null)}
                  className="cursor-pointer"
                />
              </g>
            );
          })}
        </svg>
        <ChartTooltip x={hover?.x ?? 0} y={hover?.y ?? 0} visible={hover !== null} containerRef={svgRef}>
          {hover !== null && renderTooltip?.(data[hover.idx], hover.idx)}
        </ChartTooltip>
      </div>
    );
  }

  const padding = { top: 24, right: 8, bottom: showXAxis ? 28 : 4, left: 8 };
  const chartH = height - padding.top - padding.bottom;

  return (
    <div className="w-full overflow-visible relative" style={{ height }}>
      <svg ref={svgRef} width="100%" height={height} className="block" role="img" aria-labelledby={title ? `${titleId}-v` : undefined}>
        {title && <title id={`${titleId}-v`}>{title}</title>}
        {data.map((d, i) => {
          const n = data.length;
          const totalW = Math.max(svgWidth - padding.left - padding.right, 0);
          const slotW = totalW / n;
          const barW = slotW * (1 - gap);
          const barX = padding.left + i * slotW + (slotW - barW) / 2;
          const barH = maxVal > 0 ? (d.value / maxVal) * chartH : 0;
          const barY = padding.top + chartH - barH;

          return (
            <g key={`${d.label}-${i}`}>
              {d.peakLabel && (
                <text
                  x={barX + barW / 2}
                  y={barY - 4}
                  textAnchor="middle"
                  fill={d.color ?? defaultColor}
                  fontSize={8}
                  fontWeight={700}
                  fontFamily="'Inter Variable', Inter, sans-serif"
                  letterSpacing={1}
                >
                  {d.peakLabel}
                </text>
              )}
              <rect
                x={barX}
                y={barY}
                width={Math.max(barW, 1)}
                height={Math.max(barH, 0)}
                rx={radius}
                fill={d.color ?? defaultColor}
                onMouseMove={(e) => handleMouseMove(e, i)}
                onMouseLeave={() => setHover(null)}
                className="cursor-pointer"
              />
              {showXAxis && (
                <g transform={`translate(${barX + barW / 2}, ${height - padding.bottom + 14})`}>
                  {labelFormatter ? (
                    labelFormatter(d.label, i, !!d.peakLabel)
                  ) : (
                    <text
                      textAnchor="middle"
                      fontSize={10}
                      fontWeight={600}
                      fill="rgb(var(--on-surface-variant))"
                      fontFamily="'Inter Variable', Inter, sans-serif"
                    >
                      {d.label}
                    </text>
                  )}
                </g>
              )}
            </g>
          );
        })}
        {showMeanLine && (() => {
          const m = calcMean(data.map(d => d.value));
          const yM = padding.top + chartH - (m / maxVal) * chartH;
          return (
            <g>
              <line x1={padding.left} x2={padding.left + svgWidth - padding.left - padding.right} y1={yM} y2={yM} stroke="rgb(var(--error))" strokeWidth={1} strokeDasharray="6 3" strokeOpacity={0.6} />
              <text x={svgWidth - padding.right + 2} y={yM + 3} fontSize={8} fontWeight={700} fill="rgb(var(--error))" fillOpacity={0.7} fontFamily="'Inter Variable', Inter, sans-serif">AVG</text>
            </g>
          );
        })()}
      </svg>
      <ChartTooltip x={hover?.x ?? 0} y={hover?.y ?? 0} visible={hover !== null} containerRef={svgRef}>
        {hover !== null && renderTooltip?.(data[hover.idx], hover.idx)}
      </ChartTooltip>
    </div>
  );
}
