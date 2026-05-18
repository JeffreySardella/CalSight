import { useState, useRef, useEffect, useCallback, useId } from "react";
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
  defaultColor = "rgb(var(--primary))",
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

  const rectsRef = useRef<{ x: number; y: number; w: number; h: number; idx: number }[]>([]);

  const handleTouchScrub = useCallback((e: React.TouchEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || !rectsRef.current.length) return;
    const rect = svg.getBoundingClientRect();
    const tx = e.touches[0].clientX - rect.left;
    const ty = e.touches[0].clientY - rect.top;
    let closest = 0, minDist = Infinity;
    for (const r of rectsRef.current) {
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      const d = (tx - cx) ** 2 + (ty - cy) ** 2;
      if (d < minDist) { minDist = d; closest = r.idx; }
    }
    setHover({ idx: closest, x: e.touches[0].clientX, y: e.touches[0].clientY });
  }, []);

  if (!data.length) return null;

  // Scale height based on item count so small items at the bottom aren't cut off
  const effectiveHeight = Math.max(height, data.length > 8 ? 300 : data.length > 5 ? 260 : height);
  const total = data.reduce((s, d) => s + d.value, 0);
  const PAD = 2;
  const rects = squarify(data, svgWidth - PAD * 2, effectiveHeight - PAD * 2);
  rectsRef.current = rects.map(r => ({ x: PAD + r.x, y: PAD + r.y, w: r.w, h: r.h, idx: r.idx }));

  function textOnColor(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const lum = 0.2126 * (r / 255) + 0.7152 * (g / 255) + 0.0722 * (b / 255);
    return lum > 0.4 ? "#1a1a1a" : "#ffffff";
  }

  return (
    <div className="w-full overflow-visible relative" style={{ height: effectiveHeight }}>
      <svg ref={svgRef} width="100%" height={effectiveHeight} className="block touch-none" role="img" aria-labelledby={title ? titleId : undefined}
        onTouchMove={handleTouchScrub} onTouchEnd={() => setHover(null)}>
        {title && <title id={titleId}>{title}</title>}
        {rects.map((r) => {
          const pct = total > 0 ? Math.round((r.item.value / total) * 100) : 0;
          const color = r.item.color ?? defaultColor;
          const textColor = textOnColor(color);
          const cellW = Math.max(r.w - 2, 0);
          const cellH = Math.max(r.h - 2, 0);
          const fontSize = cellW < 50 || cellH < 24 ? 8 : cellW < 80 ? 9 : 11;
          const maxChars = Math.max(2, Math.floor(cellW / (fontSize * 0.65)));
          const showName = cellW > 20 && cellH > 14;
          const showPct = cellW > 24 && cellH > (fontSize + 16);
          return (
            <g key={r.item.label}>
              <rect
                x={PAD + r.x + 1}
                y={PAD + r.y + 1}
                width={cellW}
                height={cellH}
                rx={3}
                fill={color}
                fillOpacity={hover !== null && hover.idx !== r.idx ? 0.4 : 1}
                onMouseMove={(e) => {
                  setHover({ idx: r.idx, x: e.clientX, y: e.clientY });
                }}
                onMouseLeave={() => setHover(null)}
                className="cursor-pointer transition-opacity"
              />
              {showName && (
                <text
                  x={PAD + r.x + 4}
                  y={PAD + r.y + fontSize + 3}
                  fontSize={fontSize}
                  fontWeight={700}
                  fill={textColor}
                  fontFamily="'Inter Variable', Inter, sans-serif"
                  style={{ pointerEvents: "none" }}
                >
                  {r.item.label.length > maxChars ? r.item.label.slice(0, maxChars - 1) + "…" : r.item.label}
                </text>
              )}
              {showPct && (
                <text
                  x={PAD + r.x + 4}
                  y={PAD + r.y + fontSize * 2 + 5}
                  fontSize={fontSize + 1}
                  fontWeight={800}
                  fill={textColor}
                  fillOpacity={0.9}
                  fontFamily="'Inter Variable', Inter, sans-serif"
                  style={{ pointerEvents: "none" }}
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
