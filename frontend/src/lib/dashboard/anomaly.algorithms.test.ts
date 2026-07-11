import { describe, it, expect } from "vitest";
import { detectAnomalies } from "./anomaly";
import type { ChartDataItem } from "../../hooks/useDashboardData";

const makeData = (values: number[]): ChartDataItem[] =>
  values.map((v, i) => ({ label: `item-${i}`, value: v }));

describe("detectAnomalies — z-score", () => {
  it("flags a single extreme spike with the z-score method", () => {
    // Nine identical values + one spike: IQR is 0 (skipped) and CUSUM never
    // accumulates, so only the z-score detector can fire. z = sqrt(n-1) = 3.
    const data = makeData([10, 10, 10, 10, 10, 10, 10, 10, 10, 100]);
    const result = detectAnomalies(data, "hour", "count");

    expect(result).toHaveLength(1);
    const a = result[0];
    expect(a.method).toBe("zscore");
    expect(a.index).toBe(9);
    expect(a.label).toBe("item-9");
    expect(a.value).toBe(100);
    expect(a.confidence).toBe(99); // |z| = 3 exactly
    expect(a.severity).toBe("critical");
    expect(a.message).toContain("above avg");
    expect(a.message).toContain("3.0σ");
    // mean = 19 → (100-19)/19 = +426%
    expect(a.message).toContain("+426%");
    expect(a.message).toContain("crashes"); // measure noun for "count"
  });

  it("flags a dip below the mean with 'below avg' direction", () => {
    const data = makeData([100, 100, 100, 100, 100, 100, 100, 100, 100, 10]);
    const result = detectAnomalies(data, "hour", "count");

    expect(result).toHaveLength(1);
    expect(result[0].method).toBe("zscore");
    expect(result[0].index).toBe(9);
    expect(result[0].message).toContain("below avg");
  });

  it("abbreviates large values in the message (K suffix)", () => {
    const data = makeData([5, 5, 5, 5, 5, 5, 5, 5, 5, 1500]);
    const result = detectAnomalies(data, "hour", "killed");
    expect(result).toHaveLength(1);
    expect(result[0].message).toContain("1.5K");
    expect(result[0].message).toContain("fatalities"); // noun for "killed"
  });

  it("returns nothing for constant data (zero variance)", () => {
    expect(detectAnomalies(makeData([7, 7, 7, 7, 7, 7, 7, 7]), "hour", "count")).toEqual([]);
  });

  it("returns nothing for fewer than 4 points even with a wild outlier", () => {
    expect(detectAnomalies(makeData([1, 1000, 1]), "hour", "count")).toEqual([]);
  });

  it("does not flag values under the 2σ threshold", () => {
    // Mild variation only — everything within 2σ of the mean.
    expect(detectAnomalies(makeData([10, 12, 11, 13, 12, 11, 10, 12]), "hour", "count")).toEqual([]);
  });
});

describe("detectAnomalies — IQR", () => {
  it("prefers the IQR method when its fence-exceedance confidence beats the z-score", () => {
    // Tight cluster around 50 plus symmetric contamination at 0 and 100.
    // Both outliers sit at |z| ≈ 2.24 (z-score confidence 95) but ~31 IQRs
    // beyond the fences (IQR confidence saturates at 99) — per-index dedup
    // must keep the higher-confidence IQR anomaly.
    const data = makeData([0, 100, 50, 50, 51, 49, 50, 51, 49, 50]);
    const result = detectAnomalies(data, "county", "count");

    expect(result).toHaveLength(2); // deduped by index, not 4 entries
    for (const a of result) {
      expect(a.method).toBe("iqr");
      expect(a.confidence).toBe(99);
      expect(a.severity).toBe("critical");
    }
    expect(result.map((a) => a.index).sort()).toEqual([0, 1]);
    const low = result.find((a) => a.index === 0)!;
    const high = result.find((a) => a.index === 1)!;
    expect(low.message).toContain("below lower");
    expect(high.message).toContain("above upper");
  });

  it("catches outliers the z-score misses when contamination inflates the stddev", () => {
    // 21 base values (49/50/51) + six outliers at 150. The outliers drag the
    // stddev up so their z ≈ 1.86 (< 2 threshold, z-score silent), but the
    // fences (iqr = 1.5 → upper ≈ 53) still catch every one of them.
    const base = [49, 50, 51, 49, 50, 51, 49, 50, 51, 49, 50, 51, 49, 50, 51, 49, 50, 51, 49, 50, 51];
    const data = makeData([...base, 150, 150, 150, 150, 150, 150]);
    const result = detectAnomalies(data, "county", "count");

    expect(result.length).toBeGreaterThan(0);
    expect(result.every((a) => a.method === "iqr")).toBe(true);
    // Six outliers detected but the result is capped at the top 5.
    expect(result).toHaveLength(5);
    for (const a of result) {
      expect(a.index).toBeGreaterThanOrEqual(21);
      expect(a.message).toContain("outlier");
    }
  });

  it("returns nothing when fewer than 5 points (IQR) and under z threshold", () => {
    // 4 points: too few for IQR and no point reaches 2σ.
    expect(detectAnomalies(makeData([10, 11, 12, 13]), "county", "count")).toEqual([]);
  });
});

describe("detectAnomalies — change point (CUSUM)", () => {
  it("detects a sustained regime shift that neither z-score nor IQR flags", () => {
    // 32 samples at 10 then 10 samples at 20. Every value is within 1.8σ of
    // the mean (z-score silent) and the IQR is 0 (IQR silent), but the CUSUM
    // accumulates across the shifted regime and fires.
    const data = makeData([...Array(32).fill(10), ...Array(10).fill(20)]);
    const result = detectAnomalies(data, "year", "count");

    expect(result).toHaveLength(1);
    const a = result[0];
    expect(a.method).toBe("change_point");
    expect(a.severity).toBe("high");
    expect(a.confidence).toBe(88);
    // The CUSUM lags the true change point (index 32) but fires inside the
    // shifted regime, never before it.
    expect(a.index).toBeGreaterThanOrEqual(32);
    expect(a.message).toContain("Structural shift");
  });

  it("returns nothing for fewer than 6 points", () => {
    expect(detectAnomalies(makeData([10, 10, 10, 20, 20]), "year", "count")).toEqual([]);
  });

  it("does not fire on stable data with mild noise", () => {
    const data = makeData([10, 11, 10, 9, 10, 11, 10, 9, 10, 11, 10, 9]);
    expect(detectAnomalies(data, "year", "count").filter((a) => a.method === "change_point")).toEqual([]);
  });
});

describe("detectAnomalies — aggregation", () => {
  it("sorts results by confidence descending", () => {
    const data = makeData([0, 100, 50, 50, 51, 49, 50, 51, 49, 50]);
    const result = detectAnomalies(data, "county", "count");
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].confidence).toBeGreaterThanOrEqual(result[i].confidence);
    }
  });

  it("builds stable ids from method, dimension, measure and index", () => {
    const data = makeData([10, 10, 10, 10, 10, 10, 10, 10, 10, 100]);
    const [a] = detectAnomalies(data, "hour", "killed");
    expect(a.id).toBe("z-hour-killed-9");
    expect(a.dimension).toBe("hour");
    expect(a.measure).toBe("killed");
  });
});
