import { useState, useRef, useCallback, useId } from "react";
import ChartTooltip from "./ChartTooltip";
import { nextChartIndex } from "./chartKeyboardNav";
import { useDesignTokens } from "../../hooks/useDesignTokens";
import { useTextScale } from "../../hooks/useTextScale";
import { CHART_PALETTES, paletteColor } from "../../lib/theme/palettes";
import { textOnColor } from "./onColorText";

interface PolarItem {
  label: string;
  value: number;
  color?: string;
}

interface SimplePolarAreaProps {
  data: PolarItem[];
  height?: number;
  renderTooltip?: (item: PolarItem, idx: number) => React.ReactNode;
  title?: string;
}

export default function SimplePolarArea({ data, height = 220, renderTooltip, title }: SimplePolarAreaProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);
  const [announce, setAnnounce] = useState("");
  const titleId = useId();
  const tokens = useDesignTokens();
  const palette = tokens.chart.categorical.length > 0 ? tokens.chart.categorical : CHART_PALETTES.default;
  const ts = useTextScale();

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGPathElement>, idx: number) => {
    setHover({ idx, x: e.clientX, y: e.clientY });
  }, []);

  // Keyboard access: the chart itself is focusable; arrow keys walk the
  // slices (tooltip follows) and each slice is announced through the polite
  // live region below the svg. Same convention as SimpleLineChart.
  const slicePosRef = useRef<{ x: number; y: number }[]>([]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<SVGSVGElement>) => {
    const next = nextChartIndex(e.key, hover?.idx, data.length);
    if (next === null) return;
    e.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    const p = slicePosRef.current[next];
    if (!rect || !p) return;
    setHover({ idx: next, x: rect.left + p.x, y: rect.top + p.y });
    const d = data[next];
    setAnnounce(`${d.label}: ${d.value.toLocaleString()}`);
  }, [data, hover]);

  // Touch scrub: map the touch point's angle around the center to a slice,
  // mirroring the angular scrub in SimpleRadar.
  const handleTouchScrub = useCallback((e: React.TouchEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || !data.length) return;
    const rect = svg.getBoundingClientRect();
    const touchX = e.touches[0].clientX - rect.left;
    const touchY = e.touches[0].clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    // Slices start at 12 o'clock (-PI/2) and sweep clockwise.
    const angle = Math.atan2(touchY - centerY, touchX - centerX) + Math.PI / 2;
    const normalizedAngle = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const step = (2 * Math.PI) / data.length;
    const idx = Math.min(data.length - 1, Math.floor(normalizedAngle / step));
    setHover({ idx, x: e.touches[0].clientX, y: e.touches[0].clientY });
  }, [data.length]);

  if (!data.length) return null;
  const rawMax = Math.max(...data.map((d) => d.value), 1);
  const maxVal = Number.isFinite(rawMax) ? rawMax : 1;
  const n = data.length;
  const cx = height / 2;
  const cy = height / 2;
  const maxR = cx - 12;
  const sliceAngle = (2 * Math.PI) / n;

  // Mid-slice anchor for the keyboard-focus tooltip.
  slicePosRef.current = data.map((d, i) => {
    const r = maxVal > 0 ? (d.value / maxVal) * maxR : 0;
    const midAngle = i * sliceAngle - Math.PI / 2 + sliceAngle / 2;
    const anchorR = Math.max(r * 0.7, maxR * 0.3);
    return { x: cx + anchorR * Math.cos(midAngle), y: cy + anchorR * Math.sin(midAngle) };
  });

  return (
    <div className="w-full overflow-visible relative flex justify-center" style={{ height }}>
      <svg ref={svgRef} width={height} height={height} className="block" role="img" aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Polar area chart. Use arrow keys to explore slices."}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onBlur={() => { setHover(null); setAnnounce(""); }}
        onTouchStart={handleTouchScrub} onTouchMove={handleTouchScrub} onTouchEnd={() => setHover(null)}>
        {title && <title id={titleId}>{title}</title>}
        {data.map((d, i) => {
          const r = maxVal > 0 ? (d.value / maxVal) * maxR : 0;
          const startAngle = i * sliceAngle - Math.PI / 2;
          const endAngle = startAngle + sliceAngle;
          const x1 = cx + r * Math.cos(startAngle);
          const y1 = cy + r * Math.sin(startAngle);
          const x2 = cx + r * Math.cos(endAngle);
          const y2 = cy + r * Math.sin(endAngle);
          const large = sliceAngle > Math.PI ? 1 : 0;
          const path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
          const color = d.color ?? paletteColor(palette, i);
          const isHovered = hover?.idx === i;
          return (
            <path
              key={d.label}
              d={path}
              fill={color}
              fillOpacity={hover !== null && !isHovered ? 0.4 : 0.85}
              stroke="rgb(var(--surface-container-lowest))"
              strokeWidth={1.5}
              onMouseMove={(e) => handleMouseMove(e, i)}
              onMouseLeave={() => setHover(null)}
              className="cursor-pointer transition-opacity"
            />
          );
        })}
        {data.length <= 10 && data.map((d, i) => {
          const r = maxVal > 0 ? (d.value / maxVal) * maxR : 0;
          const midAngle = i * sliceAngle - Math.PI / 2 + sliceAngle / 2;
          const labelR = Math.min(r * 0.6, maxR * 0.55);
          if (labelR < 18) return null;
          const lx = cx + labelR * Math.cos(midAngle);
          const ly = cy + labelR * Math.sin(midAngle);
          const sliceColor = d.color ?? paletteColor(palette, i);
          return (
            <text
              key={`label-${d.label}`}
              x={lx}
              y={ly}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={9 * ts}
              fontWeight={700}
              fill={textOnColor(sliceColor)}
              fontFamily="'Inter Variable', Inter, sans-serif"
              pointerEvents="none"
            >
              {d.label.length > 6 ? d.label.slice(0, 5) + "…" : d.label}
            </text>
          );
        })}
      </svg>
      <ChartTooltip x={hover?.x ?? 0} y={hover?.y ?? 0} visible={hover !== null} containerRef={svgRef}>
        {hover !== null && data[hover.idx] != null && renderTooltip?.(data[hover.idx], hover.idx)}
      </ChartTooltip>
      {/* Announces the keyboard-focused slice to screen readers */}
      <div className="sr-only" role="status">{announce}</div>
    </div>
  );
}
