import { describe, it, expect } from "vitest";
import { computeMeasureValue, MEASURES, MIN_CRASHES_FOR_RATE, type MeasureKey } from "./measures";
import { bucketFor } from "./binning";

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

  it("MEASURES exposes 21 measures including default", () => {
    const keys: MeasureKey[] = Object.keys(MEASURES) as MeasureKey[];
    expect(keys).toHaveLength(21);
    expect(keys).toContain("crashes_per_100k");
    expect(keys).toContain("crashes_per_income");
    expect(keys).toContain("coord_coverage");
  });
});

// --- coord_coverage --------------------------------------------------------
//
// Share of a county's crashes that carry coordinates, so the gap behind every
// point layer is visible. Its numbers come from the pre-computed data-quality
// stats (opts.coordCoverage), not from the filtered crash stats, so the
// numerator/denominator deliberately ignore `stats`.
describe("coord_coverage", () => {
  const anyStats = { ...tenCrashes, crash_count: 0 };

  it("is the located share of the data-quality total, as a percentage", () => {
    const r = computeMeasureValue("coord_coverage", anyStats, [], {
      coordCoverage: { withCoords: 3_000, total: 8_000 },
    });
    expect(r.hasEnoughData).toBe(true);
    expect(r.value).toBeCloseTo(37.5, 10);
  });

  it("reaches the full range", () => {
    const none = computeMeasureValue("coord_coverage", anyStats, [], {
      coordCoverage: { withCoords: 0, total: 500 },
    });
    const all = computeMeasureValue("coord_coverage", anyStats, [], {
      coordCoverage: { withCoords: 500, total: 500 },
    });
    expect(none.value).toBe(0);
    expect(all.value).toBe(100);
  });

  it("returns no-data without coverage rows, or below the crash floor", () => {
    expect(computeMeasureValue("coord_coverage", anyStats, [], {}).hasEnoughData).toBe(false);
    expect(
      computeMeasureValue("coord_coverage", anyStats, [], {
        coordCoverage: { withCoords: 1, total: MIN_CRASHES_FOR_RATE - 1 },
      }).hasEnoughData,
    ).toBe(false);
  });

  it("formats as a whole percentage", () => {
    expect(MEASURES.coord_coverage.formatLabel(37.5)).toBe("38%");
    expect(MEASURES.coord_coverage.formatLabel(0)).toBe("0%");
    expect(MEASURES.coord_coverage.formatLabel(100)).toBe("100%");
  });

  it("bands the full 0-100% domain on absolute edges", () => {
    const edges = MEASURES.coord_coverage.fixedEdges;
    expect(edges).toEqual([0, 20, 40, 60, 80, 100]);

    // The observed statewide spread (~16% to ~62% per county all-time) has to
    // land in different bands, and the ends have to clamp rather than throw.
    const e = [...edges!];
    expect(bucketFor(16, e)).toBe(0);
    expect(bucketFor(30, e)).toBe(1);
    expect(bucketFor(62, e)).toBe(3);
    expect(bucketFor(0, e)).toBe(0);
    expect(bucketFor(100, e)).toBe(4);
  });
});

// --- Regression: D-1 (per-capita rate ~18x too low under a year filter) -----
//
// The choropleth calls computeMeasureValue WITHOUT perYearCrashes, so
// crashes_per_100k takes the fallback branch: crash_count / summed-population.
// That branch is only correct when the demographics list is scoped to the
// same year window as the crash count. Before the fix, /api/demographics
// ignored the date filter and returned every seeded population-year, so the
// fallback divided a single-year crash count by ~18 years of population —
// yielding a rate ~1/18 of the true annual value.
describe("crashes_per_100k annual-average denominator (regression: D-1)", () => {
  // Los-Angeles-ish scale: ~10M residents, ~40k crashes in a single year.
  const laStats = {
    county_code: 19,
    county_name: "Los Angeles",
    crash_count: 40_000,
    total_killed: 300,
    total_injured: 20_000,
  };
  const POP_PER_YEAR = 10_000_000;
  const ANNUAL_RATE = 400; // 40,000 / (10,000,000 / 100,000)

  it("single-year selection yields an annual-order rate (~400/100k)", () => {
    // Post-fix: backend filters demographics to the selected year → one row.
    const oneYear = [{ county_code: 19, year: 2023, population: POP_PER_YEAR }];
    const r = computeMeasureValue("crashes_per_100k", laStats, oneYear);
    expect(r.hasEnoughData).toBe(true);
    expect(r.value).toBeCloseTo(ANNUAL_RATE, 5);
  });

  it("pins the ~18x understatement the bug caused vs. the fixed value", () => {
    // Pre-fix data flow: 18 population-years for a single-year crash count.
    const eighteenYears = Array.from({ length: 18 }, (_, i) => ({
      county_code: 19,
      year: 2006 + i,
      population: POP_PER_YEAR,
    }));
    const buggy = computeMeasureValue("crashes_per_100k", laStats, eighteenYears);
    // 40,000 / (180,000,000 / 100,000) = 40,000 / 1800 ≈ 22.2 per 100k.
    expect(buggy.value).toBeCloseTo(ANNUAL_RATE / 18, 4);

    // Fixed data flow (demographics scoped to the selected year) is ~18x higher.
    const oneYear = [{ county_code: 19, year: 2023, population: POP_PER_YEAR }];
    const fixed = computeMeasureValue("crashes_per_100k", laStats, oneYear);
    expect(fixed.value! / buggy.value!).toBeCloseTo(18, 5);
  });

  it("stays a stable annual-average as the selected range widens", () => {
    // 3-year window: 3-year crash total over 3 population-years → same rate.
    const threeYearStats = { ...laStats, crash_count: 40_000 * 3 };
    const threeYears = [2021, 2022, 2023].map((year) => ({
      county_code: 19,
      year,
      population: POP_PER_YEAR,
    }));
    const r = computeMeasureValue("crashes_per_100k", threeYearStats, threeYears);
    expect(r.value).toBeCloseTo(ANNUAL_RATE, 5);
  });
});
