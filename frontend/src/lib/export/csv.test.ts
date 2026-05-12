import { describe, it, expect } from "vitest";
import { buildCsv, csvEscape } from "./csv";

describe("csvEscape", () => {
  it("returns plain strings unchanged", () => {
    expect(csvEscape("hello")).toBe("hello");
    expect(csvEscape("123")).toBe("123");
  });

  it("wraps values containing commas in quotes", () => {
    expect(csvEscape("Los Angeles, CA")).toBe('"Los Angeles, CA"');
  });

  it("escapes internal quotes by doubling and wraps the result", () => {
    expect(csvEscape('She said "hi"')).toBe('"She said ""hi"""');
  });

  it("wraps values with newlines", () => {
    expect(csvEscape("line one\nline two")).toBe('"line one\nline two"');
  });

  it("renders null/undefined as empty cells", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
  });

  it("renders numbers and booleans without quoting", () => {
    expect(csvEscape(0)).toBe("0");
    expect(csvEscape(true)).toBe("true");
    expect(csvEscape(false)).toBe("false");
  });
});

describe("buildCsv", () => {
  it("produces a header row and CRLF-separated data rows", () => {
    const row = {
      id: 1,
      collision_id: 10,
      data_source: "ccrs",
      crash_datetime: "2023-06-01T12:00:00",
      county_code: 19,
      county_name: "Los Angeles",
      city_name: null,
      latitude: 34.0,
      longitude: -118.0,
      severity: "Fatal",
      canonical_cause: "dui",
      primary_factor: null,
      number_killed: 1,
      number_injured: 0,
      weather: "Clear",
      road_condition: "Dry",
      lighting: "Daylight",
      is_alcohol_involved: true,
      is_distraction_involved: false,
      pedestrian_involved: null,
    };
    const csv = buildCsv([row]);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("id,collision_id,data_source");
    expect(lines[1]).toContain("Los Angeles");
    expect(lines[1]).toContain("Fatal");
    expect(lines[1]).toContain("true");
    // Empty cell for null pedestrian_involved.
    expect(lines[1].endsWith(",")).toBe(true);
  });

  it("returns just the header when there are no rows", () => {
    const csv = buildCsv([]);
    expect(csv.split("\r\n")).toHaveLength(1);
    expect(csv).toContain("id,collision_id");
  });

  it("quotes county names containing commas", () => {
    const row = {
      id: 1, collision_id: 1, data_source: "ccrs",
      crash_datetime: "2023-01-01T00:00:00", county_code: 1,
      county_name: "Saint Marie, North",
      city_name: null, latitude: null, longitude: null,
      severity: null, canonical_cause: null, primary_factor: null,
      number_killed: null, number_injured: null, weather: null,
      road_condition: null, lighting: null,
      is_alcohol_involved: null, is_distraction_involved: null,
      pedestrian_involved: null,
    };
    const csv = buildCsv([row]);
    expect(csv).toContain('"Saint Marie, North"');
  });
});
