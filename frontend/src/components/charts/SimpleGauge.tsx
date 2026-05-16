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

const DEFAULT_COLORS = ["#dc2626", "#f59e0b", "#2563eb", "#7c3aed", "#059669", "#6b7280"];

export default function SimpleGauge({ data, height = 180, title }: SimpleGaugeProps) {
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
      color: d.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length],
      label: d.label,
      pct: Math.round(pct * 100),
    };
  });

  return (
    <div className="w-full" style={{ minHeight: height }}>
      <svg width="100%" height={height - 20} viewBox={`0 0 ${vw} ${height - 20}`} className="block" role="img" aria-labelledby={title ? "gauge-chart-title" : undefined}>
        {title && <title id="gauge-chart-title">{title}</title>}
        <path
          d={`M ${cx - outerR} ${cy} A ${outerR} ${outerR} 0 0 1 ${cx + outerR} ${cy}`}
          fill="none"
          stroke="rgb(var(--surface-container-high))"
          strokeWidth={trackW}
        />
        {arcs.map((arc, i) => (
          <path key={i} d={arc.path} fill={arc.color} />
        ))}
        <text x={cx} y={cy - 12} textAnchor="middle" fontSize={26} fontWeight={800} fill="rgb(var(--on-surface))" fontFamily="'Inter Variable', Inter, sans-serif">
          {formatNumber(total)}
        </text>
        <text x={cx} y={cy + 6} textAnchor="middle" fontSize={10} fontWeight={600} fill="rgb(var(--on-surface-variant))" fontFamily="'Inter Variable', Inter, sans-serif" letterSpacing={2}>
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
    </div>
  );
}
