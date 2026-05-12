import { describe, it, expect } from "vitest";
import { computeFilterScope } from "./filterSummary";

const empty = {
  dateRange: null,
  severities: new Set<string>(),
  counties: new Set<string>(),
  causes: new Set<string>(),
  alcohol: false,
  distracted: false,
  pedestrian: false,
  cyclist: false,
  drug: false,
  driverAge: null,
  hitRun: false,
  weather: new Set<string>(),
  lighting: new Set<string>(),
  collisionType: new Set<string>(),
  roadType: null,
};

describe("computeFilterScope", () => {
  it("treats fully empty filter state as 'no filters'", () => {
    const s = computeFilterScope(empty);
    expect(s.hasAnyFilter).toBe(false);
    expect(s.oneLine).toBe("All California crashes");
    expect(s.filenameSuffix).toBe("");
  });

  it("formats a single-county / single-severity / date-range scope", () => {
    const s = computeFilterScope({
      ...empty,
      dateRange: { start: { year: 2022, month: 1 }, end: { year: 2023, month: 12 } },
      counties: new Set(["Los Angeles"]),
      severities: new Set(["Fatal"]),
    });
    expect(s.hasAnyFilter).toBe(true);
    expect(s.rows.find((r) => r.label === "County")?.value).toBe("Los Angeles");
    expect(s.rows.find((r) => r.label === "Severity")?.value).toBe("Fatal");
    expect(s.rows.find((r) => r.label === "Date range")?.value).toBe("2022-01 → 2023-12");
    expect(s.filenameSuffix).toBe("_los-angeles_2022-01_2023-12_fatal");
  });

  it("lists multiple counties by name when there are 3 or fewer", () => {
    const s = computeFilterScope({
      ...empty,
      counties: new Set(["Los Angeles", "Orange", "San Diego"]),
    });
    // Alphabetical join — same convention as severities/causes.
    expect(s.rows.find((r) => r.label === "County")?.value).toBe("Los Angeles, Orange, San Diego");
    // Filenames still collapse to a count because 3 county slugs would
    // make for an unwieldy filename.
    expect(s.filenameSuffix).toBe("_3counties");
  });

  it("truncates long county lists with +N more", () => {
    const s = computeFilterScope({
      ...empty,
      counties: new Set(["Alameda", "Fresno", "Los Angeles", "Orange", "San Diego"]),
    });
    const value = s.rows.find((r) => r.label === "County")?.value ?? "";
    expect(value).toMatch(/\+2 more$/);
    expect(value).toContain("Alameda");
  });

  it("includes involvement flags as a single row", () => {
    const s = computeFilterScope({
      ...empty,
      alcohol: true,
      distracted: true,
    });
    const inv = s.rows.find((r) => r.label === "Involvement");
    expect(inv?.value).toContain("Alcohol");
    expect(inv?.value).toContain("Distracted");
  });

  it("shows driver age row only when set", () => {
    const without = computeFilterScope(empty);
    expect(without.rows.find((r) => r.label === "Driver age")).toBeUndefined();

    const withAge = computeFilterScope({ ...empty, driverAge: "16-21" });
    expect(withAge.rows.find((r) => r.label === "Driver age")?.value).toBe("16-21");
  });

  it("lists multiple severities by name rather than count", () => {
    const s = computeFilterScope({
      ...empty,
      severities: new Set(["Fatal", "Injury"]),
    });
    expect(s.rows.find((r) => r.label === "Severity")?.value).toBe("Fatal, Injury");
  });

  it("translates cause slugs to human labels", () => {
    const s = computeFilterScope({
      ...empty,
      causes: new Set(["lane-change", "dui"]),
    });
    // Alphabetical: "DUI" before "Lane Change".
    expect(s.rows.find((r) => r.label === "Cause")?.value).toBe("DUI, Lane Change");
  });

  it("truncates long cause lists with a +N more suffix", () => {
    const s = computeFilterScope({
      ...empty,
      causes: new Set(["dui", "speeding", "turning", "other", "lane-change"]),
    });
    const value = s.rows.find((r) => r.label === "Cause")?.value ?? "";
    expect(value).toMatch(/\+2 more$/);
    // First three (sorted) should appear in full.
    expect(value).toContain("DUI");
  });

  it("treats weather-only as a real filter (regression: CSV gate was wrong)", () => {
    // hasAnyFilter used to return false here, blocking CSV with
    // "Apply at least one filter" even though /api/crashes respects weather.
    const s = computeFilterScope({ ...empty, weather: new Set(["rain"]) });
    expect(s.hasAnyFilter).toBe(true);
    expect(s.rows.find((r) => r.label === "Weather")?.value).toBe("Rain");
  });

  it("humanizes condition slugs in the scope rows", () => {
    const s = computeFilterScope({
      ...empty,
      lighting: new Set(["dark_lit", "dusk_dawn"]),
      collisionType: new Set(["rear_end"]),
      roadType: "highway",
    });
    expect(s.rows.find((r) => r.label === "Lighting")?.value).toBe("Dark (Street Lights), Dusk / Dawn");
    expect(s.rows.find((r) => r.label === "Collision type")?.value).toBe("Rear End");
    expect(s.rows.find((r) => r.label === "Road type")?.value).toBe("Highway");
  });

  it("omits condition rows when their set is empty", () => {
    const s = computeFilterScope(empty);
    expect(s.rows.find((r) => r.label === "Weather")).toBeUndefined();
    expect(s.rows.find((r) => r.label === "Lighting")).toBeUndefined();
    expect(s.rows.find((r) => r.label === "Collision type")).toBeUndefined();
    expect(s.rows.find((r) => r.label === "Road type")).toBeUndefined();
  });

  it("handles open-ended date ranges", () => {
    const startOnly = computeFilterScope({
      ...empty,
      dateRange: { start: { year: 2023, month: 6 }, end: null },
    });
    expect(startOnly.rows.find((r) => r.label === "Date range")?.value).toBe("2023-06 → present");

    const endOnly = computeFilterScope({
      ...empty,
      dateRange: { start: null, end: { year: 2010, month: 12 } },
    });
    expect(endOnly.rows.find((r) => r.label === "Date range")?.value).toBe("earliest → 2010-12");
  });
});
