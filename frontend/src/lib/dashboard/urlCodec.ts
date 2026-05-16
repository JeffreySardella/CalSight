import type { DashboardConfig } from "./types";

export function encodeDashboard(config: DashboardConfig): string {
  const json = JSON.stringify(config);
  return btoa(encodeURIComponent(json));
}

export function decodeDashboard(encoded: string): DashboardConfig | null {
  try {
    const json = decodeURIComponent(atob(encoded));
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.mode !== "simple" && parsed.mode !== "advanced") return null;
    if (typeof parsed.preset !== "string") return null;
    if (!Array.isArray(parsed.charts)) return null;
    return parsed as DashboardConfig;
  } catch {
    return null;
  }
}
