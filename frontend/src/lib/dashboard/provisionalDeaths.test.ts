import { describe, it, expect } from "vitest";
import {
  isDeathMeasure,
  isProvisionalDeathYear,
  latestSettledDeathYear,
  provisionalDeathNote,
} from "./provisionalDeaths";

// The audit date: 2025 deaths were still filling in.
const SEPT_2026 = new Date(2026, 8, 22);

describe("isProvisionalDeathYear", () => {
  it("treats the current and previous year as provisional", () => {
    expect(isProvisionalDeathYear(2026, SEPT_2026)).toBe(true);
    expect(isProvisionalDeathYear(2025, SEPT_2026)).toBe(true);
    expect(isProvisionalDeathYear("2025", SEPT_2026)).toBe(true);
    expect(isProvisionalDeathYear(2024, SEPT_2026)).toBe(false);
  });

  it("settles a year 12 months after it ends", () => {
    expect(isProvisionalDeathYear(2025, new Date(2026, 11, 31))).toBe(true);
    expect(isProvisionalDeathYear(2025, new Date(2027, 0, 1))).toBe(false);
  });

  it("is false for non-year labels", () => {
    expect(isProvisionalDeathYear("Monday", SEPT_2026)).toBe(false);
  });
});

describe("latestSettledDeathYear", () => {
  it("ages with the date", () => {
    expect(latestSettledDeathYear(SEPT_2026)).toBe(2024);
    expect(latestSettledDeathYear(new Date(2027, 0, 1))).toBe(2025);
  });
});

describe("isDeathMeasure", () => {
  it("covers the death-based measures only", () => {
    expect(["killed", "ksi", "fatality_rate"].every((m) => isDeathMeasure(m))).toBe(true);
    expect(isDeathMeasure("count")).toBe(false);
    expect(isDeathMeasure("injured")).toBe(false);
    expect(isDeathMeasure(undefined)).toBe(false);
  });
});

describe("provisionalDeathNote", () => {
  it("names the provisional years", () => {
    expect(provisionalDeathNote(["2023", "2024", "2025"], SEPT_2026)).toMatch(/^Deaths for 2025 are preliminary/);
    expect(provisionalDeathNote([2024, 2025, 2026], SEPT_2026)).toMatch(/^Deaths for 2025–2026 are preliminary/);
  });

  it("is null when every year is settled", () => {
    expect(provisionalDeathNote(["2022", "2024"], SEPT_2026)).toBeNull();
    expect(provisionalDeathNote([], SEPT_2026)).toBeNull();
  });
});
