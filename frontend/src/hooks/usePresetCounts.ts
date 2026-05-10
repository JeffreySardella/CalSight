import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../config";

interface PresetCount {
  label: string;
  url: string;
}

const PRESET_QUERIES: PresetCount[] = [
  { label: "Fatal DUI Crashes", url: "/api/stats?cause=dui&severity=fatal" },
  { label: "Pedestrian Safety", url: "/api/stats?pedestrian=true" },
  { label: "Teen Drivers", url: "/api/stats?driver_age=16-21" },
  { label: "Senior Drivers", url: "/api/stats?driver_age=65%2B" },
  { label: "Cyclist Crashes", url: "/api/stats?cyclist=true" },
  { label: "Fatal Crashes Only", url: "/api/stats?severity=fatal" },
];

async function fetchAllCounts(): Promise<Record<string, number>> {
  const results: Record<string, number> = {};
  const responses = await Promise.all(
    PRESET_QUERIES.map((p) =>
      fetch(`${API_BASE}${p.url}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => ({ label: p.label, total: data?.total_crashes ?? 0 }))
        .catch(() => ({ label: p.label, total: 0 }))
    )
  );
  for (const r of responses) {
    results[r.label] = r.total;
  }
  return results;
}

export function usePresetCounts() {
  return useQuery<Record<string, number>>({
    queryKey: ["preset-counts"],
    queryFn: fetchAllCounts,
    staleTime: 5 * 60 * 1000,
  });
}
