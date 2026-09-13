import { describe, it, expect } from "vitest";
import { baselineFootnote, commonBaseline } from "./useWaterData";

describe("commonBaseline", () => {
  it("returns the most common non-null period", () => {
    expect(commonBaseline(["1991-2020", null, "2012-2026", "1991-2020"])).toBe("1991-2020");
  });

  it("returns null when nothing reports a period", () => {
    expect(commonBaseline([null, undefined])).toBeNull();
  });
});

describe("baselineFootnote", () => {
  it("is just the common note when every station shares one period", () => {
    expect(baselineFootnote(["1991-2020", "1991-2020", null])).toBe(
      "the 1991–2020 mean for this calendar day (DWR’s climatological normal)",
    );
  });

  it("appends how many stations use a shorter record when periods differ", () => {
    expect(baselineFootnote(["1991-2020", "1991-2020", "2012-2026"])).toMatch(
      /^the 1991–2020 mean .*; 1 station uses its shorter full record$/,
    );
    expect(baselineFootnote(["1991-2020", "2012-2026", "2013-2026"])).toMatch(
      /; 2 stations use their shorter full record$/,
    );
  });

  it("keeps the all-years wording when no period is reported", () => {
    expect(baselineFootnote([null])).toBe(
      "the mean for this calendar day across all loaded years",
    );
  });
});
