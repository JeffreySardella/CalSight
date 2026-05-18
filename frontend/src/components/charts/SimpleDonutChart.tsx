import { useState, useRef, useCallback, useId } from "react";
import ChartTooltip from "./ChartTooltip";
import { useChartAnimation } from "../../hooks/useChartAnimation";

interface Segment {
  label: string;
  value: number;
  color: string;
}

export type DonutHighlight = "selected" | "dimmed" | "normal";

interface SimpleDonutChartProps {
  data: Segment[];
  height?: number;
  innerRadius?: number;
  outerRadius?: number;
  renderTooltip?: (item: Segment & { pct: number }, idx: number) => React.ReactNode;
  title?: string;
  onSegmentClick?: (item: Segment, idx: number) => void;
  getHighlight?: (item: Segment, idx: number) => DonutHighlight;
}

function polarToCartesian(cx: number, cy: number, r: number, angle: number) {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const large = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 0 ${end.x} ${end.y}`;
}

export default function SimpleDonutChart({
  data,
  height = 160,
  innerRadius = 48,
  outerRadius = 72,
  renderTooltip,
  title,
  onSegmentClick,
  getHighlight,
}: SimpleDonutChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);
  const titleId = useId();
  const { progress } = useChartAnimation(svgRef);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGPathElement>, idx: number) => {
    setHover({ idx, x: e.clientX, y: e.clientY });
  }, []);

  if (!data.length) return null;

  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;

  const effectiveOuter = Math.min(outerRadius, (height - 4) / 2);
  const effectiveInner = Math.min(innerRadius, effectiveOuter * 0.67);
  const vw = effectiveOuter * 2 + 8;
  const cx = vw / 2;
  const cy = height / 2;
  const padAngle = 2;

  const segments: { path: string; outerPath: string; color: string; pct: number; item: Segment; midAngle: number }[] = [];
  let cumAngle = 0;

  for (const d of data) {
    const sweep = (d.value / total) * (360 - padAngle * data.length);
    const start = cumAngle;
    const end = cumAngle + sweep;
    const mid = (start + end) / 2;

    const innerStart = polarToCartesian(cx, cy, effectiveInner, end);
    const innerEnd = polarToCartesian(cx, cy, effectiveInner, start);
    const outerStart = polarToCartesian(cx, cy, effectiveOuter, end);
    const outerEnd = polarToCartesian(cx, cy, effectiveOuter, start);
    const large = sweep > 180 ? 1 : 0;

    const path = [
      `M ${outerStart.x} ${outerStart.y}`,
      `A ${effectiveOuter} ${effectiveOuter} 0 ${large} 0 ${outerEnd.x} ${outerEnd.y}`,
      `L ${innerEnd.x} ${innerEnd.y}`,
      `A ${effectiveInner} ${effectiveInner} 0 ${large} 1 ${innerStart.x} ${innerStart.y}`,
      "Z",
    ].join(" ");

    const outerPath = arcPath(cx, cy, effectiveOuter, start, end);

    segments.push({
      path,
      outerPath,
      color: d.color,
      pct: Math.round((d.value / total) * 100),
      item: d,
      midAngle: mid,
    });

    cumAngle = end + padAngle;
  }

  const withPct = data.map((d) => ({ ...d, pct: Math.round((d.value / total) * 100) }));

  return (
    <div className="w-full overflow-visible relative flex justify-center" style={{ height }}>
      <svg ref={svgRef} width={vw} height={height} className="block overflow-visible" role="img" aria-labelledby={title ? titleId : undefined}>
        {title && <title id={titleId}>{title}</title>}
        {segments.map((seg, i) => {
          const isHovered = hover?.idx === i;
          const pushDist = isHovered ? 4 : 0;
          const pushRad = ((seg.midAngle - 90) * Math.PI) / 180;
          const tx = pushDist * Math.cos(pushRad);
          const ty = pushDist * Math.sin(pushRad);
          return (
            <path
              key={seg.item.label}
              d={seg.path}
              fill={seg.color}
              onMouseMove={(e) => handleMouseMove(e, i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSegmentClick?.(seg.item, i)}
              className="cursor-pointer"
              style={{
                transform: `translate(${tx}px, ${ty}px) scale(${progress})`,
                transformOrigin: `${cx}px ${cy}px`,
                opacity: (() => {
                  const hl = getHighlight?.(seg.item, i) ?? "normal";
                  if (hl === "dimmed") return progress * 0.3;
                  if (hl === "selected") return progress;
                  return progress * (hover !== null && !isHovered ? 0.5 : 1);
                })(),
                transition: "transform 0.2s ease, opacity 0.15s ease",
              }}
            />
          );
        })}
      </svg>
      <ChartTooltip x={hover?.x ?? 0} y={hover?.y ?? 0} visible={hover !== null} containerRef={svgRef}>
        {hover !== null && withPct[hover.idx] != null && renderTooltip?.(withPct[hover.idx], hover.idx)}
      </ChartTooltip>
    </div>
  );
}
