import type { DashboardConfig } from "./types";

export function encodeDashboard(config: DashboardConfig): string {
  const json = JSON.stringify(config);
  return btoa(encodeURIComponent(json));
}

export function decodeDashboard(encoded: string): DashboardConfig | null {
  try {
    const json = decodeURIComponent(atob(encoded));
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed.mode !== "string") return null;
    return parsed as DashboardConfig;
  } catch {
    return null;
  }
}
