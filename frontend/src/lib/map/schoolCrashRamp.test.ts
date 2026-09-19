import { describe, it, expect } from "vitest";
import {
  SCHOOL_CRASH_COLORS,
  SCHOOL_NO_DATA_COLOR,
  coverageCaveat,
  schoolCrashColor,
  schoolRampEdges,
  yearsLabel,
  type CountyCoordCoverage,
  type SchoolCrashCount,
} from "./schoolCrashRamp";

function counts(...values: number[]): SchoolCrashCount[] {
  return values.map((crashes, i) => ({
    cds_code: `c${i}`,
    crashes,
    killed: 0,
    injured: 0,
    severe_injured: 0,
  }));
}

function coverage(partial: Partial<CountyCoordCoverage>): CountyCoordCoverage {
  return {
    county_code: 19,
    county_name: "Los Angeles",
    total_crashes: 100,
    crashes_with_coords: 37,
    coords_pct: 37,
    ...partial,
  };
}

describe("schoolCrashColor", () => {
  it("greys out schools the API returned no row for", () => {
    // Not the bottom of the ramp: missing data is not a low score.
    expect(schoolCrashColor(undefined, [0, 1, 2, 3, 4])).toBe(SCHOOL_NO_DATA_COLOR);
  });

  it("greys out an explicit zero the same way", () => {
    expect(schoolCrashColor(0, [0, 1, 2, 3, 4])).toBe(SCHOOL_NO_DATA_COLOR);
  });

  it("walks the ramp low to high", () => {
    const edges = schoolRampEdges(counts(1, 2, 3, 4, 5, 6, 7, 8));
    expect(edges).not.toBeNull();
    expect(schoolCrashColor(1, edges)).toBe(SCHOOL_CRASH_COLORS[0]);
    expect(schoolCrashColor(8, edges)).toBe(SCHOOL_CRASH_COLORS[3]);
  });

  it("never returns the low color for the highest school", () => {
    const values = [1, 1, 1, 2, 3, 40];
    const edges = schoolRampEdges(counts(...values));
    const top = schoolCrashColor(40, edges);
    expect(top).toBe(SCHOOL_CRASH_COLORS[SCHOOL_CRASH_COLORS.length - 1]);
  });

  it("falls back to the top color when there is nothing to rank against", () => {
    // Fewer than MIN_BUCKET_SUBSET values -> no edges. A school with crashes
    // still has to read as "crashes here", not as the safe end of a scale.
    const edges = schoolRampEdges(counts(4));
    expect(edges).toBeNull();
    expect(schoolCrashColor(4, edges)).toBe(SCHOOL_CRASH_COLORS[3]);
    expect(schoolCrashColor(0, edges)).toBe(SCHOOL_NO_DATA_COLOR);
  });
});

describe("coverageCaveat", () => {
  it("names the county and its coverage", () => {
    expect(coverageCaveat(coverage({ coords_pct: 37.4 }))).toBe(
      "37% of crashes in Los Angeles have map coordinates; " +
        "schools in low-coverage counties look safer than they are.",
    );
  });

  it("rounds rather than printing a decimal", () => {
    expect(coverageCaveat(coverage({ coords_pct: 95.6 }))).toContain("96% of crashes");
  });

  it("says nothing when the county is unknown", () => {
    expect(coverageCaveat(undefined)).toBeNull();
    expect(coverageCaveat(coverage({ county_name: null }))).toBeNull();
  });
});

describe("yearsLabel", () => {
  it("reads as all years when nothing is filtered", () => {
    expect(yearsLabel([])).toBe("all years");
  });

  it("prints a single year plainly", () => {
    expect(yearsLabel([2023])).toBe("2023");
  });

  it("prints a range for several years, in order", () => {
    expect(yearsLabel([2023, 2019, 2021])).toBe("2019–2023");
  });
});
