import { describe, it, expect } from "vitest";
import { buildCorrelationResult, type CorrelationSupplemental } from "./useCorrelationData";
import type { CountyStatsRow } from "../types/api";

// buildCorrelationResult is the pure merge step behind useCorrelationData: it
// joins crash stats with 7 filter-independent supplemental sources into one
// row per county. The sibling *.fars/.density/.nodata test files already
// cover FARS aggregation, tract density, and NaN-vs-zero for missing data —
// this file covers the rest of the merge (demographics, calenviro,
// unemployment, vehicles, weather) and the crash_count > 0 county filter.

const STATS: CountyStatsRow[] = [
  { county_code: 1, county_name: "Alameda", crash_count: 200, total_killed: 4, total_injured: 60 },
  { county_code: 2, county_name: "Kern", crash_count: 0, total_killed: 0, total_injured: 0 },
];

const SUPPLEMENTAL: CorrelationSupplemental = {
  demographics: [
    // Older row has poverty_rate; newer (2023) row's poverty_rate is null —
    // the "most recent year WITH a poverty_rate" rule should keep the 2022 row.
    { county_code: 1, year: 2022, poverty_rate: 12.5, median_income: 80000, population: 1_600_000 },
    { county_code: 1, year: 2023, poverty_rate: null, median_income: 82000, population: 1_650_000 },
  ],
  calenviro: [
    { county_code: 1, ces_score: 45.2, traffic_score: 70 },
  ],
  unemployment: [
    { county_code: 1, year: 2022, unemployment_rate: 4.1 },
    { county_code: 1, year: 2023, unemployment_rate: 3.8 },
  ],
  vehicles: [
    { county_code: 1, year: 2022, total_vehicles: 1_000_000, ev_vehicles: 20_000 },
    // Later year has no ev_vehicles/total_vehicles — should not overwrite
    // the 2022 row's usable numbers since it isn't a strict improvement.
    { county_code: 1, year: 2023, total_vehicles: null, ev_vehicles: null },
  ],
  weather: [
    { county_code: 1, year: 2023, avg_temp_f: 60, precipitation_in: 1.0 },
    { county_code: 1, year: 2023, avg_temp_f: 62, precipitation_in: 2.0 },
    { county_code: 1, year: 2022, avg_temp_f: 100, precipitation_in: 100 }, // older — ignored
  ],
  fars: [],
  density: [],
};

describe("buildCorrelationResult merge", () => {
  it("drops counties with zero crashes from the output rows", () => {
    const result = buildCorrelationResult(STATS, SUPPLEMENTAL);
    expect(result.counties.map((c) => c._name)).toEqual(["Alameda"]);
    expect(result.countyCount).toBe(1);
  });

  it("computes fatality_rate as (killed / crashes) * 100", () => {
    const result = buildCorrelationResult(STATS, SUPPLEMENTAL);
    expect(result.counties[0].fatality_rate).toBe(2); // 4/200 * 100
  });

  it("keeps the most-recent demographics year that actually has poverty_rate", () => {
    const result = buildCorrelationResult(STATS, SUPPLEMENTAL);
    const alameda = result.counties[0];
    expect(alameda.poverty_rate).toBe(12.5);
    // median_income comes from that same (2022) row per the current tie rule.
    expect(alameda.median_income).toBe(80000);
  });

  it("merges calenviroscreen fields by county", () => {
    const result = buildCorrelationResult(STATS, SUPPLEMENTAL);
    expect(result.counties[0].ces_score).toBe(45.2);
    expect(result.counties[0].traffic_score).toBe(70);
  });

  it("takes the last non-null unemployment_rate in source order", () => {
    const result = buildCorrelationResult(STATS, SUPPLEMENTAL);
    expect(result.counties[0].unemployment_rate).toBe(3.8);
  });

  it("computes ev_pct and vehicles_per_capita from the row with usable totals", () => {
    const result = buildCorrelationResult(STATS, SUPPLEMENTAL);
    const alameda = result.counties[0];
    expect(alameda.ev_pct).toBe(2); // 20,000 / 1,000,000 * 100
    // population comes from the demographics row selected above (2022: 1.6M)
    expect(alameda.vehicles_per_capita).toBeCloseTo(1_000_000 / 1_600_000);
  });

  it("averages temp and sums precip within the latest weather year only", () => {
    const result = buildCorrelationResult(STATS, SUPPLEMENTAL);
    const alameda = result.counties[0];
    expect(alameda.avg_temp).toBe(61); // (60 + 62) / 2, the 2022=100 outlier excluded
    expect(alameda.precip).toBe(3); // 1.0 + 2.0
  });
});
