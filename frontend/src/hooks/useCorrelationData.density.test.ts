import { describe, it, expect } from "vitest";
import { CORRELATION_FIELDS, applyTractDensityAggregation } from "./useCorrelationData";
import type { CountyRow } from "./useCorrelationData";

describe("lived-density correlation field", () => {
  it("registers weighted_density with source census", () => {
    const f = CORRELATION_FIELDS.find((x) => x.key === "weighted_density");
    expect(f).toBeDefined();
    expect(f?.source).toBe("census");
  });

  it("applies most-recent-year weighted_density per county, skips unknown counties", () => {
    const byCounty: Record<string, CountyRow> = { "19": { crash_count: 5 } };
    applyTractDensityAggregation(
      [
        { county_code: 19, year: 2021, weighted_density: 8400, tract_count: 1 },
        { county_code: 19, year: 2022, weighted_density: 8500, tract_count: 1 },
        { county_code: 30, year: 2022, weighted_density: 4200, tract_count: 1 }, // not in byCounty
      ],
      byCounty,
    );
    expect(byCounty["19"].weighted_density).toBe(8500); // latest year wins
    expect(byCounty["30"]).toBeUndefined();
  });
});
