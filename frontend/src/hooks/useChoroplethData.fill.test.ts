import { describe, it, expect } from "vitest";
import { allCountiesNoData, fillDemographicYears } from "./useChoroplethData";

const row = (year: number, population: number | null = 1_000) => ({ county_code: 19, year, population });

describe("fillDemographicYears", () => {
  it("keeps selected years that have census rows and drops the rest", () => {
    const { rows, estimated } = fillDemographicYears([row(2021), row(2022), row(2023)], new Set([2022, 2023]));
    expect(rows.map((r) => r.year)).toEqual([2022, 2023]);
    expect(estimated.size).toBe(0);
  });

  it("fills years past the latest census from the latest year", () => {
    const { rows, estimated } = fillDemographicYears([row(2023, 500)], new Set([2023, 2024, 2025]));
    expect(rows.map((r) => [r.year, r.population])).toEqual([[2023, 500], [2024, 500], [2025, 500]]);
    expect([...estimated]).toEqual([[2024, 2023], [2025, 2023]]);
  });

  it("fills years before the first census from the earliest year", () => {
    const { estimated } = fillDemographicYears([row(2005), row(2006)], new Set([2001]));
    expect([...estimated]).toEqual([[2001, 2005]]);
  });

  it("prefers the later year on a tie", () => {
    const { estimated } = fillDemographicYears([row(2019), row(2023)], new Set([2021]));
    expect([...estimated]).toEqual([[2021, 2023]]);
  });

  it("ignores rows without population when picking a source year", () => {
    const { estimated } = fillDemographicYears([row(2022), row(2023, null)], new Set([2024]));
    expect([...estimated]).toEqual([[2024, 2022]]);
  });

  it("returns rows untouched with no years or no census data", () => {
    const rows = [row(2023)];
    expect(fillDemographicYears(rows, new Set()).rows).toBe(rows);
    expect(fillDemographicYears([], new Set([2024])).estimated.size).toBe(0);
  });
});

describe("allCountiesNoData", () => {
  it("is true only when every county lacks a value", () => {
    expect(allCountiesNoData({ 1: { value: null, hasEnoughData: false }, 2: { value: null, hasEnoughData: false } })).toBe(true);
    expect(allCountiesNoData({ 1: { value: null, hasEnoughData: false }, 2: { value: 3, hasEnoughData: true } })).toBe(false);
  });

  it("is false for an empty map so loading states never trigger it", () => {
    expect(allCountiesNoData({})).toBe(false);
  });
});
