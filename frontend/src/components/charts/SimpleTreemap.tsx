import { useState, useRef, useCallback } from "react";
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

    if (isWide) { x += 0; y += rowLen; rh -= rowLen; }
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
}: SimpleTreemapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);
  const [svgWidth, setSvgWidth] = useState(300);

  const containerRef = useCallback((el: SVGSVGElement | null) => {
    if (el) {
      svgRef.current = el;
      setSvgWidth(el.clientWidth);
      const ro = new ResizeObserver(([entry]) => setSvgWidth(entry.contentRect.width));
      ro.observe(el);
    }
  }, []);

  if (!data.length) return null;

  const total = data.reduce((s, d) => s + d.value, 0);
  const PAD = 2;
  const rects = squarify(data, svgWidth - PAD * 2, height - PAD * 2);

  const COLORS = [
    "rgb(var(--primary))", "rgb(var(--tertiary))", "rgb(var(--primary-container))",
    "rgb(var(--tertiary-container))", "rgb(var(--secondary))", "rgb(var(--secondary-container))",
    "rgb(var(--error))", "rgb(var(--outline-variant))",
  ];

  return (
    <div className="w-full overflow-visible relative" style={{ height }}>
      <svg ref={containerRef} width="100%" height={height} className="block">
        {rects.map((r, i) => {
          const pct = total > 0 ? Math.round((r.item.value / total) * 100) : 0;
          const color = r.item.color ?? COLORS[i % COLORS.length] ?? defaultColor;
          const showLabel = r.w > 40 && r.h > 28;
          return (
            <g key={r.item.label}>
              <rect
                x={PAD + r.x + 1}
                y={PAD + r.y + 1}
                width={Math.max(r.w - 2, 0)}
                height={Math.max(r.h - 2, 0)}
                rx={4}
                fill={color}
                fillOpacity={hover !== null && hover.idx !== r.idx ? 0.5 : 0.85}
                onMouseMove={(e) => {
                  const svg = svgRef.current;
                  if (!svg) return;
                  const rect = svg.getBoundingClientRect();
                  setHover({ idx: r.idx, x: e.clientX - rect.left, y: e.clientY - rect.top });
                }}
                onMouseLeave={() => setHover(null)}
                className="cursor-pointer transition-opacity"
              />
              {showLabel && (
                <>
                  <text
                    x={PAD + r.x + 6}
                    y={PAD + r.y + 16}
                    fontSize={11}
                    fontWeight={700}
                    fill="rgb(var(--on-primary))"
                    fontFamily="'Inter Variable', Inter, sans-serif"
                  >
                    {r.item.label.length > 12 ? r.item.label.slice(0, 11) + "…" : r.item.label}
                  </text>
                  <text
                    x={PAD + r.x + 6}
                    y={PAD + r.y + 30}
                    fontSize={10}
                    fill="rgb(var(--on-primary))"
                    fillOpacity={0.8}
                    fontFamily="'Inter Variable', Inter, sans-serif"
                  >
                    {pct}%
                  </text>
                </>
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
