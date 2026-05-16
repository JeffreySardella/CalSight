import { describe, it, expect } from "vitest";
import { parseNlq, resolveNlq } from "./nlqParser";

describe("nlqParser", () => {
  describe("parseNlq", () => {
    it("parses a full query with all three components", () => {
      const result = parseNlq("fatalities by county as a scatter plot");
      expect(result.dimension).toBe("county");
      expect(result.measure).toBe("killed");
      expect(result.chartType).toBe("scatter");
      expect(result.confidence).toBe("high");
    });

    it("parses dimension and measure without chart type", () => {
      const result = parseNlq("crashes by hour");
      expect(result.dimension).toBe("hour");
      expect(result.measure).toBe("count");
      expect(result.chartType).toBeNull();
      expect(result.confidence).toBe("high");
    });

    it("parses chart type only", () => {
      const result = parseNlq("show me a treemap");
      expect(result.chartType).toBe("treemap");
      expect(result.confidence).toBe("medium");
    });

    it("parses severity as dimension", () => {
      const result = parseNlq("severity breakdown as a donut");
      expect(result.dimension).toBe("severity");
      expect(result.chartType).toBe("donut");
    });

    it("parses demographic dimensions", () => {
      expect(parseNlq("injuries by victim age").dimension).toBe("age_bracket");
      expect(parseNlq("crashes by driver gender").dimension).toBe("at_fault_gender");
    });

    it("parses trend line option", () => {
      const result = parseNlq("crashes over time with trend line");
      expect(result.dimension).toBe("year");
      expect(result.options.trendLine).toBe(true);
    });

    it("parses cumulative option", () => {
      const result = parseNlq("cumulative fatalities by month");
      expect(result.options.cumulative).toBe(true);
    });

    it("returns low confidence for gibberish", () => {
      const result = parseNlq("hello world");
      expect(result.confidence).toBe("low");
    });

    it("handles fatality rate measure", () => {
      const result = parseNlq("fatality rate by county");
      expect(result.measure).toBe("fatality_rate");
      expect(result.dimension).toBe("county");
    });

    it("handles year-over-year change", () => {
      const result = parseNlq("yoy change by year");
      expect(result.measure).toBe("yoy_change");
    });

    it("handles weather dimension", () => {
      const result = parseNlq("crashes by weather condition");
      expect(result.dimension).toBe("weather");
    });

    it("handles radar chart type", () => {
      const result = parseNlq("day of week as a radar");
      expect(result.chartType).toBe("radar");
      expect(result.dimension).toBe("day_of_week");
    });
  });

  describe("resolveNlq", () => {
    it("fills in defaults for missing fields", () => {
      const parsed = parseNlq("crashes by county");
      const resolved = resolveNlq(parsed);
      expect(resolved).not.toBeNull();
      expect(resolved!.dimension).toBe("county");
      expect(resolved!.measure).toBe("count");
      expect(resolved!.chartType).toBe("hbar");
    });

    it("returns null for low confidence", () => {
      const parsed = parseNlq("asdfghjkl");
      expect(resolveNlq(parsed)).toBeNull();
    });

    it("uses default chart type for dimension", () => {
      const parsed = parseNlq("fatalities by year");
      const resolved = resolveNlq(parsed);
      expect(resolved!.chartType).toBe("area");
    });

    it("respects explicit chart type override", () => {
      const parsed = parseNlq("fatalities by year as a bar chart");
      const resolved = resolveNlq(parsed);
      expect(resolved!.chartType).toBe("bar");
    });
  });
});
