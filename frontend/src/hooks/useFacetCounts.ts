import { useEffect, useState, useRef } from "react";
import { API_BASE } from "../config";
import type { StagedFilters } from "./useStagedFilters";

export interface ConditionCounts {
  weather?: Record<string, number>;
  lighting?: Record<string, number>;
  collisionType?: Record<string, number>;
  roadType?: Record<string, number>;
  hitRun?: number;
}

export interface FacetCounts {
  years: Record<number, number>;
  severities: Record<string, number>;
  causes: Record<string, number>;
  involvement: Record<string, number>;
  driverAge: Record<string, number>;
  conditions: ConditionCounts;
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
  if (exclude !== "weather" && staged.weather.size > 0) p.set("weather", [...staged.weather].join(","));
  if (exclude !== "lighting" && staged.lighting.size > 0) p.set("lighting", [...staged.lighting].join(","));
  if (exclude !== "collisionType" && staged.collisionType.size > 0) p.set("collision_type", [...staged.collisionType].join(","));
  if (exclude !== "roadType" && staged.roadType) p.set("road_type", staged.roadType);
  if (exclude !== "hitRun" && staged.hitRun) p.set("hit_run", "true");

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
    conditions: {},
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
      const weatherParams = buildParams(staged, "weather");
      const lightingParams = buildParams(staged, "lighting");
      const collisionParams = buildParams(staged, "collisionType");

      const fetchJson = (url: string) =>
        fetch(url, { signal: abort.signal }).then((r) => r.ok ? r.json() : []).catch(() => []);

      Promise.all([
        fetchJson(`${API_BASE}/api/stats?group_by=year&${yearParams}`),
        fetchJson(`${API_BASE}/api/stats?group_by=severity&${sevParams}`),
        fetchJson(`${API_BASE}/api/stats?group_by=cause&${causeParams}`),
        fetchCount(`${API_BASE}/api/stats?${baseParams}&alcohol=true`, abort.signal),
        fetchCount(`${API_BASE}/api/stats?${baseParams}&distracted=true`, abort.signal),
        fetchCount(`${API_BASE}/api/stats?${baseParams}&pedestrian=true`, abort.signal),
        fetchCount(`${API_BASE}/api/stats?${baseParams}&cyclist=true`, abort.signal),
        fetchCount(`${API_BASE}/api/stats?${baseParams}&drug=true`, abort.signal),
        fetchJson(`${API_BASE}/api/stats?group_by=weather&${weatherParams}`),
        fetchJson(`${API_BASE}/api/stats?group_by=lighting&${lightingParams}`),
        fetchJson(`${API_BASE}/api/stats?group_by=collision_type&${collisionParams}`),
      ]).then(([yearData, sevData, causeData, alcCount, distCount, pedCount, cycCount, drugCount, weatherData, lightingData, collisionData]) => {
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

        const weatherCounts: Record<string, number> = {};
        for (const r of weatherData) if (r.value !== "unknown") weatherCounts[r.value] = r.crash_count;

        const lightingCounts: Record<string, number> = {};
        for (const r of lightingData) if (r.value !== "unknown") lightingCounts[r.value] = r.crash_count;

        const collisionCounts: Record<string, number> = {};
        for (const r of collisionData) if (r.value !== "unknown") collisionCounts[r.value] = r.crash_count;

        const conditions: ConditionCounts = {
          weather: weatherCounts,
          lighting: lightingCounts,
          collisionType: collisionCounts,
        };

        setCounts({ years, severities, causes, involvement, conditions, loading: false });
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
    staged.weather.size,
    [...staged.weather].join(","),
    staged.lighting.size,
    [...staged.lighting].join(","),
    staged.collisionType.size,
    [...staged.collisionType].join(","),
    staged.roadType,
    staged.hitRun,
    staged.dateRange?.start?.year,
    staged.dateRange?.start?.month,
    staged.dateRange?.end?.year,
    staged.dateRange?.end?.month,
  ]);

  return counts;
}
