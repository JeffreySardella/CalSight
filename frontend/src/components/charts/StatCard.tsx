interface StatItem {
  label: string;
  value: number;
}

interface StatCardProps {
  data: StatItem[];
  height?: number;
}

function formatNumber(val: number): string {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return val.toLocaleString();
}

export default function StatCard({ data, height = 192 }: StatCardProps) {
  if (!data.length) return null;

  const total = data.reduce((s, d) => s + d.value, 0);
  const top = [...data].sort((a, b) => b.value - a.value).slice(0, 3);
  const topPcts = top.map((d) => ({
    ...d,
    pct: total > 0 ? Math.round((d.value / total) * 100) : 0,
  }));

  return (
    <div className="flex flex-col items-center justify-center gap-3" style={{ height }}>
      <div className="text-center">
        <p className="text-4xl font-headline font-bold text-on-surface tracking-tight">
          {formatNumber(total)}
        </p>
        <p className="text-[10px] text-on-surface-variant uppercase tracking-widest mt-1">
          total across {data.length} categories
        </p>
      </div>
      <div className="w-full max-w-[200px] space-y-2 mt-2">
        {topPcts.map((d) => (
          <div key={d.label}>
            <div className="flex justify-between text-[10px] mb-0.5">
              <span className="text-on-surface font-medium">{d.label}</span>
              <span className="text-on-surface-variant">{d.pct}%</span>
            </div>
            <div
              className="h-1.5 bg-surface-container-high rounded-full overflow-hidden"
              role="progressbar"
              aria-valuenow={d.pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${d.label}: ${d.pct}%`}
            >
              <div
                className="h-full bg-primary rounded-full transition-all"
                style={{ width: `${d.pct}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
