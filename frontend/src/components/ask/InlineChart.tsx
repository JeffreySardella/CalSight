import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { ChartData } from "../../hooks/useAskAi";

const COLORS = ["#6b8fa3", "#c25560", "#b0a050", "#7ba088", "#b89a6b", "#8e7cc3", "#5a9eaf", "#d4845a"];

interface Props {
  chart: ChartData;
}

function formatNumber(val: number): string {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return val.toLocaleString();
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface-container-lowest ghost-border rounded-lg px-3 py-2 text-xs">
      <p className="font-bold text-on-surface">{label}</p>
      <p className="text-on-surface-variant">{payload[0].value.toLocaleString()} crashes</p>
    </div>
  );
}

export default function InlineChart({ chart }: Props) {
  const { type, title, data } = chart;

  if (!data || data.length === 0) return null;

  return (
    <div className="my-3 p-3 md:p-4 bg-surface-container rounded-lg overflow-x-auto">
      {title && (
        <p className="text-[10px] md:text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">{title}</p>
      )}
      <div className="min-w-[300px]">
      <ResponsiveContainer width="100%" height={180}>
        {type === "line" ? (
          <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="var(--color-on-surface-variant, #666)" interval={data.length > 10 ? Math.floor(data.length / 6) : 0} angle={data.length > 8 ? -45 : 0} textAnchor={data.length > 8 ? "end" : "middle"} height={data.length > 8 ? 45 : 30} />
            <YAxis tick={{ fontSize: 11 }} stroke="var(--color-on-surface-variant, #666)" width={55} tickFormatter={formatNumber} />
            <Tooltip content={<CustomTooltip />} />
            <Line type="monotone" dataKey="value" stroke="#6b8fa3" strokeWidth={2} dot={data.length <= 12 ? { r: 3 } : false} />
          </LineChart>
        ) : type === "pie" ? (
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" cx="50%" cy="50%" outerRadius={80} label={({ label }) => label}>
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        ) : (
          <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="var(--color-on-surface-variant, #666)" interval={0} angle={data.length > 5 ? -45 : 0} textAnchor={data.length > 5 ? "end" : "middle"} height={data.length > 5 ? 60 : 30} />
            <YAxis tick={{ fontSize: 11 }} stroke="var(--color-on-surface-variant, #666)" width={55} tickFormatter={formatNumber} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="value" fill="#6b8fa3" radius={[4, 4, 0, 0]} />
          </BarChart>
        )}
      </ResponsiveContainer>
      </div>
    </div>
  );
}
