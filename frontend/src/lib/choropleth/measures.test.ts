import { describe, it, expect } from "vitest";
import { computeMeasureValue, MEASURES, MIN_CRASHES_FOR_RATE, type MeasureKey } from "./measures";

const tenCrashes = {
  county_code: 19,
  county_name: "Fresno",
  crash_count: 10,
  total_killed: 2,
  total_injured: 3,
};
const pop50k = { county_code: 19, year: 2023, population: 50_000 };

describe("computeMeasureValue", () => {
  it("crashes_per_100k divides crashes by (pop/100k)", () => {
    // 10 crashes / (50k/100k) = 10 / 0.5 = 20
    const r = computeMeasureValue("crashes_per_100k", tenCrashes, [pop50k]);
    expect(r.hasEnoughData).toBe(true);
    expect(r.value).toBe(20);
  });

  it("crashes_per_100k returns no-data when population is null", () => {
    const r = computeMeasureValue("crashes_per_100k", tenCrashes, [
      { ...pop50k, population: null },
    ]);
    expect(r.hasEnoughData).toBe(false);
    expect(r.value).toBeNull();
  });

  it("crashes_per_100k returns no-data when crashes < MIN_CRASHES_FOR_RATE", () => {
    const sparse = { ...tenCrashes, crash_count: 4, total_killed: 0, total_injured: 0 };
    const r = computeMeasureValue("crashes_per_100k", sparse, [pop50k]);
    expect(r.hasEnoughData).toBe(false);
  });

  it("crashes_raw uses crash_count directly and ignores population", () => {
    const r = computeMeasureValue("crashes_raw", tenCrashes, []);
    expect(r.hasEnoughData).toBe(true);
    expect(r.value).toBe(10);
  });

  it("fatality_rate returns percentage", () => {
    // 2 killed / 10 crashes * 100 = 20
    const r = computeMeasureValue("fatality_rate", tenCrashes, []);
    expect(r.value).toBe(20);
  });

  it("fatality_rate returns no-data when crashes < threshold", () => {
    const sparse = { ...tenCrashes, crash_count: 3 };
    const r = computeMeasureValue("fatality_rate", sparse, []);
    expect(r.hasEnoughData).toBe(false);
  });

  it("multi-year per-capita sums per-year terms", () => {
    // 2020: 5 crashes, pop 100k → 5 per 100k
    // 2023: 10 crashes, pop 50k → 20 per 100k
    // total: 25 per 100k
    const stats = { ...tenCrashes, crash_count: 15 };
    const demos = [
      { county_code: 19, year: 2020, population: 100_000 },
      { county_code: 19, year: 2023, population: 50_000 },
    ];
    const perYearCrashes = new Map<number, number>([[2020, 5], [2023, 10]]);
    const r = computeMeasureValue("crashes_per_100k", stats, demos, { perYearCrashes });
    expect(r.value).toBe(25);
  });

  it("MIN_CRASHES_FOR_RATE equals 5", () => {
    expect(MIN_CRASHES_FOR_RATE).toBe(5);
  });

  it("MEASURES exposes 5 measures including default", () => {
    const keys: MeasureKey[] = Object.keys(MEASURES) as MeasureKey[];
    expect(keys).toHaveLength(5);
    expect(keys).toContain("crashes_per_100k");
  });
});
