import { describe, it, expect } from "vitest";
import { snapshotFilters, statContext, chartContext, buildTotalCrashesContext } from "./contextBuilders";
import type { FilterSnapshot } from "./dataContext";

const inputs = {
  selectedYears: new Set([2023, 2022]),
  selectedSeverities: new Set(["Fatal"]),
  selectedCounties: new Set(["kern"]),
  selectedCauses: new Set<string>(),
  selectedAlcohol: true,
  selectedDistracted: false,
  selectedPedestrian: false,
  selectedCyclist: false,
  selectedDrug: false,
  selectedDriverAge: null,
  selectedWeather: new Set<string>(),
  selectedLighting: new Set<string>(),
  selectedCollisionType: new Set<string>(),
  selectedRoadType: null,
  selectedHitRun: false,
};

describe("contextBuilders", () => {
  it("snapshots filters: sorts sets, maps false flags to null", () => {
    const snap = snapshotFilters(inputs);
    expect(snap.years).toEqual([2022, 2023]);
    expect(snap.severities).toEqual(["Fatal"]);
    expect(snap.alcohol).toBe(true);
    expect(snap.distracted).toBeNull();
    expect(snap.weather).toEqual([]);
  });

  it("builds a stat context", () => {
    const ctx = statContext({
      label: "Fatality rate · Kern", measure: "fatality_rate", value: 1.5,
      geography: { type: "county", id: "15", name: "Kern" },
      filters: snapshotFilters(inputs),
    });
    expect(ctx.kind).toBe("stat");
    expect(ctx.value).toBe(1.5);
    expect(ctx.measure).toBe("fatality_rate");
  });

  it("builds a chart context with frozen series", () => {
    const ctx = chartContext({
      label: "Crashes by hour", series: [{ label: "0", value: 10 }],
      filters: snapshotFilters(inputs),
    });
    expect(ctx.kind).toBe("chart");
    expect(ctx.series).toEqual([{ label: "0", value: 10 }]);
  });
});

const filters: FilterSnapshot = {
  years: [], severities: [], counties: [], causes: [],
  alcohol: null, distracted: null, pedestrian: null, cyclist: null, drug: null,
  driverAge: null, weather: [], lighting: [], collisionType: [], roadType: null, hitRun: null,
};

describe("buildTotalCrashesContext", () => {
  it("returns null when totalIncidents is null", () => {
    expect(buildTotalCrashesContext({ totalIncidents: null, counties: new Set(), filters })).toBeNull();
  });

  it("builds a county-scoped stat when exactly one county is selected", () => {
    const ctx = buildTotalCrashesContext({ totalIncidents: 1234, counties: new Set(["Kern"]), filters });
    expect(ctx).not.toBeNull();
    expect(ctx!.kind).toBe("stat");
    expect(ctx!.measure).toBe("crash_count");
    expect(ctx!.geography).toEqual({ type: "county", id: "kern", name: "Kern" });
    expect(ctx!.label).toBe("Total crashes · Kern");
  });

  it("builds a statewide stat with no geography for 0 or multiple counties", () => {
    const zero = buildTotalCrashesContext({ totalIncidents: 5, counties: new Set(), filters });
    const many = buildTotalCrashesContext({ totalIncidents: 5, counties: new Set(["Kern", "Inyo"]), filters });
    expect(zero!.geography).toBeUndefined();
    expect(zero!.label).toBe("Total crashes statewide");
    expect(zero!.measure).toBe("crash_count");
    expect(many!.geography).toBeUndefined();
  });
});
