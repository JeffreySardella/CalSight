import { describe, it, expect } from "vitest";
import { CORRELATION_FIELDS, applyFarsAggregation, type CountyRow } from "./useCorrelationData";

describe("FARS correlation fields registration", () => {
  it("registers fars_fatalities and pct_unrestrained with source='fars'", () => {
    const keys = CORRELATION_FIELDS.map((f) => f.key);
    expect(keys).toContain("fars_fatalities");
    expect(keys).toContain("pct_unrestrained");
    const farsFatalities = CORRELATION_FIELDS.find((f) => f.key === "fars_fatalities");
    expect(farsFatalities?.source).toBe("fars");
    const pctUnrestrained = CORRELATION_FIELDS.find((f) => f.key === "pct_unrestrained");
    expect(pctUnrestrained?.source).toBe("fars");
  });
});

describe("applyFarsAggregation", () => {
  function makeByCounty(code: string): Record<string, CountyRow> {
    return { [code]: { crash_count: 50 } };
  }

  it("picks the most-recent year when two rows share the same county_code", () => {
    const byCounty = makeByCounty("19");
    applyFarsAggregation(
      [
        { county_code: 19, year: 2021, fatalities: 90, unrestrained_killed: 10, restraint_known_killed: 50 },
        { county_code: 19, year: 2022, fatalities: 100, unrestrained_killed: 20, restraint_known_killed: 80 },
      ],
      byCounty,
    );
    expect(byCounty["19"].fars_fatalities).toBe(100);
  });

  it("computes pct_unrestrained correctly when restraint_known_killed > 0", () => {
    const byCounty = makeByCounty("19");
    applyFarsAggregation(
      [{ county_code: 19, year: 2022, fatalities: 100, unrestrained_killed: 20, restraint_known_killed: 80 }],
      byCounty,
    );
    expect(byCounty["19"].pct_unrestrained).toBeCloseTo((20 / 80) * 100);
  });

  it("leaves pct_unrestrained undefined when restraint_known_killed === 0", () => {
    const byCounty = makeByCounty("19");
    applyFarsAggregation(
      [{ county_code: 19, year: 2022, fatalities: 100, unrestrained_killed: 0, restraint_known_killed: 0 }],
      byCounty,
    );
    expect(byCounty["19"].pct_unrestrained).toBeUndefined();
  });

  it("skips a county not present in byCounty without throwing", () => {
    const byCounty = makeByCounty("19");
    expect(() =>
      applyFarsAggregation(
        [{ county_code: 99, year: 2022, fatalities: 50, unrestrained_killed: 5, restraint_known_killed: 20 }],
        byCounty,
      ),
    ).not.toThrow();
    // county 99 was not in byCounty, so county 19 is untouched
    expect(byCounty["19"].fars_fatalities).toBeUndefined();
  });
});
