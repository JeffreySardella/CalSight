import { describe, it, expect } from "vitest";
import { buildCorrelationResult, CORRELATION_FIELDS, type CorrelationSupplemental } from "./useCorrelationData";
import { correlationColor, getTokens } from "../lib/theme/tokens";

// M-F7: a failed supplemental fetch used to surface as r = 0.00 — visually
// identical to a real "no correlation" result. Not-computable cells must be
// NaN (rendered as "—"/"N/A"), never a fabricated zero.

const emptySupplemental: CorrelationSupplemental = {
  demographics: [],
  calenviro: [],
  unemployment: [],
  vehicles: [],
  weather: [],
  fars: [],
  density: [],
};

function statsFor(nCounties: number) {
  return Array.from({ length: nCounties }, (_, i) => ({
    county_code: i + 1,
    county_name: `County ${i + 1}`,
    crash_count: 100 + i * 10,
    total_killed: 5 + i,
    total_injured: 50 + i,
  }));
}

describe("correlation matrix no-data cells (M-F7)", () => {
  it("marks cells NaN when a source returned no data instead of r=0.00", () => {
    const result = buildCorrelationResult(statsFor(10), emptySupplemental);
    const crashIdx = CORRELATION_FIELDS.findIndex((f) => f.key === "crash_count");
    const povertyIdx = CORRELATION_FIELDS.findIndex((f) => f.key === "poverty_rate");

    // crash_count × poverty_rate has zero data points (demographics fetch
    // failed) — must NOT masquerade as a computed zero correlation.
    expect(Number.isNaN(result.matrix[crashIdx][povertyIdx])).toBe(true);

    // Fields with real data still compute a genuine r.
    const killedIdx = CORRELATION_FIELDS.findIndex((f) => f.key === "total_killed");
    expect(Number.isNaN(result.matrix[crashIdx][killedIdx])).toBe(false);
  });

  it("keeps the diagonal at 1", () => {
    const result = buildCorrelationResult(statsFor(10), emptySupplemental);
    for (let i = 0; i < result.fields.length; i++) {
      expect(result.matrix[i][i]).toBe(1);
    }
  });
});

describe("correlationColor NaN handling (M-F7)", () => {
  it("renders NaN as the neutral color, not strong-negative red", () => {
    const tokens = getTokens("default", false).correlation;
    expect(correlationColor(NaN, tokens)).toBe(tokens.neutral);
  });
});
