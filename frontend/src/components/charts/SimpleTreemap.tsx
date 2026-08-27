import { useState, useRef, useEffect, useCallback, useId } from "react";
import ChartTooltip from "./ChartTooltip";
import { nextChartIndex } from "./chartKeyboardNav";
import { useTextScale } from "../../hooks/useTextScale";
import { textOnColor } from "./onColorText";

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
  height = 280,
  defaultColor = "rgb(var(--primary))",
  renderTooltip,
  title,
}: SimpleTreemapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);
  const [announce, setAnnounce] = useState("");
  const [svgWidth, setSvgWidth] = useState(300);
  const titleId = useId();
  const ts = useTextScale();

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    setSvgWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setSvgWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rectsRef = useRef<{ x: number; y: number; w: number; h: number; idx: number }[]>([]);

  // Keyboard access: the chart itself is focusable; arrow keys walk the tiles
  // in data order (tooltip follows) and each tile is announced through the
  // polite live region below the svg. Same convention as SimpleLineChart.
  const handleKeyDown = useCallback((e: React.KeyboardEvent<SVGSVGElement>) => {
    const next = nextChartIndex(e.key, hover?.idx, data.length);
    if (next === null) return;
    e.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    const cell = rectsRef.current.find((r) => r.idx === next);
    if (!rect || !cell) return;
    setHover({ idx: next, x: rect.left + cell.x + cell.w / 2, y: rect.top + cell.y + cell.h / 2 });
    const d = data[next];
    const total = data.reduce((s, dd) => s + dd.value, 0);
    const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
    setAnnounce(`${d.label}: ${d.value.toLocaleString()} (${pct}%)`);
  }, [data, hover]);

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

  const total = data.reduce((s, d) => s + d.value, 0);
  const PAD = 2;

  const useStacked = data.length > 10;
  const MIN_ROW = 24;
  const sorted = [...data].sort((a, b) => b.value - a.value);

  let rects: { x: number; y: number; w: number; h: number; item: TreemapItem; idx: number }[];
  let effectiveH = height;
  if (useStacked) {
    const w = svgWidth - PAD * 2;
    // First pass: compute actual row heights with minimum enforced
    const rows = sorted.map((item) => {
      const natural = total > 0 ? (item.value / total) * height : MIN_ROW;
      return Math.max(MIN_ROW, natural);
    });
    effectiveH = Math.max(height, rows.reduce((s, h) => s + h, 0));
    // Second pass: build rects with the correct total height
    let y = 0;
    rects = sorted.map((item, i) => {
      const h = rows[i];
      const r = { x: 0, y, w, h, item, idx: data.indexOf(item) };
      y += h;
      return r;
    });
  } else {
    rects = squarify(data, svgWidth - PAD * 2, effectiveH - PAD * 2);
  }
  rectsRef.current = rects.map(r => ({ x: PAD + r.x, y: PAD + r.y, w: r.w, h: r.h, idx: r.idx }));

  return (
    <div className="w-full overflow-visible relative" style={{ height: effectiveH }}>
      <svg ref={svgRef} width="100%" height={effectiveH} className="block" role="img" aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Treemap. Use arrow keys to explore tiles."}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onBlur={() => { setHover(null); setAnnounce(""); }}
        onTouchMove={handleTouchScrub} onTouchEnd={() => setHover(null)}>
        {title && <title id={titleId}>{title}</title>}
        {rects.map((r) => {
          const pct = total > 0 ? Math.round((r.item.value / total) * 100) : 0;
          const color = r.item.color ?? defaultColor;
          const cellW = Math.max(r.w - 2, 0);
          const cellH = Math.max(r.h - 2, 0);
          const fitsLabel = cellW > 28 && cellH > 16;
          const fitsPct = cellW > 28 && cellH > 30;
          const fs = Math.min(11, Math.max(7, Math.floor(Math.min(cellW, cellH) / 4))) * ts;
          const maxChars = Math.max(2, Math.floor(cellW / (fs * 0.6)));
          const tc = textOnColor(color);
          return (
            <g key={`${r.item.label}-${r.idx}`}>
              <rect
                x={PAD + r.x + 1} y={PAD + r.y + 1}
                width={cellW} height={cellH} rx={3}
                fill={color}
                fillOpacity={hover !== null && hover.idx !== r.idx ? 0.4 : 1}
                onMouseMove={(e) => setHover({ idx: r.idx, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setHover(null)}
                className="cursor-pointer transition-opacity"
              />
              {fitsLabel && (
                <text x={PAD + r.x + 4} y={PAD + r.y + fs + 2} fontSize={fs} fontWeight={700} fill={tc}
                  fontFamily="'Inter Variable', Inter, sans-serif" style={{ pointerEvents: "none" }}>
                  {r.item.label.length > maxChars ? r.item.label.slice(0, maxChars - 1) + "…" : r.item.label}
                </text>
              )}
              {fitsPct && (
                <text x={PAD + r.x + 4} y={PAD + r.y + fs * 2 + 3} fontSize={fs} fontWeight={800} fill={tc}
                  fillOpacity={0.85} fontFamily="'Inter Variable', Inter, sans-serif" style={{ pointerEvents: "none" }}>
                  {pct}%
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <ChartTooltip x={hover?.x ?? 0} y={hover?.y ?? 0} visible={hover !== null} containerRef={svgRef}>
        {hover !== null && data[hover.idx] && renderTooltip?.(data[hover.idx], hover.idx)}
      </ChartTooltip>
      {/* Announces the keyboard-focused tile to screen readers */}
      <div className="sr-only" role="status">{announce}</div>
    </div>
  );
}
