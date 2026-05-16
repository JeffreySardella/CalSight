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
});
