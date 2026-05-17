import { useState, useRef, useCallback, useId } from "react";
import ChartTooltip from "./ChartTooltip";

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
  const titleId = useId();

  const handleMouseMove = useCallback((e: React.MouseEvent, idx: number) => {
    setHover({ idx, x: e.clientX, y: e.clientY });
  }, []);

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
  const maxVal = Math.max(...data.map((d) => d.value), 1);
  const angleStep = (2 * Math.PI) / n;
  const rings = 4;

  const points = data.map((d, i) => {
    const angle = i * angleStep - Math.PI / 2;
    const r = (d.value / maxVal) * maxR;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });

  const polyPoints = points.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <div className="w-full overflow-visible relative flex justify-center" style={{ height }}>
      <svg ref={svgRef} width={height} height={height} className="block" role="img" aria-labelledby={title ? titleId : undefined}>
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
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={hover?.idx === i ? 5 : 3}
            fill={color}
            onMouseMove={(e) => handleMouseMove(e, i)}
            onMouseLeave={() => setHover(null)}
            className="cursor-pointer"
          />
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
              fontSize={9}
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
        {hover !== null && renderTooltip?.(data[hover.idx], hover.idx)}
      </ChartTooltip>
    </div>
  );
}
