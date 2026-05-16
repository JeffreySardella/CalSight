import { useState, useRef, useEffect, useId } from "react";
import ChartTooltip from "./ChartTooltip";

interface TreemapItem {
  label: string;
  value: number;
  color?: string;
}

interface SimpleTreemapProps {
  data: TreemapItem[];
  height?: number;
  defaultColor?: string;
  renderTooltip?: (item: TreemapItem, idx: number) => React.ReactNode;
  title?: string;
}

function squarify(items: { label: string; value: number; color?: string }[], w: number, h: number) {
  const total = items.reduce((s, d) => s + d.value, 0);
  if (total === 0) return [];

  const rects: { x: number; y: number; w: number; h: number; item: typeof items[0]; idx: number }[] = [];
  let remaining = [...items].sort((a, b) => b.value - a.value);
  let x = 0, y = 0, rw = w, rh = h, remTotal = total;

  while (remaining.length > 0) {
    const isWide = rw >= rh;
    const side = isWide ? rh : rw;
    let row: typeof items = [];
    let rowTotal = 0;
    let bestRatio = Infinity;

    for (const item of remaining) {
      const testRow = [...row, item];
      const testTotal = rowTotal + item.value;
      const rowLen = (testTotal / remTotal) * (isWide ? rw : rh);
      const worst = Math.max(
        ...testRow.map((r) => {
          const s = (r.value / testTotal) * side;
          return Math.max(rowLen / s, s / rowLen);
        }),
      );
      if (worst <= bestRatio) {
        bestRatio = worst;
        row = testRow;
        rowTotal = testTotal;
      } else break;
    }

    const rowLen = remTotal > 0 ? (rowTotal / remTotal) * (isWide ? rw : rh) : 0;
    let offset = 0;
    for (const item of row) {
      const frac = rowTotal > 0 ? item.value / rowTotal : 0;
      const s = frac * side;
      if (isWide) {
        rects.push({ x: x + offset, y, w: s, h: rowLen, item, idx: items.indexOf(item) });
        offset += s;
      } else {
        rects.push({ x, y: y + offset, w: rowLen, h: s, item, idx: items.indexOf(item) });
        offset += s;
      }
    }

    if (isWide) { y += rowLen; rh -= rowLen; }
    else { x += rowLen; rw -= rowLen; }
    remTotal -= rowTotal;
    remaining = remaining.filter((r) => !row.includes(r));
  }

  return rects;
}

export default function SimpleTreemap({
  data,
  height = 220,
  defaultColor = "rgb(var(--primary-container))",
  renderTooltip,
  title,
}: SimpleTreemapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);
  const [svgWidth, setSvgWidth] = useState(300);
  const titleId = useId();

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    setSvgWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setSvgWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!data.length) return null;

  const total = data.reduce((s, d) => s + d.value, 0);
  const PAD = 2;
  const rects = squarify(data, svgWidth - PAD * 2, height - PAD * 2);

  const COLORS = [
    "#2563eb", "#7c3aed", "#0891b2", "#059669", "#d97706",
    "#dc2626", "#6366f1", "#0d9488", "#ca8a04", "#e11d48",
    "#4f46e5", "#0284c7",
  ];

  function textOnColor(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const lum = 0.2126 * (r / 255) + 0.7152 * (g / 255) + 0.0722 * (b / 255);
    return lum > 0.4 ? "#1a1a1a" : "#ffffff";
  }

  return (
    <div className="w-full overflow-visible relative" style={{ height }}>
      <svg ref={svgRef} width="100%" height={height} className="block" role="img" aria-labelledby={title ? titleId : undefined}>
        {title && <title id={titleId}>{title}</title>}
        {rects.map((r, i) => {
          const pct = total > 0 ? Math.round((r.item.value / total) * 100) : 0;
          const color = r.item.color ?? COLORS[i % COLORS.length] ?? defaultColor;
          const textColor = textOnColor(color);
          const showName = r.w > 44 && r.h > 20;
          const showPct = r.w > 30 && r.h > 36;
          return (
            <g key={r.item.label}>
              <rect
                x={PAD + r.x + 1}
                y={PAD + r.y + 1}
                width={Math.max(r.w - 2, 0)}
                height={Math.max(r.h - 2, 0)}
                rx={4}
                fill={color}
                fillOpacity={hover !== null && hover.idx !== r.idx ? 0.4 : 1}
                onMouseMove={(e) => {
                  const svg = svgRef.current;
                  if (!svg) return;
                  const rect = svg.getBoundingClientRect();
                  setHover({ idx: r.idx, x: e.clientX - rect.left, y: e.clientY - rect.top });
                }}
                onMouseLeave={() => setHover(null)}
                className="cursor-pointer transition-opacity"
              />
              {showName && (
                <text
                  x={PAD + r.x + 6}
                  y={PAD + r.y + 16}
                  fontSize={11}
                  fontWeight={700}
                  fill={textColor}
                  fontFamily="'Inter Variable', Inter, sans-serif"
                >
                  {r.item.label.length > Math.floor(r.w / 7) ? r.item.label.slice(0, Math.floor(r.w / 7) - 1) + "…" : r.item.label}
                </text>
              )}
              {showPct && (
                <text
                  x={PAD + r.x + 6}
                  y={PAD + r.y + 30}
                  fontSize={12}
                  fontWeight={800}
                  fill={textColor}
                  fillOpacity={0.9}
                  fontFamily="'Inter Variable', Inter, sans-serif"
                >
                  {pct}%
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
