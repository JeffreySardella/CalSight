import { useState, useRef, useCallback, useEffect } from "react";
import ChartTooltip from "./ChartTooltip";

interface LollipopItem {
  label: string;
  value: number;
  color?: string;
}

interface SimpleLollipopProps {
  data: LollipopItem[];
  height?: number;
  defaultColor?: string;
  renderTooltip?: (item: LollipopItem, idx: number) => React.ReactNode;
  title?: string;
}

function formatNumber(val: number): string {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return val.toLocaleString();
}

export default function SimpleLollipop({
  data,
  height = 192,
  defaultColor = "rgb(var(--primary))",
  renderTooltip,
  title,
}: SimpleLollipopProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);
  const [svgWidth, setSvgWidth] = useState(300);

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
  const maxVal = Math.max(...data.map((d) => d.value), 1);
  const labelW = 80;
  const barArea = Math.max(svgWidth - labelW - 40, 0);
  const rowH = Math.min(28, (height - 8) / data.length);
  const svgH = Math.max(height, data.length * rowH + 8);

  return (
    <div className="w-full overflow-visible relative" style={{ height: svgH }}>
      <svg ref={svgRef} width="100%" height={svgH} className="block" role="img" aria-labelledby={title ? "lollipop-chart-title" : undefined}>
        {title && <title id="lollipop-chart-title">{title}</title>}
        {data.map((d, i) => {
          const y = i * rowH + rowH / 2 + 4;
          const w = maxVal > 0 ? (d.value / maxVal) * barArea : 0;
          const color = d.color ?? defaultColor;
          const isHovered = hover?.idx === i;
          return (
            <g
              key={d.label}
              onMouseMove={(e) => handleMouseMove(e, i)}
              onMouseLeave={() => setHover(null)}
              className="cursor-pointer"
            >
              <text
                x={labelW - 6}
                y={y + 3}
                textAnchor="end"
                fontSize={10}
                fontWeight={600}
                fill="rgb(var(--on-surface-variant))"
                fontFamily="'Inter Variable', Inter, sans-serif"
              >
                {d.label.length > 12 ? d.label.slice(0, 11) + "…" : d.label}
              </text>
              <line
                x1={labelW}
                y1={y}
                x2={labelW + w}
                y2={y}
                stroke={color}
                strokeWidth={2}
                strokeOpacity={isHovered ? 1 : 0.6}
              />
              <circle
                cx={labelW + w}
                cy={y}
                r={isHovered ? 6 : 4}
                fill={color}
              />
              {labelW + w + 10 > svgWidth - 36 ? (
                <text
                  x={labelW + w - 10}
                  y={y + 3}
                  textAnchor="end"
                  fontSize={9}
                  fontWeight={700}
                  fill="rgb(var(--on-surface-variant))"
                  fontFamily="'Inter Variable', Inter, sans-serif"
                >
                  {formatNumber(d.value)}
                </text>
              ) : (
                <text
                  x={labelW + w + 10}
                  y={y + 3}
                  fontSize={9}
                  fontWeight={700}
                  fill="rgb(var(--on-surface-variant))"
                  fontFamily="'Inter Variable', Inter, sans-serif"
                >
                  {formatNumber(d.value)}
                </text>
              )}
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
