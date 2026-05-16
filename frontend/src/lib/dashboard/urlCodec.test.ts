import { describe, it, expect } from "vitest";
import { encodeDashboard, decodeDashboard } from "./urlCodec";
import type { DashboardConfig } from "./types";

describe("urlCodec", () => {
  it("roundtrips a simple mode config", () => {
    const config: DashboardConfig = { mode: "simple", preset: "time", charts: [] };
    const encoded = encodeDashboard(config);
    expect(typeof encoded).toBe("string");
    expect(encoded.length).toBeGreaterThan(0);
    const decoded = decodeDashboard(encoded);
    expect(decoded).toEqual(config);
  });

  it("roundtrips an advanced mode config with charts", () => {
    const config: DashboardConfig = {
      mode: "advanced",
      preset: "overview",
      charts: [
        { id: "abc", dimension: "hour", measure: "count", chartType: "bar", order: 0 },
        { id: "def", dimension: "severity", measure: "killed", chartType: "donut", order: 1 },
      ],
    };
    const encoded = encodeDashboard(config);
    const decoded = decodeDashboard(encoded);
    expect(decoded).toEqual(config);
  });

  it("returns null for invalid input", () => {
    expect(decodeDashboard("garbage!!!")).toBeNull();
    expect(decodeDashboard("")).toBeNull();
  });

  it("returns null for invalid base64 characters", () => {
    // Characters that are not valid base64: @, #, $, spaces
    expect(decodeDashboard("@#$%^&*")).toBeNull();
    expect(decodeDashboard("not base64 at all!")).toBeNull();
    expect(decodeDashboard("====")).toBeNull();
  });

  it("returns null for valid base64 but invalid JSON", () => {
    // btoa("this is not json") -> valid base64 that decodes to non-JSON
    const validBase64NotJson = btoa(encodeURIComponent("this is not json"));
    expect(decodeDashboard(validBase64NotJson)).toBeNull();
  });

  it("returns null for valid base64 of incomplete JSON", () => {
    const incompleteJson = btoa(encodeURIComponent("{\"mode\":\"simple\""));
    expect(decodeDashboard(incompleteJson)).toBeNull();
  });

  it("returns null for valid JSON but missing mode", () => {
    const noMode = btoa(encodeURIComponent(JSON.stringify({ preset: "overview", charts: [] })));
    expect(decodeDashboard(noMode)).toBeNull();
  });

  it("returns null for valid JSON but invalid mode value", () => {
    const badMode = btoa(encodeURIComponent(JSON.stringify({ mode: "invalid", preset: "overview", charts: [] })));
    expect(decodeDashboard(badMode)).toBeNull();
  });

  it("returns null for valid JSON but mode is not a string", () => {
    const numericMode = btoa(encodeURIComponent(JSON.stringify({ mode: 123, preset: "overview", charts: [] })));
    expect(decodeDashboard(numericMode)).toBeNull();
  });

  it("returns null for valid JSON but missing preset", () => {
    const noPreset = btoa(encodeURIComponent(JSON.stringify({ mode: "simple", charts: [] })));
    expect(decodeDashboard(noPreset)).toBeNull();
  });

  it("returns null for valid JSON but preset is not a string", () => {
    const numericPreset = btoa(encodeURIComponent(JSON.stringify({ mode: "simple", preset: 42, charts: [] })));
    expect(decodeDashboard(numericPreset)).toBeNull();
  });

  it("returns null for valid JSON but charts is not an array", () => {
    const chartsObj = btoa(encodeURIComponent(JSON.stringify({ mode: "simple", preset: "overview", charts: {} })));
    expect(decodeDashboard(chartsObj)).toBeNull();

    const chartsStr = btoa(encodeURIComponent(JSON.stringify({ mode: "simple", preset: "overview", charts: "foo" })));
    expect(decodeDashboard(chartsStr)).toBeNull();

    const chartsNull = btoa(encodeURIComponent(JSON.stringify({ mode: "simple", preset: "overview", charts: null })));
    expect(decodeDashboard(chartsNull)).toBeNull();

    const chartsNum = btoa(encodeURIComponent(JSON.stringify({ mode: "simple", preset: "overview", charts: 123 })));
    expect(decodeDashboard(chartsNum)).toBeNull();
  });

  it("returns null for valid JSON but charts is missing entirely", () => {
    const noCharts = btoa(encodeURIComponent(JSON.stringify({ mode: "advanced", preset: "time" })));
    expect(decodeDashboard(noCharts)).toBeNull();
  });

  it("returns null for JSON array instead of object", () => {
    const jsonArray = btoa(encodeURIComponent(JSON.stringify([1, 2, 3])));
    expect(decodeDashboard(jsonArray)).toBeNull();
  });

  it("returns null for JSON null value", () => {
    const jsonNull = btoa(encodeURIComponent(JSON.stringify(null)));
    expect(decodeDashboard(jsonNull)).toBeNull();
  });

  it("returns null for JSON primitive string", () => {
    const jsonStr = btoa(encodeURIComponent(JSON.stringify("hello")));
    expect(decodeDashboard(jsonStr)).toBeNull();
  });

  it("accepts any string value for preset (no preset validation in codec)", () => {
    // The codec only checks typeof parsed.preset === "string"
    // It does NOT validate against the PresetKey type
    const fakePreset = btoa(encodeURIComponent(JSON.stringify({
      mode: "simple",
      preset: "nonexistent_preset",
      charts: [],
    })));
    const decoded = decodeDashboard(fakePreset);
    // The codec allows it through since it's a valid string
    expect(decoded).not.toBeNull();
    expect(decoded!.preset).toBe("nonexistent_preset");
  });

  it("preserves chart options through roundtrip", () => {
    const config: DashboardConfig = {
      mode: "advanced",
      preset: "rates",
      charts: [
        {
          id: "test1",
          dimension: "year",
          measure: "killed",
          chartType: "area",
          order: 0,
          options: { trendLine: true, meanLine: true, stdBand: true },
        },
      ],
    };
    const decoded = decodeDashboard(encodeDashboard(config));
    expect(decoded).toEqual(config);
  });

  it("preserves splitBy through roundtrip", () => {
    const config: DashboardConfig = {
      mode: "advanced",
      preset: "overview",
      charts: [
        {
          id: "split1",
          dimension: "hour",
          measure: "count",
          chartType: "line",
          splitBy: "severity",
          order: 0,
        },
      ],
    };
    const decoded = decodeDashboard(encodeDashboard(config));
    expect(decoded).toEqual(config);
  });
});
