import { describe, it, expect } from "vitest";
import {
  generateChartNarrative,
  generateDashboardNarrative,
  type FilterDescription,
} from "./narrativeEngine";
import type { Anomaly } from "./anomaly";

const NO_FILTERS: FilterDescription = { counties: [], severities: [], causes: [], flags: [] };

function makeAnomaly(overrides: Partial<Anomaly> = {}): Anomaly {
  return {
    id: "a-1",
    method: "zscore",
    severity: "critical",
    confidence: 99,
    message: "msg",
    dimension: "hour",
    measure: "count",
    index: 0,
    label: "2 AM",
    value: 500,
    ...overrides,
  };
}

describe("generateChartNarrative", () => {
  it("returns an empty narrative for empty data", () => {
    expect(generateChartNarrative([], "hour", "count", "plain")).toEqual({
      paragraph: "",
      sentences: [],
      facts: [],
      confidence: 0,
    });
  });

  it("renders the flat-trend template per tone (< 5% variation)", () => {
    const data = [100, 101, 99, 100].map((v, i) => ({ label: `x${i}`, value: v }));

    const plain = generateChartNarrative(data, "Hour of Day", "Crash Count", "plain");
    expect(plain.sentences[0]).toBe("Crash Count stayed fairly steady over this period.");

    const technical = generateChartNarrative(data, "Hour of Day", "Crash Count", "technical");
    expect(technical.sentences[0]).toBe(
      "Crash Count remained relatively stable across the Hour of Day axis (< 5% variation).",
    );
    // No trend fact is emitted for flat data.
    expect(technical.facts.filter((f) => f.type === "trend")).toEqual([]);
  });

  it("renders a rising trend with magnitude from first-third vs last-third averages", () => {
    // First third avg = 11, last third avg = 75 → +581.8%.
    const data = [10, 12, 50, 100].map((v, i) => ({ label: `x${i}`, value: v }));

    const technical = generateChartNarrative(data, "Year", "Crash Count", "technical");
    expect(technical.sentences[0]).toBe(
      "Crash Count increased by approximately 581.8% across the Year axis.",
    );
    const trend = technical.facts.find((f) => f.type === "trend");
    expect(trend).toMatchObject({ strength: "strong", label: "+582%" });

    const plain = generateChartNarrative(data, "Year", "Crash Count", "plain");
    expect(plain.sentences[0]).toBe("Crash Count has increased by about 582% over this period.");
  });

  it("renders a falling trend with 'decreased'", () => {
    const data = [100, 90, 40, 20].map((v, i) => ({ label: `x${i}`, value: v }));
    const result = generateChartNarrative(data, "Year", "Fatalities", "plain");
    expect(result.sentences[0]).toContain("has decreased by about");
    expect(result.facts.find((f) => f.type === "trend")!.label).toMatch(/^-/);
  });

  it("emits peak, trough and dominance sentences when thresholds are crossed", () => {
    // mean = 180; peak 500 (+178% > 15%), trough 100 (44% below > 30%),
    // top share 500/900 ≈ 56% (> 40%).
    const data = [100, 100, 100, 100, 500].map((v, i) => ({ label: `x${i}`, value: v }));
    const result = generateChartNarrative(data, "Hour", "Crash Count", "technical");

    expect(result.sentences).toContain("Peak of 500 at x4 (178% above mean).");
    expect(result.sentences).toContain("Trough of 100 at x0 (44% below mean).");
    expect(result.sentences).toContain("x4 accounts for 55.6% of total Crash Count.");

    const types = result.facts.map((f) => f.type);
    expect(types).toContain("peak");
    expect(types).toContain("trough");
    expect(types).toContain("dominance");
    expect(result.facts.find((f) => f.type === "peak")!.strength).toBe("strong");
    expect(result.facts.find((f) => f.type === "trough")!.strength).toBe("moderate");
    expect(result.facts.find((f) => f.type === "dominance")!.strength).toBe("moderate");
    // confidence = 0.3 + 5/20 + 4 * 0.1 = 0.95
    expect(result.confidence).toBeCloseTo(0.95, 5);
    // paragraph is the sentences joined with spaces
    expect(result.paragraph).toBe(result.sentences.join(" "));
  });

  it("uses the plain-tone peak/dominance wording", () => {
    const data = [100, 100, 100, 100, 500].map((v, i) => ({ label: `x${i}`, value: v }));
    const result = generateChartNarrative(data, "Hour", "Crash Count", "plain");
    expect(result.sentences).toContain("The highest point was 500 at x4.");
    expect(result.sentences).toContain("The lowest point was 100 at x0.");
    expect(result.sentences).toContain("x4 makes up 56% of the total.");
  });

  it("abbreviates large numbers (K/M) in rendered sentences", () => {
    const data = [1000, 1000, 1000, 1000, 1_500_000].map((v, i) => ({ label: `x${i}`, value: v }));
    const result = generateChartNarrative(data, "County", "Crash Count", "plain");
    expect(result.sentences.join(" ")).toContain("1.5M");
  });

  it("suppresses peak/trough sentences for 2-point data", () => {
    const data = [10, 100].map((v, i) => ({ label: `x${i}`, value: v }));
    const result = generateChartNarrative(data, "Year", "Crash Count", "plain");
    expect(result.facts.filter((f) => f.type === "peak" || f.type === "trough")).toEqual([]);
  });
});

describe("generateDashboardNarrative", () => {
  const chartData = {
    "hour:count": [10, 12, 50, 100].map((v, i) => ({ label: `x${i}`, value: v })),
  };
  const meta = [{ id: "chart1", dimension: "hour", measure: "count" }];

  it("builds filter context from counties, severities, date range and flags", () => {
    const filters: FilterDescription = {
      counties: ["Fresno"],
      severities: ["Fatal", "Injury"],
      causes: [],
      dateRange: { start: "2020-01", end: "2023-12" },
      flags: ["Alcohol", "Hit & Run"],
    };
    const result = generateDashboardNarrative({}, [], [], filters, "plain");
    expect(result.filterContext).toBe("Fresno | Fatal, Injury | 2020-01 - 2023-12 | Alcohol, Hit & Run");
  });

  it("summarizes multiple counties by count and defaults to 'All counties'", () => {
    const many = generateDashboardNarrative(
      {}, [], [],
      { counties: ["A", "B", "C"], severities: [], causes: [], flags: [] },
      "plain",
    );
    expect(many.filterContext).toBe("3 counties");

    const none = generateDashboardNarrative({}, [], [], NO_FILTERS, "plain");
    expect(none.filterContext).toBe("All counties");
  });

  it("renders a start-only date range without a dangling separator", () => {
    const result = generateDashboardNarrative(
      {}, [], [],
      { ...NO_FILTERS, dateRange: { start: "2021-06" } },
      "plain",
    );
    expect(result.filterContext).toBe("All counties | 2021-06");
  });

  it("adds a data-quality note when total data points are sparse", () => {
    const sparse = generateDashboardNarrative(chartData, meta, [], NO_FILTERS, "plain");
    expect(sparse.dataNote).toMatch(/Limited data/);

    const dense = generateDashboardNarrative(
      { "hour:count": Array.from({ length: 12 }, (_, i) => ({ label: `x${i}`, value: 10 + i })) },
      meta, [], NO_FILTERS, "plain",
    );
    expect(dense.dataNote).toBeNull();
  });

  it("keys chart narratives by chart id and skips charts without data", () => {
    const result = generateDashboardNarrative(
      chartData,
      [...meta, { id: "chart2", dimension: "cause", measure: "count" }],
      [], NO_FILTERS, "plain",
    );
    expect(result.chartNarratives.has("chart1")).toBe(true);
    expect(result.chartNarratives.has("chart2")).toBe(false);
  });

  it("uses dimensionLabel/measureLabel in rendered sentences when provided", () => {
    const result = generateDashboardNarrative(
      chartData,
      [{ id: "chart1", dimension: "hour", measure: "count", dimensionLabel: "Hour of Day", measureLabel: "Crash Count" }],
      [], NO_FILTERS, "technical",
    );
    expect(result.chartNarratives.get("chart1")!.sentences[0]).toContain("Crash Count");
    expect(result.chartNarratives.get("chart1")!.sentences[0]).toContain("Hour of Day");
  });

  it("renders anomaly findings per tone and caps them at 3", () => {
    const anomalies = [
      makeAnomaly({ id: "a1", label: "2 AM", confidence: 99 }),
      makeAnomaly({ id: "a2", label: "3 AM", severity: "high", confidence: 95 }),
      makeAnomaly({ id: "a3", label: "4 AM", severity: "medium", confidence: 90 }),
      makeAnomaly({ id: "a4", label: "5 AM", severity: "medium", confidence: 85 }),
    ];

    const plain = generateDashboardNarrative({}, [], anomalies, NO_FILTERS, "plain");
    const plainTexts = plain.keyFindings.map((f) => f.text);
    expect(plainTexts).toContain("Unusual pattern found in 2 AM.");
    expect(plainTexts.some((t) => t.includes("5 AM"))).toBe(false); // capped at 3

    const technical = generateDashboardNarrative({}, [], anomalies.slice(0, 1), NO_FILTERS, "technical");
    expect(technical.keyFindings[0].text).toBe(
      "Anomaly detected: 2 AM deviates significantly from expected pattern (zscore, confidence 99%).",
    );
    expect(technical.keyFindings[0].icon).toBe("warning");
  });

  it("weights anomaly finding priority by severity", () => {
    const anomalies = [
      makeAnomaly({ id: "m", label: "medium one", severity: "medium" }),
      makeAnomaly({ id: "c", label: "critical one", severity: "critical" }),
    ];
    const result = generateDashboardNarrative({}, [], anomalies, NO_FILTERS, "plain");
    const critical = result.keyFindings.find((f) => f.text.includes("critical one"))!;
    const medium = result.keyFindings.find((f) => f.text.includes("medium one"))!;
    expect(critical.priority).toBe(6); // 3 * 2
    expect(medium.priority).toBe(2); // 1 * 2
    // Sorted by priority descending.
    expect(result.keyFindings[0].text).toContain("critical one");
  });

  it("deduplicates key findings with identical text", () => {
    // Two charts sharing a slot render identical first sentences.
    const result = generateDashboardNarrative(
      chartData,
      [
        { id: "chart1", dimension: "hour", measure: "count" },
        { id: "chart1-copy", dimension: "hour", measure: "count" },
      ],
      [], NO_FILTERS, "plain",
    );
    const texts = result.keyFindings.map((f) => f.text);
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts.filter((t) => t.includes("increased"))).toHaveLength(1);
  });
});
