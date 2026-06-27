export type FilterSnapshot = {
  years: number[];
  severities: string[];
  counties: string[];
  causes: string[];
  alcohol: boolean | null;
  distracted: boolean | null;
  pedestrian: boolean | null;
  cyclist: boolean | null;
  drug: boolean | null;
  driverAge: string | null;
  weather: string[];
  lighting: string[];
  collisionType: string[];
  roadType: string | null;
  hitRun: boolean | null;
};

export type ChartPoint = { label: string; value: number };

export type DataContext = {
  kind: "stat" | "chart" | "county" | "highway" | "view" | "correlation";
  label: string;
  filters: FilterSnapshot;
  measure?: string;
  geography?: { type: "county" | "highway" | "state"; id: string; name: string };
  value?: number;
  series?: ChartPoint[];
};

export function serializeContext(ctx: DataContext): string {
  return JSON.stringify(ctx);
}

export function deserializeContext(raw: string): DataContext | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed.kind === "string" && parsed.filters) {
      return parsed as DataContext;
    }
    return null;
  } catch {
    return null;
  }
}

// Stable, order-independent hash for cache keys.
export function hashContext(ctx: DataContext): string {
  const stable = JSON.stringify(ctx, Object.keys(ctx).sort());
  let h = 0;
  for (let i = 0; i < stable.length; i++) {
    h = (h << 5) - h + stable.charCodeAt(i);
    h |= 0;
  }
  return `ctx_${h >>> 0}`;
}
