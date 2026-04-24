import { describe, it, expect } from "vitest";
import {
  parseBoolFlag,
  parseSeverities,
  parseCauses,
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
  it("has exactly the 4 DB-truthful values", () => {
    expect(CAUSES.map((c) => c.value)).toEqual(["dui", "speeding", "lane-change", "other"]);
  });

  it("does not include distracted or weather", () => {
    const values = CAUSES.map((c) => c.value);
    expect(values).not.toContain("distracted");
    expect(values).not.toContain("weather");
  });
});

describe("INVOLVEMENTS", () => {
  it("has alcohol and distracted", () => {
    expect(INVOLVEMENTS.map((i) => i.value)).toEqual(["alcohol", "distracted"]);
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
