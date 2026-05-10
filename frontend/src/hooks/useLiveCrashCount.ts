import { useState, useEffect, useRef } from "react";
import { API_BASE } from "../config";
import type { StagedFilters } from "./useStagedFilters";

function buildCountUrl(staged: StagedFilters): string {
  const p = new URLSearchParams();
  if (staged.selectedYears.size > 0) {
    const years = [...staged.selectedYears].sort();
    p.set("start", `${years[0]}-01`);
    p.set("end", `${years[years.length - 1]}-12`);
  }
  if (staged.severities.size > 0) {
    p.set("severity", [...staged.severities].map((s) => s.toLowerCase().replace(/ /g, "-")).join(","));
  }
  if (staged.causes.size > 0) {
    p.set("cause", [...staged.causes].join(","));
  }
  if (staged.alcohol) p.set("alcohol", "true");
  if (staged.distracted) p.set("distracted", "true");
  if (staged.pedestrian) p.set("pedestrian", "true");
  if (staged.cyclist) p.set("cyclist", "true");
  if (staged.drug) p.set("drug", "true");
  if (staged.driverAge) p.set("driver_age", staged.driverAge);
  return `${API_BASE}/api/stats?${p}`;
}

export function useLiveCrashCount(staged: StagedFilters) {
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (abortRef.current) abortRef.current.abort();

    timerRef.current = setTimeout(() => {
      const abort = new AbortController();
      abortRef.current = abort;
      setLoading(true);

      fetch(buildCountUrl(staged), { signal: abort.signal })
        .then((r) => r.json())
        .then((data) => {
          if (!abort.signal.aborted) {
            setCount(data.total_crashes ?? 0);
            setLoading(false);
          }
        })
        .catch(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
    }, 500);

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

  return { count, loading };
}
