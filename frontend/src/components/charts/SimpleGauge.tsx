import { useId, useState, useRef, useCallback } from "react";
import ChartTooltip from "./ChartTooltip";
import { useDesignTokens } from "../../hooks/useDesignTokens";
import { useTextScale } from "../../hooks/useTextScale";
import { CHART_PALETTES } from "../../lib/theme/palettes";

interface GaugeItem {
  label: string;
  value: number;
  color?: string;
}

interface SimpleGaugeProps {
  data: GaugeItem[];
  height?: number;
  title?: string;
}

function formatNumber(val: number): string {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return val.toLocaleString();
}


export default function SimpleGauge({ data, height = 180, title }: SimpleGaugeProps) {
  const titleId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);
  const tokens = useDesignTokens();
  // Shared fallback: the canonical default chart palette (same as SimplePolarArea)
  const paletteColors = tokens.chart.categorical.length > 0 ? tokens.chart.categorical : CHART_PALETTES.default;
  const ts = useTextScale();

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGPathElement>, idx: number) => {
    setHover({ idx, x: e.clientX, y: e.clientY });
  }, []);

  // Touch scrub: map the touch point's angle around the gauge center to a
  // segment (angular scrub like SimpleRadar/SimplePolarArea). The svg is
  // scaled via viewBox, so client coords are converted to viewBox coords
  // first (preserveAspectRatio default: xMidYMid meet).
  const handleTouchScrub = useCallback((e: React.TouchEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    const total = data.reduce((s, d) => s + d.value, 0);
    if (!svg || !data.length || total === 0) return;
    const rect = svg.getBoundingClientRect();
    const vw = 240;
    const vh = height - 20;
    const scale = Math.min(rect.width / vw, rect.height / vh) || 1;
    const offsetX = (rect.width - vw * scale) / 2;
    const offsetY = (rect.height - vh * scale) / 2;
    const vx = (e.touches[0].clientX - rect.left - offsetX) / scale;
    const vy = (e.touches[0].clientY - rect.top - offsetY) / scale;
    const cx = vw / 2;
    const cy = height - 40;
    // Segments sweep from PI (left) to 2*PI (right) across the top half.
    const raw = Math.atan2(vy - cy, vx - cx);
    const angle = raw <= 0 ? raw + 2 * Math.PI : raw;
    const frac = Math.max(0, Math.min(1, (angle - Math.PI) / Math.PI));
    let cum = 0;
    let idx = data.length - 1;
    for (let i = 0; i < data.length; i++) {
      cum += data[i].value / total;
      if (frac <= cum) { idx = i; break; }
    }
    setHover({ idx, x: e.touches[0].clientX, y: e.touches[0].clientY });
  }, [data, height]);

  if (!data.length) return null;

  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;

  const vw = 240;
  const cx = vw / 2;
  const cy = height - 40;
  const outerR = Math.min(cx - 8, cy - 8);
  const trackW = 24;
  const innerR = outerR - trackW;

  let cumAngle = Math.PI;
  const arcs = data.map((d, i) => {
    const pct = d.value / total;
    const startAngle = cumAngle;
    const sweepAngle = pct * Math.PI;
    cumAngle += sweepAngle;
    const endAngle = cumAngle;

    const x1 = cx + outerR * Math.cos(startAngle);
    const y1 = cy + outerR * Math.sin(startAngle);
    const x2 = cx + outerR * Math.cos(endAngle);
    const y2 = cy + outerR * Math.sin(endAngle);
    const ix1 = cx + innerR * Math.cos(endAngle);
    const iy1 = cy + innerR * Math.sin(endAngle);
    const ix2 = cx + innerR * Math.cos(startAngle);
    const iy2 = cy + innerR * Math.sin(startAngle);

    const large = pct > 0.5 ? 1 : 0;
    const path = [
      `M ${x1} ${y1}`,
      `A ${outerR} ${outerR} 0 ${large} 1 ${x2} ${y2}`,
      `L ${ix1} ${iy1}`,
      `A ${innerR} ${innerR} 0 ${large} 0 ${ix2} ${iy2}`,
      "Z",
    ].join(" ");

    return {
      path,
      color: d.color ?? paletteColors[i % paletteColors.length],
      label: d.label,
      value: d.value,
      pct: Math.round(pct * 100),
    };
  });

  return (
    <div className="w-full flex flex-col items-center relative" style={{ minHeight: height }}>
      <svg ref={svgRef} width="100%" height={height - 20} viewBox={`0 0 ${vw} ${height - 20}`} className="block" role="img" aria-labelledby={title ? titleId : undefined}
        onTouchStart={handleTouchScrub} onTouchMove={handleTouchScrub} onTouchEnd={() => setHover(null)}>
        {title && <title id={titleId}>{title}</title>}
        <path
          d={`M ${cx - outerR} ${cy} A ${outerR} ${outerR} 0 0 1 ${cx + outerR} ${cy}`}
          fill="none"
          stroke="rgb(var(--surface-container-high))"
          strokeWidth={trackW}
        />
        {arcs.map((arc, i) => (
          <path
            key={i}
            d={arc.path}
            fill={arc.color}
            fillOpacity={hover !== null && hover.idx !== i ? 0.45 : 1}
            onMouseMove={(e) => handleMouseMove(e, i)}
            onMouseLeave={() => setHover(null)}
            className="cursor-pointer transition-opacity"
          />
        ))}
        <text x={cx} y={cy - 12} textAnchor="middle" fontSize={26 * ts} fontWeight={800} fill="rgb(var(--on-surface))" fontFamily="'Inter Variable', Inter, sans-serif">
          {formatNumber(total)}
        </text>
        <text x={cx} y={cy + 6} textAnchor="middle" fontSize={10 * ts} fontWeight={600} fill="rgb(var(--on-surface-variant))" fontFamily="'Inter Variable', Inter, sans-serif" letterSpacing={2}>
          TOTAL
        </text>
      </svg>
      <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center">
        {arcs.map((arc, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[10px]">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: arc.color }} />
            <span className="text-on-surface-variant font-medium">{arc.label} {arc.pct}%</span>
          </div>
        ))}
      </div>
      <ChartTooltip x={hover?.x ?? 0} y={hover?.y ?? 0} visible={hover !== null}>
        {hover !== null && arcs[hover.idx] != null && (
          <>
            <p className="font-bold text-on-surface">{arcs[hover.idx].label}</p>
            <p className="text-on-surface-variant">
              {arcs[hover.idx].value.toLocaleString()} ({arcs[hover.idx].pct}%)
            </p>
          </>
        )}
      </ChartTooltip>
    </div>
  );
}
