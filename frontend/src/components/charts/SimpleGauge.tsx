interface GaugeItem {
  label: string;
  value: number;
  color?: string;
}

interface SimpleGaugeProps {
  data: GaugeItem[];
  height?: number;
}

function formatNumber(val: number): string {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return val.toLocaleString();
}

export default function SimpleGauge({ data, height = 180 }: SimpleGaugeProps) {
  if (!data.length) return null;

  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;

  const cx = 140;
  const cy = height - 30;
  const r = Math.min(cx - 10, cy - 10);
  const trackW = 28;

  const COLORS = [
    "#dc2626", "#f59e0b", "#2563eb", "#7c3aed", "#6b7280",
  ];

  let cumPct = 0;
  const arcs = data.map((d, i) => {
    const pct = d.value / total;
    const startAngle = Math.PI + cumPct * Math.PI;
    cumPct += pct;
    const endAngle = Math.PI + cumPct * Math.PI;
    const x1 = cx + (r - trackW / 2) * Math.cos(startAngle);
    const y1 = cy + (r - trackW / 2) * Math.sin(startAngle);
    const x2 = cx + (r - trackW / 2) * Math.cos(endAngle);
    const y2 = cy + (r - trackW / 2) * Math.sin(endAngle);
    const large = pct > 0.5 ? 1 : 0;
    const rr = r - trackW / 2;
    return {
      d: `M ${x1} ${y1} A ${rr} ${rr} 0 ${large} 1 ${x2} ${y2}`,
      color: d.color ?? COLORS[i % COLORS.length] ?? "#6b7280",
      label: d.label,
      pct: Math.round(pct * 100),
      value: d.value,
    };
  });

  return (
    <div className="w-full" style={{ height }}>
      <svg width="100%" height={height} viewBox={`0 0 280 ${height}`} className="block">
        <path
          d={`M ${cx - r + trackW / 2} ${cy} A ${r - trackW / 2} ${r - trackW / 2} 0 0 1 ${cx + r - trackW / 2} ${cy}`}
          fill="none"
          stroke="rgb(var(--surface-container-high))"
          strokeWidth={trackW}
          strokeLinecap="round"
        />
        {arcs.map((arc, i) => (
          <path
            key={i}
            d={arc.d}
            fill="none"
            stroke={arc.color}
            strokeWidth={trackW}
            strokeLinecap="butt"
          />
        ))}
        <text
          x={cx}
          y={cy - 10}
          textAnchor="middle"
          fontSize={28}
          fontWeight={800}
          fill="rgb(var(--on-surface))"
          fontFamily="'Inter Variable', Inter, sans-serif"
        >
          {formatNumber(total)}
        </text>
        <text
          x={cx}
          y={cy + 10}
          textAnchor="middle"
          fontSize={11}
          fontWeight={600}
          fill="rgb(var(--on-surface-variant))"
          fontFamily="'Inter Variable', Inter, sans-serif"
          letterSpacing={2}
        >
          TOTAL
        </text>
      </svg>
      <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center -mt-4">
        {arcs.map((arc, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[10px]">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: arc.color }} />
            <span className="text-on-surface-variant">{arc.label} {arc.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
