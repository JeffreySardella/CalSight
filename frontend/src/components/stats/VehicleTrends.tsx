import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../../config";
import SimpleLineChart from "../charts/SimpleLineChart";
import { Skeleton } from "../ui/Skeleton";

type YearData = { year: number; total: number; ev: number; gas: number; evPct: number };

export default function VehicleTrends() {
  const query = useQuery({
    queryKey: ["vehicle-trends"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/vehicles`);
      if (!res.ok) throw new Error("Failed to fetch vehicle data");
      const raw: Record<string, unknown>[] = await res.json();

      const byYear: Record<number, { total: number; ev: number }> = {};
      for (const r of raw) {
        const year = r.year as number;
        const total = (r.total_vehicles as number) ?? 0;
        const ev = (r.ev_vehicles as number) ?? 0;
        if (!byYear[year]) byYear[year] = { total: 0, ev: 0 };
        byYear[year].total += total;
        byYear[year].ev += ev;
      }

      const years: YearData[] = Object.entries(byYear)
        .map(([y, d]) => ({
          year: Number(y),
          total: d.total,
          ev: d.ev,
          gas: d.total - d.ev,
          evPct: d.total > 0 ? Math.round((d.ev / d.total) * 1000) / 10 : 0,
        }))
        .sort((a, b) => a.year - b.year)
        .filter((d) => d.year >= 2010 && d.year < new Date().getFullYear());

      return years;
    },
    staleTime: 5 * 60 * 1000,
  });

  if (query.isLoading) return <Skeleton className="h-64 rounded-lg" />;
  if (query.error || !query.data?.length) return null;

  const data = query.data;

  function fmtK(v: number): string {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
    return v.toString();
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-headline font-bold text-on-surface">Vehicle Registration Trends</h3>
        <p className="text-[10px] text-on-surface-variant">California DMV — EV adoption vs total registered vehicles</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-surface-container rounded-xl p-4">
          <p className="text-[10px] text-on-surface-variant uppercase tracking-wider font-semibold mb-2">EV Adoption Rate</p>
          <SimpleLineChart
            data={data.map((d) => ({ label: String(d.year), value: d.evPct }))}
            height={160}
            color="#059669"
            showArea
            showTrendLine
          />
        </div>

        <div className="bg-surface-container rounded-xl p-4">
          <p className="text-[10px] text-on-surface-variant uppercase tracking-wider font-semibold mb-2">EV Registrations</p>
          <SimpleLineChart
            data={data.map((d) => ({ label: String(d.year), value: d.ev }))}
            height={160}
            color="#2563eb"
            showArea
            showTrendLine
          />
        </div>

        <div className="bg-surface-container rounded-xl p-4">
          <p className="text-[10px] text-on-surface-variant uppercase tracking-wider font-semibold mb-2">Total Fleet Size</p>
          <SimpleLineChart
            data={data.map((d) => ({ label: String(d.year), value: d.total }))}
            height={160}
            showArea
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-center">
        {data.length > 0 && (() => {
          const latest = data[data.length - 1];
          const earliest = data.find((d) => d.ev > 0);
          return (
            <>
              <div className="bg-surface-container rounded-xl px-4 py-3 flex-1 min-w-[120px]">
                <p className="text-2xl font-headline font-bold text-on-surface">{latest.evPct}%</p>
                <p className="text-[9px] text-on-surface-variant uppercase tracking-wider">EV Share ({latest.year})</p>
              </div>
              <div className="bg-surface-container rounded-xl px-4 py-3 flex-1 min-w-[120px]">
                <p className="text-2xl font-headline font-bold text-on-surface">{fmtK(latest.ev)}</p>
                <p className="text-[9px] text-on-surface-variant uppercase tracking-wider">EVs Registered</p>
              </div>
              <div className="bg-surface-container rounded-xl px-4 py-3 flex-1 min-w-[120px]">
                <p className="text-2xl font-headline font-bold text-on-surface">{fmtK(latest.total)}</p>
                <p className="text-[9px] text-on-surface-variant uppercase tracking-wider">Total Vehicles</p>
              </div>
              {earliest && (
                <div className="bg-surface-container rounded-xl px-4 py-3 flex-1 min-w-[120px]">
                  <p className="text-2xl font-headline font-bold text-on-surface">
                    {Math.round(latest.ev / Math.max(earliest.ev, 1))}×
                  </p>
                  <p className="text-[9px] text-on-surface-variant uppercase tracking-wider">Growth since {earliest.year}</p>
                </div>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}
