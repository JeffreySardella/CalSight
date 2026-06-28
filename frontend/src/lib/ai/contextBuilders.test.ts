import { describe, it, expect } from "vitest";
import { snapshotFilters, statContext, chartContext } from "./contextBuilders";

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
