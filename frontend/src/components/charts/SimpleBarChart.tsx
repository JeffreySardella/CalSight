import { useState, useRef, useCallback, useEffect, useId } from "react";
import ChartTooltip from "./ChartTooltip";
import { mean as calcMean } from "../../lib/dashboard/stats";
import { useChartAnimation } from "../../hooks/useChartAnimation";
import { useTextScale } from "../../hooks/useTextScale";

interface BarItem {
  label: string;
  value: number;
  color?: string;
  peakLabel?: string;
}

export type BarHighlight = "selected" | "dimmed" | "normal";

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
  onBarClick?: (item: BarItem, idx: number) => void;
  getHighlight?: (item: BarItem, idx: number) => BarHighlight;
}

export default function SimpleBarChart({
  data,
  height = 192,
  defaultColor = "rgb(var(--primary))",
  gap = 0.15,
  radius = 2,
  renderTooltip,
  layout = "vertical",
  labelFormatter,
  showXAxis = true,
  showMeanLine = false,
  title,
  onBarClick,
  getHighlight,
}: SimpleBarChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);
  const [svgWidth, setSvgWidth] = useState(300);
  const titleId = useId();
  const { progress } = useChartAnimation(svgRef);
  const ts = useTextScale();

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSvgWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGRectElement>, idx: number) => {
    setHover({ idx, x: e.clientX, y: e.clientY });
  }, []);

  const handleTouchScrub = useCallback((e: React.TouchEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || !data.length) return;
    const rect = svg.getBoundingClientRect();
    const touchX = e.touches[0].clientX - rect.left;
    const padL = 8;
    const padR = 8;
    const n = data.length;
    const totalW = rect.width - padL - padR;
    const slotW = totalW / n;
    const idx = Math.max(0, Math.min(n - 1, Math.floor((touchX - padL) / slotW)));
    setHover({ idx, x: e.touches[0].clientX, y: e.touches[0].clientY });
  }, [data.length]);

  if (!data.length) return null;
  const rawMax = Math.max(...data.map((d) => d.value), 1);
  const maxVal = Number.isFinite(rawMax) ? rawMax : 1;

  if (layout === "horizontal") {
    const barH = 18;
    const labelW = svgWidth < 300 ? 70 : 100;
    const rowH = barH + 10;
    const svgH = Math.max(height, data.length * rowH);
    return (
      <div className="w-full overflow-visible relative" style={{ height: svgH }}>
        <svg ref={svgRef} width="100%" height={svgH} className="block" role="img" aria-labelledby={title ? `${titleId}-h` : undefined}
          onTouchStart={(e) => {
            const svg = svgRef.current;
            if (!svg || !data.length) return;
            const rect = svg.getBoundingClientRect();
            const touchY = e.touches[0].clientY - rect.top;
            const rH = barH + 10;
            const idx = Math.max(0, Math.min(data.length - 1, Math.floor((touchY - 4) / rH)));
            setHover({ idx, x: e.touches[0].clientX, y: e.touches[0].clientY });
          }}
          onTouchEnd={() => setHover(null)}>
          {title && <title id={`${titleId}-h`}>{title}</title>}
          {data.map((d, i) => {
            const y = i * rowH + 4;
            const barW = maxVal > 0 ? (svgWidth - labelW - 16) * (d.value / maxVal) : 0;
            const hl = getHighlight?.(d, i) ?? "normal";
            const hlOpacity = hl === "dimmed" ? 0.3 : 1;
            return (
              <g key={d.label}>
                <text x={0} y={y + barH / 2 + 4} fontSize={10 * ts} fontWeight={600} fill="rgb(var(--on-surface-variant))" fontFamily="'Inter Variable', Inter, sans-serif" textLength={d.label.length * 6 > labelW - 8 ? labelW - 8 : undefined} lengthAdjust="spacingAndGlyphs">
                  {d.label}
                </text>
                <rect
                  x={labelW}
                  y={y}
                  width={Math.max(barW, 2)}
                  height={barH}
                  rx={radius}
                  fill={d.color ?? defaultColor}
                  opacity={hlOpacity}
                  onMouseMove={(e) => handleMouseMove(e, i)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onBarClick?.(d, i)}
                  className="cursor-pointer"
                  style={{ transition: "opacity 0.15s ease" }}
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

  const padding = { top: 28, right: 8, bottom: showXAxis ? 32 : 4, left: 8 };
  const chartH = height - padding.top - padding.bottom;

  return (
    <div className="w-full overflow-visible relative" style={{ height }}>
      <svg ref={svgRef} width="100%" height={height} className="block overflow-visible" role="img" aria-labelledby={title ? `${titleId}-v` : undefined}
        onTouchMove={handleTouchScrub} onTouchEnd={() => setHover(null)}>
        {title && <title id={`${titleId}-v`}>{title}</title>}
        {data.map((d, i) => {
          const n = data.length;
          const totalW = Math.max(svgWidth - padding.left - padding.right, 0);
          const slotW = totalW / n;
          const barW = slotW * (1 - gap);
          const barX = padding.left + i * slotW + (slotW - barW) / 2;
          const rawBarH = maxVal > 0 ? (d.value / maxVal) * chartH : 0;
          const barH = rawBarH * progress;
          const barY = padding.top + chartH - barH;

          return (
            <g key={`${d.label}-${i}`}>
              {d.peakLabel && (
                <text
                  x={barX + barW / 2}
                  y={barY - 4}
                  textAnchor="middle"
                  fill={d.color ?? defaultColor}
                  fontSize={8 * ts}
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
                opacity={(() => {
                  const hl = getHighlight?.(d, i) ?? "normal";
                  if (hl === "dimmed") return 0.5;
                  if (hl === "selected") return 1;
                  return hover !== null && hover.idx !== i ? 0.6 : 1;
                })()}
                style={{
                  transition: "opacity 0.15s ease, height 0.3s ease, y 0.3s ease",
                }}
                onMouseMove={(e) => handleMouseMove(e, i)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onBarClick?.(d, i)}
                className="cursor-pointer"
              />
              {showXAxis && (() => {
                const skipInterval = slotW < 28 ? Math.ceil(28 / slotW) : 1;
                if (i % skipInterval !== 0) return null;
                return (
                  <g transform={`translate(${barX + barW / 2}, ${height - padding.bottom + 14})`}>
                    {labelFormatter ? (
                      labelFormatter(d.label, i, !!d.peakLabel)
                    ) : (
                      <text
                        textAnchor={slotW < 20 ? "end" : "middle"}
                        fontSize={(slotW < 24 ? 8 : 10) * ts}
                        fontWeight={600}
                        fill="rgb(var(--on-surface-variant))"
                        fontFamily="'Inter Variable', Inter, sans-serif"
                        transform={slotW < 20 ? "rotate(-45)" : undefined}
                      >
                        {d.label}
                      </text>
                    )}
                  </g>
                );
              })()}
            </g>
          );
        })}
        {showMeanLine && (() => {
          const m = calcMean(data.map(d => d.value));
          const yM = padding.top + chartH - (m / maxVal) * chartH;
          return (
            <g>
              <line x1={padding.left} x2={padding.left + svgWidth - padding.left - padding.right} y1={yM} y2={yM} stroke="rgb(var(--error))" strokeWidth={1} strokeDasharray="6 3" strokeOpacity={0.6} />
              <text x={svgWidth - padding.right - 2} y={yM - 4} textAnchor="end" fontSize={8 * ts} fontWeight={700} fill="rgb(var(--error))" fillOpacity={0.7} fontFamily="'Inter Variable', Inter, sans-serif">AVG</text>
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
