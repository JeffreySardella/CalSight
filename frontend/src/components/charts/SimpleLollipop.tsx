import { useState, useRef, useCallback, useEffect, useId } from "react";
import ChartTooltip from "./ChartTooltip";
import { nextChartIndex } from "./chartKeyboardNav";
import { useTextScale } from "../../hooks/useTextScale";

interface LollipopItem {
  label: string;
  value: number;
  color?: string;
}

export type LollipopHighlight = "selected" | "dimmed" | "normal";

interface SimpleLollipopProps {
  data: LollipopItem[];
  height?: number;
  defaultColor?: string;
  renderTooltip?: (item: LollipopItem, idx: number) => React.ReactNode;
  title?: string;
  onItemClick?: (item: LollipopItem, idx: number) => void;
  getHighlight?: (item: LollipopItem, idx: number) => LollipopHighlight;
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
  onItemClick,
  getHighlight,
}: SimpleLollipopProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);
  const [announce, setAnnounce] = useState("");
  const [svgWidth, setSvgWidth] = useState(300);
  const titleId = useId();
  const ts = useTextScale();

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSvgWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent, idx: number) => {
    setHover({ idx, x: e.clientX, y: e.clientY });
  }, []);

  // Keyboard access: the chart itself is focusable; arrow keys walk the rows
  // (tooltip follows), each announced through the polite live region below
  // the svg; Enter/Space activates the same handler as click. Same convention
  // as SimpleLineChart / SimpleBarChart.
  const dotPosRef = useRef<{ x: number; y: number }[]>([]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<SVGSVGElement>) => {
    if ((e.key === "Enter" || e.key === " ") && hover !== null && data[hover.idx] && onItemClick) {
      e.preventDefault();
      onItemClick(data[hover.idx], hover.idx);
      return;
    }
    const next = nextChartIndex(e.key, hover?.idx, data.length);
    if (next === null) return;
    e.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    const p = dotPosRef.current[next];
    if (!rect || !p) return;
    setHover({ idx: next, x: rect.left + p.x, y: rect.top + p.y });
    const d = data[next];
    setAnnounce(`${d.label}: ${d.value.toLocaleString()}`);
  }, [data, hover, onItemClick]);

  const handleTouchScrub = useCallback((e: React.TouchEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || !data.length) return;
    const rect = svg.getBoundingClientRect();
    const touchY = e.touches[0].clientY - rect.top;
    const rH = Math.min(28, (rect.height - 8) / data.length);
    const idx = Math.max(0, Math.min(data.length - 1, Math.floor((touchY - 4) / rH)));
    setHover({ idx, x: e.touches[0].clientX, y: e.touches[0].clientY });
  }, [data.length]);

  if (!data.length) return null;
  const rawMax = Math.max(...data.map((d) => d.value), 1);
  const maxVal = Number.isFinite(rawMax) ? rawMax : 1;
  const labelW = 84;
  const valueW = 48;
  const barArea = Math.max(svgWidth - labelW - valueW, 0);
  const rowH = Math.min(28, (height - 8) / data.length);
  const svgH = Math.max(height, data.length * rowH + 8);

  dotPosRef.current = data.map((d, i) => ({
    x: labelW + (maxVal > 0 ? (d.value / maxVal) * barArea : 0),
    y: i * rowH + rowH / 2 + 4,
  }));

  return (
    <div className="w-full overflow-visible relative" style={{ height: svgH }}>
      <svg ref={svgRef} width="100%" height={svgH} className="block overflow-visible" role="img" aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Lollipop chart. Use arrow keys to explore rows."}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onBlur={() => { setHover(null); setAnnounce(""); }}
        onTouchMove={handleTouchScrub} onTouchEnd={() => setHover(null)}>
        {title && <title id={titleId}>{title}</title>}
        {data.map((d, i) => {
          const y = i * rowH + rowH / 2 + 4;
          const w = maxVal > 0 ? (d.value / maxVal) * barArea : 0;
          const color = d.color ?? defaultColor;
          const isHovered = hover?.idx === i;
          const hl = getHighlight?.(d, i) ?? "normal";
          const hlOpacity = hl === "dimmed" ? 0.3 : 1;
          return (
            <g
              key={d.label}
              onMouseMove={(e) => handleMouseMove(e, i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onItemClick?.(d, i)}
              className="cursor-pointer"
              opacity={hlOpacity}
              style={{ transition: "opacity 0.15s ease" }}
            >
              <text
                x={labelW - 6}
                y={y + 3}
                textAnchor="end"
                fontSize={10 * ts}
                fontWeight={600}
                fill="rgb(var(--on-surface-variant))"
                fontFamily="'Inter Variable', Inter, sans-serif"
              >
                {d.label.length > 14 ? d.label.slice(0, 13) + "…" : d.label}
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
              {labelW + w + 10 > svgWidth - valueW ? (
                <text
                  x={labelW + w - 10}
                  y={y + 3}
                  textAnchor="end"
                  fontSize={9 * ts}
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
                  fontSize={9 * ts}
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
        {hover !== null && data[hover.idx] != null && renderTooltip?.(data[hover.idx], hover.idx)}
      </ChartTooltip>
      {/* Announces the keyboard-focused row to screen readers */}
      <div className="sr-only" role="status">{announce}</div>
    </div>
  );
}
