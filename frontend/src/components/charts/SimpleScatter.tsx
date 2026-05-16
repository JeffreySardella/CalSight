import { useState, useRef, useCallback, useEffect } from "react";
import ChartTooltip from "./ChartTooltip";
import { linearRegressionXY } from "../../lib/dashboard/stats";

interface ScatterItem {
  label: string;
  value: number;
  x?: number;
  y?: number;
  color?: string;
}

interface SimpleScatterProps {
  data: ScatterItem[];
  height?: number;
  xLabel?: string;
  yLabel?: string;
  color?: string;
  renderTooltip?: (item: ScatterItem, idx: number) => React.ReactNode;
}

function formatNumber(val: number): string {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return val.toLocaleString();
}

const COLORS = [
  "#2563eb", "#dc2626", "#059669", "#7c3aed", "#d97706",
  "#0891b2", "#e11d48", "#4f46e5", "#0d9488", "#ca8a04",
];

export default function SimpleScatter({
  data,
  height = 240,
  xLabel = "Crashes",
  yLabel = "Fatalities",
  color,
  renderTooltip,
}: SimpleScatterProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);
  const [svgWidth, setSvgWidth] = useState(400);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSvgWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent, idx: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    setHover({ idx, x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

  if (!data.length) return null;

  const points = data.map((d) => ({
    xVal: d.x ?? d.value,
    yVal: d.y ?? 0,
  }));

  const maxX = Math.max(...points.map((p) => p.xVal), 1);
  const maxY = Math.max(...points.map((p) => p.yVal), 1);

  const padding = { top: 16, right: 16, bottom: 36, left: 56 };
  const chartW = svgWidth - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const xTicks = 4;
  const yTicks = 4;

  return (
    <div className="w-full overflow-visible relative" style={{ height }}>
      <svg ref={svgRef} width="100%" height={height} className="block">
        {Array.from({ length: yTicks + 1 }).map((_, i) => {
          const v = Math.round((maxY / yTicks) * i);
          const py = padding.top + chartH - (v / maxY) * chartH;
          return (
            <g key={`y-${i}`}>
              <line x1={padding.left} x2={padding.left + chartW} y1={py} y2={py} stroke="rgb(var(--outline-variant))" strokeOpacity={0.15} />
              <text x={padding.left - 8} y={py + 3} textAnchor="end" fontSize={9} fill="rgb(var(--on-surface-variant))" fontFamily="'Inter Variable', Inter, sans-serif">
                {formatNumber(v)}
              </text>
            </g>
          );
        })}
        {Array.from({ length: xTicks + 1 }).map((_, i) => {
          const v = Math.round((maxX / xTicks) * i);
          const px = padding.left + (v / maxX) * chartW;
          return (
            <g key={`x-${i}`}>
              <line x1={px} x2={px} y1={padding.top} y2={padding.top + chartH} stroke="rgb(var(--outline-variant))" strokeOpacity={0.1} />
              <text x={px} y={height - padding.bottom + 16} textAnchor="middle" fontSize={9} fill="rgb(var(--on-surface-variant))" fontFamily="'Inter Variable', Inter, sans-serif">
                {formatNumber(v)}
              </text>
            </g>
          );
        })}

        <text x="50%" y={height - 4} textAnchor="middle" fontSize={9} fontWeight={600} fill="rgb(var(--on-surface-variant))" fontFamily="'Inter Variable', Inter, sans-serif">
          {xLabel}
        </text>
        <text x={12} y={height / 2} textAnchor="middle" fontSize={9} fontWeight={600} fill="rgb(var(--on-surface-variant))" fontFamily="'Inter Variable', Inter, sans-serif" transform={`rotate(-90, 12, ${height / 2})`}>
          {yLabel}
        </text>

        {points.length >= 3 && (() => {
          const reg = linearRegressionXY(points.map(p => ({ x: p.xVal, y: p.yVal })));
          const x0 = padding.left;
          const xN = padding.left + chartW;
          const y0Val = reg.intercept;
          const yNVal = reg.slope * maxX + reg.intercept;
          const y0 = padding.top + chartH - (Math.max(0, Math.min(y0Val, maxY)) / maxY) * chartH;
          const yN = padding.top + chartH - (Math.max(0, Math.min(yNVal, maxY)) / maxY) * chartH;
          return (
            <g>
              <line x1={x0} x2={xN} y1={y0} y2={yN} stroke="rgb(var(--error))" strokeWidth={1.5} strokeDasharray="6 3" strokeOpacity={0.5} />
              <text x={xN - 4} y={yN - 8} textAnchor="end" fontSize={9} fontWeight={700} fill="rgb(var(--error))" fillOpacity={0.7} fontFamily="'Inter Variable', Inter, sans-serif">
                R²={reg.r2.toFixed(2)}
              </text>
            </g>
          );
        })()}

        {data.map((d, i) => {
          const px = padding.left + (points[i].xVal / maxX) * chartW;
          const py = padding.top + chartH - (points[i].yVal / maxY) * chartH;
          const isHovered = hover?.idx === i;
          const dotColor = d.color ?? color ?? COLORS[i % COLORS.length];
          const r = isHovered ? 7 : Math.max(4, Math.min(8, (d.value / data.reduce((s, dd) => s + dd.value, 0)) * 60));
          return (
            <circle
              key={d.label}
              cx={px}
              cy={py}
              r={r}
              fill={dotColor}
              fillOpacity={isHovered ? 0.95 : 0.7}
              stroke={isHovered ? dotColor : "none"}
              strokeWidth={2}
              strokeOpacity={0.3}
              onMouseMove={(e) => handleMouseMove(e, i)}
              onMouseLeave={() => setHover(null)}
              className="cursor-pointer transition-all"
            />
          );
        })}

        {hover !== null && data[hover.idx] && (() => {
          const d = data[hover.idx];
          const px = padding.left + (points[hover.idx].xVal / maxX) * chartW;
          const py = padding.top + chartH - (points[hover.idx].yVal / maxY) * chartH;
          const labelLen = d.label.length * 5.5 + 8;
          const lx = px + 10;
          const showLeft = lx + labelLen > svgWidth - 8;
          return (
            <text
              x={showLeft ? px - 10 : lx}
              y={py - 2}
              textAnchor={showLeft ? "end" : "start"}
              fontSize={10}
              fontWeight={700}
              fill="rgb(var(--on-surface))"
              fontFamily="'Inter Variable', Inter, sans-serif"
            >
              {d.label}
            </text>
          );
        })()}
      </svg>
      <ChartTooltip x={hover?.x ?? 0} y={hover?.y ?? 0} visible={hover !== null} containerRef={svgRef}>
        {hover !== null && renderTooltip?.(data[hover.idx], hover.idx)}
      </ChartTooltip>
    </div>
  );
}
