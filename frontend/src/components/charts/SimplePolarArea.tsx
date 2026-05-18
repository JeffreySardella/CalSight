import { useState, useRef, useCallback, useId } from "react";
import ChartTooltip from "./ChartTooltip";
import { useDesignTokens } from "../../hooks/useDesignTokens";

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

const FALLBACK_COLORS = [
  "#2563eb", "#dc2626", "#059669", "#7c3aed", "#d97706",
  "#0891b2", "#e11d48", "#4f46e5", "#0d9488", "#ca8a04",
  "#6366f1", "#0284c7",
];

export default function SimplePolarArea({ data, height = 220, renderTooltip, title }: SimplePolarAreaProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);
  const titleId = useId();
  const tokens = useDesignTokens();
  const paletteColors = tokens.chart.categorical.length > 0 ? tokens.chart.categorical : FALLBACK_COLORS;

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGPathElement>, idx: number) => {
    setHover({ idx, x: e.clientX, y: e.clientY });
  }, []);

  if (!data.length) return null;
  const maxVal = Math.max(...data.map((d) => d.value), 1);
  const n = data.length;
  const cx = height / 2;
  const cy = height / 2;
  const maxR = cx - 12;
  const sliceAngle = (2 * Math.PI) / n;

  return (
    <div className="w-full overflow-visible relative flex justify-center" style={{ height }}>
      <svg ref={svgRef} width={height} height={height} className="block" role="img" aria-labelledby={title ? titleId : undefined}>
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
          const color = d.color ?? paletteColors[i % paletteColors.length];
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
        {data.map((d, i) => {
          const r = maxVal > 0 ? (d.value / maxVal) * maxR : 0;
          const midAngle = i * sliceAngle - Math.PI / 2 + sliceAngle / 2;
          const labelR = Math.min(r * 0.6, maxR * 0.55);
          if (labelR < 18) return null;
          const lx = cx + labelR * Math.cos(midAngle);
          const ly = cy + labelR * Math.sin(midAngle);
          return (
            <text
              key={`label-${d.label}`}
              x={lx}
              y={ly}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={9}
              fontWeight={700}
              fill="#fff"
              fontFamily="'Inter Variable', Inter, sans-serif"
              pointerEvents="none"
            >
              {d.label.length > 6 ? d.label.slice(0, 5) + "…" : d.label}
            </text>
          );
        })}
      </svg>
      <ChartTooltip x={hover?.x ?? 0} y={hover?.y ?? 0} visible={hover !== null} containerRef={svgRef}>
        {hover !== null && renderTooltip?.(data[hover.idx], hover.idx)}
      </ChartTooltip>
    </div>
  );
}
