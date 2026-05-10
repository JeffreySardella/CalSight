import { useEffect, useState, useRef } from "react";
import { API_BASE } from "../config";
import type { StagedFilters } from "./useStagedFilters";

export interface FacetCounts {
  years: Record<number, number>;
  severities: Record<string, number>;
  causes: Record<string, number>;
  involvement: Record<string, number>;
  loading: boolean;
}

function buildParams(staged: StagedFilters, exclude: string): string {
  const p = new URLSearchParams();

  if (exclude !== "year" && staged.selectedYears.size > 0) {
    const years = [...staged.selectedYears].sort();
    p.set("start", `${years[0]}-01`);
    p.set("end", `${years[years.length - 1]}-12`);
  }
  if (exclude !== "severity" && staged.severities.size > 0) {
    p.set("severity", [...staged.severities].map((s) => s.toLowerCase().replace(/ /g, "-")).join(","));
  }
  if (exclude !== "cause" && staged.causes.size > 0) {
    p.set("cause", [...staged.causes].join(","));
  }
  if (exclude !== "alcohol" && staged.alcohol) p.set("alcohol", "true");
  if (exclude !== "distracted" && staged.distracted) p.set("distracted", "true");
  if (exclude !== "pedestrian" && staged.pedestrian) p.set("pedestrian", "true");
  if (exclude !== "cyclist" && staged.cyclist) p.set("cyclist", "true");
  if (exclude !== "drug" && staged.drug) p.set("drug", "true");
  if (exclude !== "driverAge" && staged.driverAge) p.set("driver_age", staged.driverAge);

  return p.toString();
}

async function fetchCount(url: string, signal: AbortSignal): Promise<number> {
  try {
    const r = await fetch(url, { signal });
    if (!r.ok) return 0;
    const data = await r.json();
    return data.total_crashes ?? 0;
  } catch {
    return 0;
  }
}

export function useFacetCounts(staged: StagedFilters): FacetCounts {
  const [counts, setCounts] = useState<FacetCounts>({
    years: {},
    severities: {},
    causes: {},
    involvement: {},
    loading: false,
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (abortRef.current) abortRef.current.abort();

    timerRef.current = setTimeout(() => {
      const abort = new AbortController();
      abortRef.current = abort;
      setCounts((prev) => ({ ...prev, loading: true }));

      const yearParams = buildParams(staged, "year");
      const sevParams = buildParams(staged, "severity");
      const causeParams = buildParams(staged, "cause");
      const baseParams = buildParams(staged, "");

      Promise.all([
        fetch(`${API_BASE}/api/stats?group_by=year&${yearParams}`, { signal: abort.signal })
          .then((r) => r.ok ? r.json() : []).catch(() => []),
        fetch(`${API_BASE}/api/stats?group_by=severity&${sevParams}`, { signal: abort.signal })
          .then((r) => r.ok ? r.json() : []).catch(() => []),
        fetch(`${API_BASE}/api/stats?group_by=cause&${causeParams}`, { signal: abort.signal })
          .then((r) => r.ok ? r.json() : []).catch(() => []),
        fetchCount(`${API_BASE}/api/stats?${baseParams}&alcohol=true`, abort.signal),
        fetchCount(`${API_BASE}/api/stats?${baseParams}&distracted=true`, abort.signal),
        fetchCount(`${API_BASE}/api/stats?${baseParams}&pedestrian=true`, abort.signal),
        fetchCount(`${API_BASE}/api/stats?${baseParams}&cyclist=true`, abort.signal),
        fetchCount(`${API_BASE}/api/stats?${baseParams}&drug=true`, abort.signal),
      ]).then(([yearData, sevData, causeData, alcCount, distCount, pedCount, cycCount, drugCount]) => {
        if (abort.signal.aborted) return;

        const years: Record<number, number> = {};
        for (const r of yearData) years[r.year] = r.crash_count;

        const severities: Record<string, number> = {};
        for (const r of sevData) severities[r.severity] = r.crash_count;

        const causes: Record<string, number> = {};
        for (const r of causeData) {
          const slug = (r.canonical_cause ?? "").replace(/_/g, "-");
          causes[slug] = r.crash_count;
          causes[r.canonical_cause] = r.crash_count;
        }

        const involvement: Record<string, number> = {
          alcohol: alcCount,
          distracted: distCount,
          pedestrian: pedCount,
          cyclist: cycCount,
          drug: drugCount,
        };

        setCounts({ years, severities, causes, involvement, loading: false });
      });
    }, 300);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [
    staged.selectedYears.size,
    [...staged.selectedYears].join(","),
    staged.severities.size,
    [...staged.severities].join(","),
    staged.causes.size,
    [...staged.causes].join(","),
    staged.alcohol,
    staged.distracted,
    staged.pedestrian,
    staged.cyclist,
    staged.drug,
    staged.driverAge,
    staged.dateRange?.start?.year,
    staged.dateRange?.start?.month,
    staged.dateRange?.end?.year,
    staged.dateRange?.end?.month,
  ]);

  return counts;
}
