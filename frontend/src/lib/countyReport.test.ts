import { describe, it, expect } from "vitest";
import { MIN_CRASHES_FOR_RATE } from "./choropleth/measures";
import {
  buildMetrics,
  changePct,
  deathRate,
  factorLabel,
  formatChange,
  formatCount,
  formatValue,
  latestCompleteYear,
  ordinal,
  pooledDeathRate,
  rankOf,
  rate,
  MIN_CRASHES_FOR_CRASH_RATE,
  MIN_DEATHS_FOR_DEATH_RATE,
  POOLED_YEARS,
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
  const gate = (count: number) => ({ count, min: 10, kind: "deaths" as const });

  it("computes the rate once the gating count clears its floor", () => {
    expect(rate(gate(20), 20, 1_000, 1_000)).toEqual({ value: 20, suppressedBy: null });
  });

  it("withholds the rate below the floor and names the count that was short", () => {
    const r = rate(gate(9), 9, 1_000, 1_000);
    expect(r.value).toBeNull();
    expect(r.suppressedBy).toBe("deaths");
  });

  it("separates a missing denominator from a too-small count", () => {
    expect(rate(gate(20), 20, null, 10_000)).toEqual({ value: null, suppressedBy: null });
    expect(rate(gate(20), 20, 0, 10_000)).toEqual({ value: null, suppressedBy: null });
  });

  it("sits above the map's floor, which it deliberately does not reuse", () => {
    expect(MIN_DEATHS_FOR_DEATH_RATE).toBe(10);
    expect(MIN_CRASHES_FOR_CRASH_RATE).toBe(50);
    expect(MIN_CRASHES_FOR_CRASH_RATE).toBeGreaterThan(MIN_CRASHES_FOR_RATE);
  });
});

describe("deathRate — gated on deaths, not on crashes", () => {
  it("withholds Alpine's 2 deaths in 68 crashes", () => {
    // 29.4 per 1,000 off two deaths: one more would read 44.1, one fewer 14.7.
    expect(deathRate({ crashes: 68, killed: 2, injured: 44 })).toEqual({
      value: null,
      suppressedBy: "deaths",
    });
  });

  it("publishes Los Angeles' 714 deaths in 104,391 crashes", () => {
    const r = deathRate({ crashes: 104_391, killed: 714, injured: 58_185 });
    expect(r.suppressedBy).toBeNull();
    expect(r.value).toBeCloseTo(6.8, 1);
  });

  it("publishes exactly at the threshold, not one death above it", () => {
    expect(deathRate({ crashes: 1_000, killed: MIN_DEATHS_FOR_DEATH_RATE, injured: 0 }).value)
      .toBeCloseTo(10);
    expect(deathRate({ crashes: 1_000, killed: MIN_DEATHS_FOR_DEATH_RATE - 1, injured: 0 }).value)
      .toBeNull();
  });
});

describe("pooledDeathRate", () => {
  const alpineYears = [
    { year: 2021, crashes: 70, killed: 0 },
    { year: 2022, crashes: 66, killed: 2 },
    { year: 2023, crashes: 66, killed: 0 },
    { year: 2024, crashes: 71, killed: 1 },
    { year: 2025, crashes: 68, killed: 2 },
  ];

  it("takes only the last five complete years, in order", () => {
    const withOlder = [{ year: 2016, crashes: 101, killed: 5 }, ...alpineYears];
    const p = pooledDeathRate(withOlder)!;
    expect(p.fromYear).toBe(2021);
    expect(p.toYear).toBe(2025);
    expect(p.crashes).toBe(341);
    expect(POOLED_YEARS).toBe(5);
  });

  it("still withholds when even five years of deaths fall short", () => {
    // 5 deaths across 2021-2025 — an Alpine-sized county stays under the bar.
    const p = pooledDeathRate(alpineYears)!;
    expect(p.deaths).toBe(5);
    expect(p.value).toBeNull();
  });

  it("publishes once the pooled deaths reach the threshold", () => {
    const p = pooledDeathRate([
      ...alpineYears.slice(0, 4),
      { year: 2025, crashes: 68, killed: 9 },
    ])!;
    expect(p.deaths).toBe(12);
    // Summed first, divided once: 12 / 341 × 1,000.
    expect(p.value).toBeCloseTo((12 / 341) * 1_000, 6);
  });

  it("sums rather than averaging the annual rates", () => {
    // A year with one crash and one death would drag an average of rates to
    // ~200; pooling keeps it at 2 / 101 × 1,000.
    const p = pooledDeathRate([
      { year: 2024, crashes: 100, killed: 10 },
      { year: 2025, crashes: 1, killed: 1 },
    ])!;
    expect(p.value).toBeCloseTo((11 / 101) * 1_000, 6);
  });

  it("returns null with no years at all", () => {
    expect(pooledDeathRate([])).toBeNull();
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

/** Alpine in 2025 against 2020, with its real DMV and Caltrans denominators. */
const alpine: AreaInputs = {
  now: { crashes: 68, killed: 2, injured: 44 },
  then: { crashes: 71, killed: 4, injured: 46 },
  drivers: 1_237,
  priorDrivers: 1_100,
  roadMiles: 669,
};

/** Los Angeles in 2025 against 2020. */
const losAngeles: AreaInputs = {
  now: { crashes: 104_391, killed: 714, injured: 58_185 },
  then: { crashes: 112_126, killed: 780, injured: 64_000 },
  drivers: 6_744_000,
  priorDrivers: 6_500_000,
  roadMiles: 38_150,
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

  it("withholds Alpine's death rate on deaths while keeping its exposure rates", () => {
    const m = buildMetrics({ county: alpine, statewide });
    const by = (k: string) => m.find((r) => r.key === k)!;

    // Every count still prints, exactly as reported.
    expect(by("crashes").county).toBe(68);
    expect(by("deaths").county).toBe(2);
    expect(by("injuries").county).toBe(44);

    // 2 deaths is under 10, so the death rate and its change go.
    expect(by("deaths_per_1k").suppressedBy).toBe("deaths");
    expect(by("deaths_per_1k").county).toBeNull();
    expect(by("deaths_per_1k").changePct).toBeNull();

    // 68 crashes clears 50, so the exposure rates survive.
    expect(by("per_10k_drivers").suppressedBy).toBeNull();
    expect(by("per_10k_drivers").county).toBeCloseTo((68 / 1_237) * 10_000, 6);
    expect(by("per_100_miles").suppressedBy).toBeNull();
    expect(by("per_100_miles").county).toBeCloseTo((68 / 669) * 100, 6);

    // The statewide column is untouched by a county-level threshold.
    expect(by("deaths_per_1k").statewide).toBeCloseTo(10);
    expect(by("per_10k_drivers").statewide).toBeCloseTo((400_000 / 27_000_000) * 10_000, 6);
  });

  it("withholds the exposure rates on crashes, independently of deaths", () => {
    // 40 crashes is under 50; 12 deaths clears 10. Only the exposure rates go.
    const thin: AreaInputs = { ...alpine, now: { crashes: 40, killed: 12, injured: 20 } };
    const m = buildMetrics({ county: thin, statewide });
    const by = (k: string) => m.find((r) => r.key === k)!;

    expect(by("crashes").county).toBe(40);
    expect(by("deaths_per_1k").suppressedBy).toBeNull();
    expect(by("deaths_per_1k").county).toBeCloseTo(300);
    expect(m.filter((r) => r.suppressedBy === "crashes").map((r) => r.key)).toEqual([
      "per_10k_drivers",
      "per_100_miles",
    ]);
  });

  it("publishes every rate for a county the size of Los Angeles", () => {
    const m = buildMetrics({ county: losAngeles, statewide });
    expect(m.every((r) => r.suppressedBy === null)).toBe(true);
    expect(m.find((r) => r.key === "deaths_per_1k")!.county).toBeCloseTo(6.8, 1);
    expect(m.find((r) => r.key === "per_100_miles")!.county).toBeCloseTo(
      (104_391 / 38_150) * 100,
      6,
    );
  });

  it("leaves a rate blank without blaming the county when the denominator is missing", () => {
    const noDmv: AreaInputs = { ...county, drivers: null, priorDrivers: null };
    const row = buildMetrics({ county: noDmv, statewide }).find((r) => r.key === "per_10k_drivers")!;
    expect(row.county).toBeNull();
    expect(row.suppressedBy).toBeNull();
    expect(row.changePct).toBeNull();
  });
});
