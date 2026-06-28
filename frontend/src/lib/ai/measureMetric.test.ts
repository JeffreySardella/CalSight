import { describe, it, expect } from "vitest";
import { measureToMetric, normalizeCounty, adaptDistribution, distributionPopulationMatches } from "./measureMetric";
import type { FilterSnapshot } from "./dataContext";

describe("measureToMetric", () => {
  it("maps known distribution metrics", () => {
    expect(measureToMetric("crash_count")).toBe("crash_count");
    expect(measureToMetric("fatal_crashes")).toBe("fatal_crashes");
    expect(measureToMetric("pedestrian_crashes")).toBe("pedestrian_crashes");
  });
  it("returns null for unknown measures", () => {
    expect(measureToMetric("crashes_total")).toBeNull();
    expect(measureToMetric("")).toBeNull();
    expect(measureToMetric("ksi_rate")).toBeNull();
  });
});

describe("normalizeCounty", () => {
  it("trims and lowercases", () => {
    expect(normalizeCounty("  Kern ")).toBe("kern");
    expect(normalizeCounty("Los Angeles")).toBe("los angeles");
  });
});

describe("adaptDistribution", () => {
  it("maps endpoint rows to DistributionPoint with normalized id", () => {
    const out = adaptDistribution([
      { county_code: 15, county_name: "Kern", value: 100 },
      { county_code: 19, county_name: "Los Angeles", value: 500 },
    ]);
    expect(out).toEqual([
      { id: "kern", name: "Kern", value: 100 },
      { id: "los angeles", name: "Los Angeles", value: 500 },
    ]);
  });
});

const allEmpty: FilterSnapshot = {
  years: [2023], severities: [], counties: ["Kern"], causes: [],
  alcohol: null, distracted: null, pedestrian: null, cyclist: null, drug: null,
  driverAge: null, weather: [], lighting: [], collisionType: [], roadType: null, hitRun: null,
};

describe("distributionPopulationMatches", () => {
  it("returns true when no population-narrowing filter is active", () => {
    expect(distributionPopulationMatches(allEmpty)).toBe(true);
  });
  it("returns false when a severity is present", () => {
    expect(distributionPopulationMatches({ ...allEmpty, severities: ["Fatal"] })).toBe(false);
  });
  it("returns false when an involvement flag (alcohol) is set", () => {
    expect(distributionPopulationMatches({ ...allEmpty, alcohol: true })).toBe(false);
  });
  it("returns true for a county + single-year-only snapshot (no other filters)", () => {
    expect(distributionPopulationMatches({ ...allEmpty, years: [2023], counties: ["Kern"] })).toBe(true);
  });
});
