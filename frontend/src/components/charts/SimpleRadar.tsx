import { useState, useRef, useCallback, useId } from "react";
import ChartTooltip from "./ChartTooltip";
import { nextChartIndex } from "./chartKeyboardNav";
import { useTextScale } from "../../hooks/useTextScale";

interface RadarItem {
  label: string;
  value: number;
}

interface SimpleRadarProps {
  data: RadarItem[];
  height?: number;
  color?: string;
  renderTooltip?: (item: RadarItem, idx: number) => React.ReactNode;
  title?: string;
}

export default function SimpleRadar({
  data,
  height = 220,
  color = "rgb(var(--primary))",
  renderTooltip,
  title,
}: SimpleRadarProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);
  const [announce, setAnnounce] = useState("");
  const titleId = useId();
  const ts = useTextScale();

  const handleMouseMove = useCallback((e: React.MouseEvent, idx: number) => {
    setHover({ idx, x: e.clientX, y: e.clientY });
  }, []);

  // Keyboard access: the chart itself is focusable; arrow keys walk the
  // vertices (tooltip follows) and each is announced through the polite live
  // region below the svg. Same convention as SimpleLineChart.
  const pointsRef = useRef<{ x: number; y: number }[]>([]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<SVGSVGElement>) => {
    const next = nextChartIndex(e.key, hover?.idx, data.length);
    if (next === null) return;
    e.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    const p = pointsRef.current[next];
    if (!rect || !p) return;
    setHover({ idx: next, x: rect.left + p.x, y: rect.top + p.y });
    const d = data[next];
    setAnnounce(`${d.label}: ${d.value.toLocaleString()}`);
  }, [data, hover]);

  const handleTouchScrub = useCallback((e: React.TouchEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || !data.length) return;
    const rect = svg.getBoundingClientRect();
    const touchX = e.touches[0].clientX - rect.left;
    const touchY = e.touches[0].clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const angle = Math.atan2(touchY - centerY, touchX - centerX) + Math.PI / 2;
    const normalizedAngle = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const step = (2 * Math.PI) / data.length;
    const idx = Math.round(normalizedAngle / step) % data.length;
    setHover({ idx, x: e.touches[0].clientX, y: e.touches[0].clientY });
  }, [data.length]);

  if (data.length < 3) {
    return (
      <div className="h-48 flex items-center justify-center text-on-surface-variant text-sm">
        Radar needs 3+ categories
      </div>
    );
  }

  const n = data.length;
  const cx = height / 2;
  const cy = height / 2;
  const maxR = cx - 30;
  const rawMax = Math.max(...data.map((d) => d.value), 1);
  const maxVal = Number.isFinite(rawMax) ? rawMax : 1;
  const angleStep = (2 * Math.PI) / n;
  const rings = 4;

  const points = data.map((d, i) => {
    const angle = i * angleStep - Math.PI / 2;
    const r = (d.value / maxVal) * maxR;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });

  const polyPoints = points.map((p) => `${p.x},${p.y}`).join(" ");
  pointsRef.current = points;

  return (
    <div className="w-full overflow-visible relative flex justify-center" style={{ height }}>
      <svg ref={svgRef} width={height} height={height} className="block" role="img" aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Radar chart. Use arrow keys to explore categories."}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onBlur={() => { setHover(null); setAnnounce(""); }}
        onTouchMove={handleTouchScrub} onTouchEnd={() => setHover(null)}>
        {title && <title id={titleId}>{title}</title>}
        {Array.from({ length: rings }).map((_, ring) => {
          const r = ((ring + 1) / rings) * maxR;
          const ringPoints = Array.from({ length: n }).map((_, i) => {
            const angle = i * angleStep - Math.PI / 2;
            return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
          });
          return (
            <polygon
              key={ring}
              points={ringPoints.join(" ")}
              fill="none"
              stroke="rgb(var(--outline-variant))"
              strokeOpacity={0.25}
              strokeWidth={1}
            />
          );
        })}
        {data.map((_, i) => {
          const angle = i * angleStep - Math.PI / 2;
          const x2 = cx + maxR * Math.cos(angle);
          const y2 = cy + maxR * Math.sin(angle);
          return <line key={i} x1={cx} y1={cy} x2={x2} y2={y2} stroke="rgb(var(--outline-variant))" strokeOpacity={0.2} />;
        })}
        <polygon points={polyPoints} fill={color} fillOpacity={0.15} stroke={color} strokeWidth={2} />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={16} fill="transparent"
              onMouseMove={(e) => handleMouseMove(e, i)}
              onMouseLeave={() => setHover(null)}
              className="cursor-pointer" />
            <circle cx={p.x} cy={p.y} r={hover?.idx === i ? 6 : 3.5} fill={color}
              stroke="rgb(var(--surface))" strokeWidth={1}
              style={{ pointerEvents: "none" }} />
          </g>
        ))}
        {data.map((d, i) => {
          const angle = i * angleStep - Math.PI / 2;
          const labelR = maxR + 16;
          const lx = cx + labelR * Math.cos(angle);
          const ly = cy + labelR * Math.sin(angle);
          return (
            <text
              key={`label-${i}`}
              x={lx}
              y={ly}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={9 * ts}
              fontWeight={600}
              fill="rgb(var(--on-surface-variant))"
              fontFamily="'Inter Variable', Inter, sans-serif"
            >
              {d.label.length > 8 ? d.label.slice(0, 7) + "…" : d.label}
            </text>
          );
        })}
      </svg>
      <ChartTooltip x={hover?.x ?? 0} y={hover?.y ?? 0} visible={hover !== null} containerRef={svgRef}>
        {hover !== null && data[hover.idx] != null && renderTooltip?.(data[hover.idx], hover.idx)}
      </ChartTooltip>
      {/* Announces the keyboard-focused category to screen readers */}
      <div className="sr-only" role="status">{announce}</div>
    </div>
  );
}
