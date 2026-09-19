import { describe, it, expect } from "vitest";
import { annualDriverCount, annualVmtMillions, computeMeasureValue } from "./measures";

const stats = (crash_count: number, total_killed = 0) => ({
  county_code: 19, county_name: "Los Angeles", crash_count, total_killed, total_injured: 0,
});

describe("per-driver and per-road-mile measures", () => {
  it("crashes per 10k drivers is an annual rate", () => {
    const one = computeMeasureValue("crashes_per_10k_drivers", stats(1_000), [], { annualDrivers: 100_000, yearCount: 1 });
    expect(one).toEqual({ value: 100, hasEnoughData: true });
    const three = computeMeasureValue("crashes_per_10k_drivers", stats(3_000), [], { annualDrivers: 100_000, yearCount: 3 });
    expect(three.value).toBeCloseTo(100, 10);
  });

  it("fatalities per 10k drivers uses deaths as the numerator", () => {
    const r = computeMeasureValue("fatalities_per_10k_drivers", stats(1_000, 20), [], { annualDrivers: 100_000, yearCount: 1 });
    expect(r.value).toBeCloseTo(2, 10);
  });

  it("crashes per 100 road miles annualizes over the selected years", () => {
    const r = computeMeasureValue("crashes_per_100_road_miles", stats(1_000), [], { roadMiles: 1_000, yearCount: 2 });
    expect(r.value).toBeCloseTo(50, 10);
  });

  it("crashes per 100M vehicle miles annualizes over the selected years", () => {
    // 1,000 crashes over 2 years against 500M miles/yr = 1,000 / 1,000M = 100 per 100M.
    const r = computeMeasureValue("crashes_per_100m_vmt", stats(1_000), [], { annualVmtMillions: 500, yearCount: 2 });
    expect(r.value).toBeCloseTo(100, 10);
  });

  it("returns no-data without a denominator or below the crash floor", () => {
    expect(computeMeasureValue("crashes_per_10k_drivers", stats(1_000), [], { annualDrivers: null, yearCount: 1 }).hasEnoughData).toBe(false);
    expect(computeMeasureValue("crashes_per_100_road_miles", stats(1_000), [], { roadMiles: 0, yearCount: 1 }).hasEnoughData).toBe(false);
    expect(computeMeasureValue("crashes_per_10k_drivers", stats(4), [], { annualDrivers: 100_000, yearCount: 1 }).hasEnoughData).toBe(false);
    expect(computeMeasureValue("crashes_per_100_road_miles", stats(1_000), [], { roadMiles: 1_000, yearCount: 0 }).hasEnoughData).toBe(false);
    expect(computeMeasureValue("crashes_per_100m_vmt", stats(1_000), [], { annualVmtMillions: null, yearCount: 1 }).hasEnoughData).toBe(false);
    expect(computeMeasureValue("crashes_per_100m_vmt", stats(4), [], { annualVmtMillions: 500, yearCount: 1 }).hasEnoughData).toBe(false);
  });
});

describe("annualDriverCount", () => {
  const rows = [
    { year: 2008, driver_count: 100 },
    { year: 2023, driver_count: 200 },
    { year: 2024, driver_count: 300 },
    { year: 2022, driver_count: null },
  ];

  it("averages the selected years that have data", () => {
    expect(annualDriverCount(rows, new Set([2023, 2024]))).toBe(250);
  });

  it("averages every valid year when no years are selected", () => {
    expect(annualDriverCount(rows, new Set())).toBe(200);
  });

  it("falls back to the nearest year when the window has no data", () => {
    expect(annualDriverCount(rows, new Set([2025, 2026]))).toBe(300);
    expect(annualDriverCount(rows, new Set([2001, 2002]))).toBe(100);
  });

  it("returns null when the county has no driver data", () => {
    expect(annualDriverCount([{ year: 2023, driver_count: null }], new Set([2023]))).toBeNull();
  });
});

describe("annualVmtMillions", () => {
  const rows = [
    { year: 2001, vmt_millions: 100 },
    { year: 2023, vmt_millions: 200 },
    { year: 2025, vmt_millions: 300 },
    { year: 2024, vmt_millions: null },
  ];

  it("averages the selected years that have data", () => {
    expect(annualVmtMillions(rows, new Set([2023, 2025]))).toBe(250);
  });

  it("falls back to the nearest year when the window is past EMFAC coverage", () => {
    expect(annualVmtMillions(rows, new Set([2026]))).toBe(300);
  });

  it("returns null when the county has no VMT data", () => {
    expect(annualVmtMillions([{ year: 2023, vmt_millions: null }], new Set([2023]))).toBeNull();
  });
});
