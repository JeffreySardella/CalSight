import { describe, it, expect } from "vitest";
import { measureToMetric, normalizeCounty, adaptDistribution, filtersToDistributionParams } from "./measureMetric";
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

describe("filtersToDistributionParams", () => {
  it("emits no params for an unfiltered snapshot", () => {
    expect(filtersToDistributionParams(allEmpty)).toEqual({});
  });
  it("excludes counties and years (distribution must span all counties)", () => {
    const out = filtersToDistributionParams({ ...allEmpty, counties: ["Kern", "Inyo"], years: [2023] });
    expect(out.county).toBeUndefined();
    expect(out.year).toBeUndefined();
  });
  it("serializes severities and causes as CSV", () => {
    const out = filtersToDistributionParams({ ...allEmpty, severities: ["Fatal", "Injury"], causes: ["dui"] });
    expect(out.severity).toBe("Fatal,Injury");
    expect(out.cause).toBe("dui");
  });
  it("serializes boolean involvement flags as 'true'/'false'", () => {
    expect(filtersToDistributionParams({ ...allEmpty, alcohol: true }).alcohol).toBe("true");
    expect(filtersToDistributionParams({ ...allEmpty, hitRun: false }).hit_run).toBe("false");
  });
  it("passes through driverAge and roadType strings", () => {
    const out = filtersToDistributionParams({ ...allEmpty, driverAge: "25-34", roadType: "highway" });
    expect(out.driver_age).toBe("25-34");
    expect(out.road_type).toBe("highway");
  });
});
