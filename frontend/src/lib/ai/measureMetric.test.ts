import { describe, it, expect } from "vitest";
import { measureToMetric, normalizeCounty, adaptDistribution } from "./measureMetric";

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
