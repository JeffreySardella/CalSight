import type { DataContext, FilterSnapshot, ChartPoint } from "./dataContext";
import { normalizeCounty } from "./measureMetric";

export type FilterInputs = {
  selectedYears: Set<number>;
  selectedSeverities: Set<string>;
  selectedCounties: Set<string>;
  selectedCauses: Set<string>;
  selectedAlcohol: boolean;
  selectedDistracted: boolean;
  selectedPedestrian: boolean;
  selectedCyclist: boolean;
  selectedDrug: boolean;
  selectedDriverAge: string | null;
  selectedWeather: Set<string>;
  selectedLighting: Set<string>;
  selectedCollisionType: Set<string>;
  selectedRoadType: string | null;
  selectedHitRun: boolean;
};

const flag = (b: boolean): boolean | null => (b ? true : null);
const sortedNums = (s: Set<number>) => [...s].sort((a, b) => a - b);
const sortedStrs = (s: Set<string>) => [...s].sort();

export function snapshotFilters(f: FilterInputs): FilterSnapshot {
  return {
    years: sortedNums(f.selectedYears),
    severities: sortedStrs(f.selectedSeverities),
    counties: sortedStrs(f.selectedCounties),
    causes: sortedStrs(f.selectedCauses),
    alcohol: flag(f.selectedAlcohol),
    distracted: flag(f.selectedDistracted),
    pedestrian: flag(f.selectedPedestrian),
    cyclist: flag(f.selectedCyclist),
    drug: flag(f.selectedDrug),
    driverAge: f.selectedDriverAge,
    weather: sortedStrs(f.selectedWeather),
    lighting: sortedStrs(f.selectedLighting),
    collisionType: sortedStrs(f.selectedCollisionType),
    roadType: f.selectedRoadType,
    hitRun: flag(f.selectedHitRun),
  };
}

export function statContext(args: {
  label: string; measure: string; value: number;
  geography?: DataContext["geography"]; filters: FilterSnapshot;
}): DataContext {
  return { kind: "stat", label: args.label, measure: args.measure, value: args.value, geography: args.geography, filters: args.filters };
}

export function chartContext(args: {
  label: string; series: ChartPoint[]; measure?: string; filters: FilterSnapshot;
}): DataContext {
  return { kind: "chart", label: args.label, series: args.series, measure: args.measure, filters: args.filters };
}

// Context for a single metric of a highway route (side-panel "ask AI about this
// route" affordance). geography.type "highway" so the deep-dive prompt frames it
// as a route rather than a county.
export function highwayStatContext(args: {
  route: string; label: string; measure: string; value: number; filters: FilterSnapshot;
}): DataContext {
  return {
    kind: "highway",
    label: args.label,
    measure: args.measure,
    value: args.value,
    geography: { type: "highway", id: args.route, name: args.route },
    filters: args.filters,
  };
}

export function buildTotalCrashesContext(args: {
  totalIncidents: number | null;
  counties: Set<string>;
  filters: FilterSnapshot;
}): DataContext | null {
  if (args.totalIncidents == null) return null;
  const names = [...args.counties];
  if (names.length === 1) {
    const name = names[0];
    return statContext({
      label: `Total crashes · ${name}`,
      measure: "crash_count",
      geography: { type: "county", id: normalizeCounty(name), name },
      value: args.totalIncidents,
      filters: args.filters,
    });
  }
  return statContext({
    label: "Total crashes statewide",
    measure: "crash_count",
    value: args.totalIncidents,
    filters: args.filters,
  });
}
