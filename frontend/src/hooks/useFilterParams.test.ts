import { describe, it, expect } from "vitest";
import {
  parseBoolFlag,
  parseSeverities,
  parseCauses,
  parseYearMonth,
  formatYearMonth,
  yearsInRange,
  SEVERITIES,
  CAUSES,
  INVOLVEMENTS,
} from "./useFilterParams";

describe("parseBoolFlag", () => {
  it('returns true for "true"', () => {
    expect(parseBoolFlag("true")).toBe(true);
  });

  it("returns false for null", () => {
    expect(parseBoolFlag(null)).toBe(false);
  });

  it('returns false for "false"', () => {
    expect(parseBoolFlag("false")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(parseBoolFlag("")).toBe(false);
  });

  it("returns false for arbitrary string", () => {
    expect(parseBoolFlag("yes")).toBe(false);
  });
});

describe("SEVERITIES", () => {
  it("has exactly the 3 DB-truthful values", () => {
    expect([...SEVERITIES]).toEqual(["Fatal", "Injury", "Property Damage Only"]);
  });
});

describe("CAUSES", () => {
  it("has exactly the 10 DB-truthful values", () => {
    expect(CAUSES.map((c) => c.value)).toEqual([
      "dui", "speeding", "lane-change", "right-of-way", "turning",
      "following-too-close", "signal-violation", "pedestrian-violation",
      "unsafe-backing", "other",
    ]);
  });

  it("does not include distracted or weather", () => {
    const values = CAUSES.map((c) => c.value);
    expect(values).not.toContain("distracted");
    expect(values).not.toContain("weather");
  });
});

describe("INVOLVEMENTS", () => {
  it("has all involvement types", () => {
    expect(INVOLVEMENTS.map((i) => i.value)).toEqual(["alcohol", "distracted", "pedestrian", "cyclist", "drug"]);
  });
});

describe("parseSeverities", () => {
  it("accepts slugified DB-truthful values", () => {
    const result = parseSeverities("fatal,injury");
    expect(result).toEqual(new Set(["Fatal", "Injury"]));
  });

  it("rejects stale FE-only values", () => {
    const result = parseSeverities("severe-injury");
    expect(result.size).toBe(0);
  });
});

describe("parseCauses", () => {
  it("accepts DB-truthful values", () => {
    const result = parseCauses("dui,lane-change");
    expect(result).toEqual(new Set(["dui", "lane-change"]));
  });

  it("rejects removed causes", () => {
    const result = parseCauses("distracted,weather");
    expect(result.size).toBe(0);
  });
});

describe("parseYearMonth", () => {
  it("parses YYYY-MM into a YearMonth", () => {
    expect(parseYearMonth("2023-07")).toEqual({ year: 2023, month: 7 });
  });

  it("returns null for malformed input", () => {
    expect(parseYearMonth("2023")).toBeNull();
    expect(parseYearMonth("2023/07")).toBeNull();
    expect(parseYearMonth("")).toBeNull();
    expect(parseYearMonth(null)).toBeNull();
  });

  it("rejects out-of-range months", () => {
    expect(parseYearMonth("2023-00")).toBeNull();
    expect(parseYearMonth("2023-13")).toBeNull();
  });

  it("rejects out-of-range years", () => {
    expect(parseYearMonth("1990-06")).toBeNull();
  });
});

describe("formatYearMonth", () => {
  it("zero-pads single-digit months", () => {
    expect(formatYearMonth({ year: 2023, month: 3 })).toBe("2023-03");
  });

  it("preserves double-digit months", () => {
    expect(formatYearMonth({ year: 2023, month: 12 })).toBe("2023-12");
  });
});

describe("yearsInRange", () => {
  it("returns an empty set for null", () => {
    expect(yearsInRange(null).size).toBe(0);
  });

  it("expands an inclusive range to whole years", () => {
    const range = {
      start: { year: 2020, month: 3 },
      end: { year: 2022, month: 8 },
    };
    expect(yearsInRange(range)).toEqual(new Set([2020, 2021, 2022]));
  });

  it("supports an open-ended start (defaults to first available year)", () => {
    const range = { start: null, end: { year: 2002, month: 6 } };
    const out = yearsInRange(range);
    expect(out.has(2001)).toBe(true);
    expect(out.has(2002)).toBe(true);
    expect(out.has(2003)).toBe(false);
  });
});
