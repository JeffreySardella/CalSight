import { describe, it, expect } from "vitest";
import { coordCoverageByCounty, type DataQualityRow } from "./useCoordCoverage";
import { YEARS } from "./useFilterParams";

// /api/data-quality returns every scope in one payload: per county x year,
// statewide per year (county_code null) and per county all-time (year null).
// coordCoverageByCounty has to sum ONLY the county x year rows, or the
// all-time and statewide rows double- and triple-count the same crashes.
const ROWS: DataQualityRow[] = [
  { county_code: 19, year: 2003, total_crashes: 1_000, crashes_with_coords: 0 },
  { county_code: 19, year: 2024, total_crashes: 1_000, crashes_with_coords: 800 },
  { county_code: 45, year: 2024, total_crashes: 200, crashes_with_coords: 50 },
  { county_code: 19, year: null, total_crashes: 2_000, crashes_with_coords: 800 },
  { county_code: null, year: 2024, total_crashes: 1_200, crashes_with_coords: 850 },
];

const range = (startYear: number, endYear: number) => ({
  start: { year: startYear, month: 1 },
  end: { year: endYear, month: 12 },
});

describe("coordCoverageByCounty", () => {
  it("sums the county x year rows and ignores the other scopes", () => {
    const byCounty = coordCoverageByCounty(ROWS, null);
    expect(byCounty.get(19)).toEqual({ withCoords: 800, total: 2_000 });
    expect(byCounty.get(45)).toEqual({ withCoords: 50, total: 200 });
    expect(byCounty.has(0)).toBe(false);
  });

  it("restricts to the selected years", () => {
    const byCounty = coordCoverageByCounty(ROWS, range(2024, 2024));
    expect(byCounty.get(19)).toEqual({ withCoords: 800, total: 1_000 });

    const early = coordCoverageByCounty(ROWS, range(2003, 2003));
    expect(early.get(19)).toEqual({ withCoords: 0, total: 1_000 });
    expect(early.has(45)).toBe(false);
  });

  it("treats a full-span selection as all years", () => {
    const all = coordCoverageByCounty(ROWS, range(YEARS[0], YEARS[YEARS.length - 1]));
    expect(all.get(19)).toEqual({ withCoords: 800, total: 2_000 });
  });

  it("returns an empty map before the fetch resolves", () => {
    expect(coordCoverageByCounty(undefined, null).size).toBe(0);
  });
});
