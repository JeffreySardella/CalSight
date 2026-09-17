import { describe, it, expect } from "vitest";
import { excludePartialYear, isPartialYear, partialYearNote } from "./partialYear";

const CURRENT = new Date().getFullYear();

describe("isPartialYear", () => {
  it("is true for the current calendar year (number and string)", () => {
    expect(isPartialYear(CURRENT)).toBe(true);
    expect(isPartialYear(String(CURRENT))).toBe(true);
  });

  it("is false for past and future years", () => {
    expect(isPartialYear(CURRENT - 1)).toBe(false);
    expect(isPartialYear(CURRENT + 1)).toBe(false);
    expect(isPartialYear("2019")).toBe(false);
  });

  it("is false for non-year labels", () => {
    expect(isPartialYear("Monday")).toBe(false);
    expect(isPartialYear("")).toBe(false);
  });
});

describe("partialYearNote", () => {
  it("returns the shared note when the current year is among the labels", () => {
    expect(partialYearNote(["2019", String(CURRENT)])).toBe(
      `${CURRENT} is partial-year data`,
    );
    expect(partialYearNote([CURRENT - 2, CURRENT - 1, CURRENT])).toBe(
      `${CURRENT} is partial-year data`,
    );
  });

  it("returns null when only complete years are present", () => {
    expect(partialYearNote(["2018", "2019", "2020"])).toBeNull();
    expect(partialYearNote([])).toBeNull();
  });
});

describe("excludePartialYear", () => {
  it("drops the in-progress year and keeps the rest in order", () => {
    const rows = [{ year: CURRENT - 2 }, { year: CURRENT - 1 }, { year: CURRENT }];
    expect(excludePartialYear(rows)).toEqual([{ year: CURRENT - 2 }, { year: CURRENT - 1 }]);
  });

  it("leaves a series without the current year untouched", () => {
    const rows = [{ year: CURRENT - 3 }, { year: CURRENT - 2 }];
    expect(excludePartialYear(rows)).toEqual(rows);
  });

  it("returns empty when only the current year is present", () => {
    expect(excludePartialYear([{ year: CURRENT }])).toEqual([]);
  });
});
