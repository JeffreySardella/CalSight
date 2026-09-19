import { describe, it, expect } from "vitest";
import { MIN_CRASHES_FOR_RATE } from "./choropleth/measures";
import {
  buildMetrics,
  changePct,
  factorLabel,
  formatChange,
  formatCount,
  formatValue,
  latestCompleteYear,
  ordinal,
  rankOf,
  rate,
  type AreaInputs,
} from "./countyReport";

const CURRENT_YEAR = new Date().getFullYear();

describe("latestCompleteYear", () => {
  it("skips the in-progress calendar year", () => {
    expect(latestCompleteYear([CURRENT_YEAR - 2, CURRENT_YEAR - 1, CURRENT_YEAR])).toBe(
      CURRENT_YEAR - 1,
    );
  });

  it("returns null when only the partial year is on record", () => {
    expect(latestCompleteYear([CURRENT_YEAR])).toBeNull();
    expect(latestCompleteYear([])).toBeNull();
  });
});

describe("changePct", () => {
  it("reports the move from then to now", () => {
    expect(changePct(200, 150)).toBeCloseTo(-25);
    expect(changePct(100, 125)).toBeCloseTo(25);
  });

  it("refuses to divide by a zero baseline or a missing side", () => {
    expect(changePct(0, 10)).toBeNull();
    expect(changePct(null, 10)).toBeNull();
    expect(changePct(10, null)).toBeNull();
  });
});

describe("formatting", () => {
  it("groups counts and rounds rates to the asked-for precision", () => {
    expect(formatCount(1234567)).toBe("1,234,567");
    expect(formatCount(null)).toBe("—");
    expect(formatValue(12.345, 1)).toBe("12.3");
    expect(formatValue(null, 1)).toBe("—");
  });

  it("signs changes with a real minus sign and names a flat one", () => {
    expect(formatChange(12.34)).toBe("+12.3%");
    expect(formatChange(-4.06)).toBe("−4.1%");
    expect(formatChange(0.01)).toBe("no change");
    expect(formatChange(null)).toBe("—");
  });

  it("ordinals the teens correctly", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 58].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "58th",
    ]);
  });

  it("labels API cause slugs from the shared filter list", () => {
    expect(factorLabel("following_too_close")).toBe("Tailgating");
    expect(factorLabel("dui")).toBe("DUI");
    // Not a filter bucket — falls back to a readable form rather than a blank.
    expect(factorLabel("uncategorized")).toBe("Uncategorized");
  });
});

describe("rate — the small-county rule", () => {
  it("computes the rate once the count clears the shared floor", () => {
    const r = rate(1_000, 20, 1_000, 1_000);
    expect(r).toEqual({ value: 20, tooSmall: false });
  });

  it("suppresses the rate below the floor and says why", () => {
    const r = rate(MIN_CRASHES_FOR_RATE - 1, 1, 4, 1_000);
    expect(r.value).toBeNull();
    expect(r.tooSmall).toBe(true);
  });

  it("separates a missing denominator from a too-small count", () => {
    expect(rate(1_000, 1_000, null, 10_000)).toEqual({ value: null, tooSmall: false });
    expect(rate(1_000, 1_000, 0, 10_000)).toEqual({ value: null, tooSmall: false });
  });
});

describe("rankOf", () => {
  const values = [
    { code: 1, value: 5 },
    { code: 2, value: 20 },
    { code: 3, value: null },
    { code: 4, value: 12 },
  ];

  it("ranks highest first and counts only the ranked counties", () => {
    expect(rankOf(values, 2)).toEqual({ rank: 1, of: 3 });
    expect(rankOf(values, 4)).toEqual({ rank: 2, of: 3 });
    expect(rankOf(values, 1)).toEqual({ rank: 3, of: 3 });
  });

  it("returns null for a county with no figure", () => {
    expect(rankOf(values, 3)).toBeNull();
    expect(rankOf(values, 99)).toBeNull();
  });
});

const county: AreaInputs = {
  now: { crashes: 1_000, killed: 20, injured: 600 },
  then: { crashes: 800, killed: 16, injured: 500 },
  drivers: 500_000,
  priorDrivers: 400_000,
  roadMiles: 2_000,
};

const statewide: AreaInputs = {
  now: { crashes: 400_000, killed: 4_000, injured: 250_000 },
  then: { crashes: 380_000, killed: 3_800, injured: 240_000 },
  drivers: 27_000_000,
  priorDrivers: 26_000_000,
  roadMiles: 400_000,
};

describe("buildMetrics", () => {
  it("returns the six headline measures in report order", () => {
    expect(buildMetrics({ county, statewide }).map((m) => m.key)).toEqual([
      "crashes",
      "deaths",
      "injuries",
      "deaths_per_1k",
      "per_10k_drivers",
      "per_100_miles",
    ]);
  });

  it("puts the county beside the statewide figure with a five-year change", () => {
    const m = buildMetrics({ county, statewide });
    const crashes = m.find((r) => r.key === "crashes")!;
    expect(crashes.county).toBe(1_000);
    expect(crashes.statewide).toBe(400_000);
    expect(crashes.changePct).toBeCloseTo(25);

    const deaths = m.find((r) => r.key === "deaths_per_1k")!;
    expect(deaths.county).toBeCloseTo(20);
    expect(deaths.statewide).toBeCloseTo(10);
    // 16/800 and 20/1000 are the same rate — no change across the five years.
    expect(deaths.changePct).toBeCloseTo(0);

    const perDriver = m.find((r) => r.key === "per_10k_drivers")!;
    expect(perDriver.county).toBeCloseTo(20);
    const perMile = m.find((r) => r.key === "per_100_miles")!;
    expect(perMile.county).toBeCloseTo(50);
  });

  it("flags only the rate rows when the county is too small, keeping the counts", () => {
    const tiny: AreaInputs = {
      ...county,
      now: { crashes: MIN_CRASHES_FOR_RATE - 1, killed: 1, injured: 2 },
    };
    const m = buildMetrics({ county: tiny, statewide });

    expect(m.find((r) => r.key === "crashes")!.county).toBe(MIN_CRASHES_FOR_RATE - 1);
    expect(m.find((r) => r.key === "deaths")!.county).toBe(1);
    expect(m.find((r) => r.key === "injuries")!.county).toBe(2);
    expect(m.filter((r) => r.countyTooSmall).map((r) => r.key)).toEqual([
      "deaths_per_1k",
      "per_10k_drivers",
      "per_100_miles",
    ]);
    // Suppressed county value, but the statewide column still has context.
    expect(m.find((r) => r.key === "deaths_per_1k")!.county).toBeNull();
    expect(m.find((r) => r.key === "deaths_per_1k")!.statewide).toBeCloseTo(10);
  });

  it("leaves a rate blank without flagging it small when the denominator is missing", () => {
    const noDmv: AreaInputs = { ...county, drivers: null, priorDrivers: null };
    const row = buildMetrics({ county: noDmv, statewide }).find((r) => r.key === "per_10k_drivers")!;
    expect(row.county).toBeNull();
    expect(row.countyTooSmall).toBe(false);
    expect(row.changePct).toBeNull();
  });
});
