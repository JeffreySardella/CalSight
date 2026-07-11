import { describe, it, expect } from "vitest";
import { generateSuggestions, type ChartSuggestion } from "./chartSuggestion";
import type { ChartSlot, Dimension, Measure } from "./types";
import type { Anomaly } from "./anomaly";
import type { StatsFilters } from "../../hooks/useStats";

const NO_FILTERS: StatsFilters = {
  dateRange: null,
  severities: [],
  causes: [],
  counties: [],
};

function slot(dimension: Dimension, measure: Measure, id = `${dimension}-${measure}`): ChartSlot {
  return { id, dimension, measure, chartType: "bar", order: 0 };
}

function anomaly(dimension: Dimension, measure: Measure): Anomaly {
  return {
    id: `a-${dimension}-${measure}`,
    method: "zscore",
    severity: "critical",
    confidence: 99,
    message: "m",
    dimension,
    measure,
    index: 0,
    label: "x",
    value: 1,
  };
}

function ids(suggestions: ChartSuggestion[]): string[] {
  return suggestions.map((s) => s.id);
}

describe("generateSuggestions", () => {
  it("suggests unexplored dimensions when nothing else applies, capped at 6", () => {
    const result = generateSuggestions([], {}, NO_FILTERS, []);
    expect(result).toHaveLength(6);
    expect(result.every((s) => s.id.startsWith("explore-"))).toBe(true);
    expect(result.every((s) => s.measure === "count")).toBe(true);
    // Sorted by relevance descending.
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].relevance).toBeGreaterThanOrEqual(result[i].relevance);
    }
    // Environmental dimensions get the +5 boost when both are absent,
    // so they rank ahead of plain unexplored dimensions.
    expect(result[0].relevance).toBe(65);
    expect(ids(result.slice(0, 2)).sort()).toEqual(["explore-lighting-count", "explore-weather-count"]);
  });

  it("never suggests a dimension that is already on the dashboard", () => {
    const active = [slot("hour", "count"), slot("weather", "count")];
    const result = generateSuggestions(active, {}, NO_FILTERS, []);
    const explores = result.filter((s) => s.id.startsWith("explore-"));
    expect(explores.every((s) => s.dimension !== "hour" && s.dimension !== "weather")).toBe(true);
    // Weather present removes the environmental boost from lighting.
    const lighting = result.find((s) => s.id === "explore-lighting-count");
    if (lighting) expect(lighting.relevance).toBe(60);
  });

  it("ranks anomaly-driven suggestions first with alternative measures", () => {
    const result = generateSuggestions([], {}, NO_FILTERS, [anomaly("cause", "count")]);
    expect(ids(result.slice(0, 2))).toEqual([
      "anomaly-cause-killed",
      "anomaly-cause-fatality_rate",
    ]);
    const top = result[0];
    expect(top.relevance).toBe(75); // base 50 + anomalyRelated 25
    expect(top.title).toBe("Fatalities by Primary Cause");
    expect(top.explanation).toContain("Anomaly in Primary Cause");
    expect(top.chartType).toBe("hbar"); // defaultChartType("cause")
    expect(top.icon).toBe("bar_chart");
  });

  it("offers count/injured alternatives for a killed-measure anomaly", () => {
    const result = generateSuggestions([], {}, NO_FILTERS, [anomaly("hour", "killed")]);
    expect(ids(result)).toContain("anomaly-hour-count");
    expect(ids(result)).toContain("anomaly-hour-injured");
  });

  it("skips anomaly suggestions whose dimension:measure pair is already active", () => {
    const active = [slot("cause", "killed")];
    const result = generateSuggestions(active, {}, NO_FILTERS, [anomaly("cause", "count")]);
    expect(ids(result)).not.toContain("anomaly-cause-killed");
    expect(ids(result)).toContain("anomaly-cause-fatality_rate");
  });

  it("suggests hour and day-of-week charts when the alcohol filter is on", () => {
    const result = generateSuggestions([], {}, { ...NO_FILTERS, alcohol: true }, []);
    const filterSuggestions = result.filter((s) => s.id.startsWith("filter-"));
    expect(ids(filterSuggestions).sort()).toEqual(["filter-day_of_week-count", "filter-hour-count"]);
    for (const s of filterSuggestions) {
      expect(s.relevance).toBe(70); // base 50 + filterRelated 20
    }
    // Filter-driven suggestions outrank plain unexplored ones.
    expect(ids(result.slice(0, 2)).every((id) => id.startsWith("filter-"))).toBe(true);
  });

  it("does not re-suggest a filter chart that is already active", () => {
    const result = generateSuggestions(
      [slot("hour", "count")],
      {},
      { ...NO_FILTERS, alcohol: true },
      [],
    );
    expect(ids(result)).not.toContain("filter-hour-count");
    expect(ids(result)).toContain("filter-day_of_week-count");
  });

  it("suggests trend and deadliest-cause charts for a single-county filter", () => {
    const result = generateSuggestions([], {}, { ...NO_FILTERS, counties: ["fresno"] }, []);
    expect(ids(result)).toContain("filter-year-count");
    expect(ids(result)).toContain("filter-cause-killed");
    // Two selected counties → no county-specific suggestions.
    const two = generateSuggestions([], {}, { ...NO_FILTERS, counties: ["fresno", "kern"] }, []);
    expect(ids(two).some((id) => id.startsWith("filter-"))).toBe(false);
  });

  it("suggests age-bracket fatalities when the fatal severity filter is on", () => {
    const result = generateSuggestions([], {}, { ...NO_FILTERS, severities: ["fatal"] }, []);
    expect(ids(result)).toContain("filter-age_bracket-killed");
    const nonFatal = generateSuggestions([], {}, { ...NO_FILTERS, severities: ["injury"] }, []);
    expect(ids(nonFatal)).not.toContain("filter-age_bracket-killed");
  });

  it("suggests a complementary measure for an active chart", () => {
    const result = generateSuggestions([slot("hour", "count")], {}, NO_FILTERS, []);
    const complement = result.find((s) => s.id === "complement-hour-killed");
    expect(complement).toBeDefined();
    expect(complement!.relevance).toBe(65); // base 50 + complementary 15
    expect(complement!.explanation).toContain("crash count");
    expect(complement!.explanation).toContain("fatalities");
  });

  it("returns unique ids and at most 6 suggestions even with many candidates", () => {
    const result = generateSuggestions(
      [slot("hour", "count"), slot("year", "killed")],
      {},
      { ...NO_FILTERS, alcohol: true, counties: ["fresno"], severities: ["fatal"] },
      [anomaly("cause", "count"), anomaly("severity", "count")],
    );
    expect(result.length).toBeLessThanOrEqual(6);
    expect(new Set(ids(result)).size).toBe(result.length);
  });
});
