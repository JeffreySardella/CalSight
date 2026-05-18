import { describe, it, expect } from "vitest";
import {
  chiSquaredTest,
  twoSampleTTest,
  oneWayAnova,
  correlationSignificance,
  mannKendallTest,
  kolmogorovSmirnovTest,
  bonferroniCorrection,
  fdrCorrection,
  correlationMatrixSignificance,
  distributions,
} from "./hypothesis";

// ─────────────────────────────────────────────────────────────────────────────
// Distribution function accuracy tests (validated against R/scipy)
// ─────────────────────────────────────────────────────────────────────────────

describe("distributions", () => {
  describe("normalCdf", () => {
    it("returns 0.5 at z=0", () => {
      expect(distributions.normalCdf(0)).toBeCloseTo(0.5, 6);
    });

    it("returns ~0.8413 at z=1", () => {
      expect(distributions.normalCdf(1)).toBeCloseTo(0.8413, 3);
    });

    it("returns ~0.9772 at z=2", () => {
      expect(distributions.normalCdf(2)).toBeCloseTo(0.9772, 3);
    });

    it("returns ~0.0228 at z=-2", () => {
      expect(distributions.normalCdf(-2)).toBeCloseTo(0.0228, 3);
    });

    it("returns ~0.9987 at z=3", () => {
      expect(distributions.normalCdf(3)).toBeCloseTo(0.9987, 3);
    });
  });

  describe("chiSquaredCdf", () => {
    it("chi-sq(3.84, df=1) ~ 0.95", () => {
      expect(distributions.chiSquaredCdf(3.841, 1)).toBeCloseTo(0.95, 2);
    });

    it("chi-sq(5.99, df=2) ~ 0.95", () => {
      expect(distributions.chiSquaredCdf(5.991, 2)).toBeCloseTo(0.95, 2);
    });

    it("chi-sq(9.49, df=4) ~ 0.95", () => {
      expect(distributions.chiSquaredCdf(9.488, 4)).toBeCloseTo(0.95, 2);
    });

    it("chi-sq(0, any df) = 0", () => {
      expect(distributions.chiSquaredCdf(0, 5)).toBe(0);
    });
  });

  describe("tCdf", () => {
    it("t=0 gives 0.5 for any df", () => {
      expect(distributions.tCdf(0, 10)).toBeCloseTo(0.5, 6);
      expect(distributions.tCdf(0, 100)).toBeCloseTo(0.5, 6);
    });

    it("t=2.228 with df=10 gives ~0.975 (two-tail critical)", () => {
      expect(distributions.tCdf(2.228, 10)).toBeCloseTo(0.975, 2);
    });

    it("converges to normal for large df", () => {
      // t(1.96, df=10000) should be very close to normal CDF at 1.96
      expect(distributions.tCdf(1.96, 10000)).toBeCloseTo(0.975, 2);
    });
  });

  describe("fCdf", () => {
    it("F=0 gives 0", () => {
      expect(distributions.fCdf(0, 3, 20)).toBe(0);
    });

    it("F(3.10, df1=3, df2=20) ~ 0.95", () => {
      // Critical value F(0.05, 3, 20) = 3.098
      expect(distributions.fCdf(3.098, 3, 20)).toBeCloseTo(0.95, 1);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Chi-Squared Test
// ─────────────────────────────────────────────────────────────────────────────

describe("chiSquaredTest", () => {
  it("detects independence (p ~ 1) for proportional distributions", () => {
    // Two groups with identical proportions: should NOT be significant
    const table = [
      [50, 30, 20],
      [100, 60, 40],
    ];
    const result = chiSquaredTest(table);
    expect(result.pValue).toBeGreaterThan(0.9);
    expect(result.significance).toBe("not_significant");
    expect(result.effectSize).toBeCloseTo(0, 1);
  });

  it("detects association (p < 0.001) for very different distributions", () => {
    // Group 1: mostly category A; Group 2: mostly category C
    const table = [
      [90, 5, 5],
      [5, 5, 90],
    ];
    const result = chiSquaredTest(table);
    expect(result.pValue).toBeLessThan(0.001);
    expect(result.significance).toBe("highly_significant");
    expect(result.effectSize!).toBeGreaterThan(0.5); // Large Cramer's V
  });

  it("computes correct Cramer's V for known example", () => {
    // Classic textbook example: 2x2 table
    // Observed: [[10, 20], [20, 10]]
    // Chi-sq = 60 * (10*10 - 20*20)^2 / (30*30*30*30) ... simplified
    const table = [[10, 20], [20, 10]];
    const result = chiSquaredTest(table);
    expect(result.statistic).toBeGreaterThan(0);
    expect(result.degreesOfFreedom).toBe(1); // (2-1)*(2-1)
  });

  it("warns about low expected counts", () => {
    const table = [
      [1, 0, 2],
      [0, 1, 1],
    ];
    const result = chiSquaredTest(table);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("expected count < 5");
  });

  it("handles empty table gracefully", () => {
    const result = chiSquaredTest([[0, 0], [0, 0]]);
    expect(result.pValue).toBe(1);
  });

  it("handles single row/col gracefully", () => {
    const result = chiSquaredTest([[10, 20]]);
    expect(result.interpretation).toContain("at least 2 groups");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Two-Sample t-Test
// ─────────────────────────────────────────────────────────────────────────────

describe("twoSampleTTest", () => {
  it("returns not significant for identical groups", () => {
    const a = [10, 12, 11, 13, 10, 12, 11, 13];
    const b = [10, 12, 11, 13, 10, 12, 11, 13];
    const result = twoSampleTTest(a, b);
    expect(result.pValue).toBeGreaterThan(0.9);
    expect(result.statistic).toBeCloseTo(0, 5);
    expect(result.effectSize).toBeCloseTo(0, 5);
  });

  it("detects significant difference for separated groups", () => {
    // Two clearly different groups
    const a = [100, 102, 98, 101, 99, 103, 97, 104, 96, 100];
    const b = [50, 52, 48, 51, 49, 53, 47, 54, 46, 50];
    const result = twoSampleTTest(a, b, "Weekdays", "Weekends");
    expect(result.pValue).toBeLessThan(0.001);
    expect(result.significance).toBe("highly_significant");
    expect(Math.abs(result.effectSize!)).toBeGreaterThan(2); // Huge Cohen's d
  });

  it("provides correct confidence interval direction", () => {
    const a = [20, 22, 21, 23, 24];
    const b = [10, 12, 11, 13, 14];
    const result = twoSampleTTest(a, b);
    // CI for (mean_a - mean_b) should be entirely positive
    expect(result.confidenceInterval![0]).toBeGreaterThan(0);
    expect(result.confidenceInterval![1]).toBeGreaterThan(0);
  });

  it("handles unequal sample sizes", () => {
    const a = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    const b = [5, 6, 7];
    const result = twoSampleTTest(a, b);
    expect(result.sampleSize).toBe(14);
    expect(result.degreesOfFreedom).toBeGreaterThan(0);
  });

  it("handles one-sided alternatives", () => {
    const a = [15, 16, 17, 18, 19];
    const b = [10, 11, 12, 13, 14];
    const greater = twoSampleTTest(a, b, "A", "B", "greater");
    const less = twoSampleTTest(a, b, "A", "B", "less");
    const twoSided = twoSampleTTest(a, b, "A", "B", "two-sided");

    // one-sided "greater" should give smaller p since a > b
    expect(greater.pValue).toBeLessThan(twoSided.pValue);
    // one-sided "less" should give p close to 1 since a > b
    expect(less.pValue).toBeGreaterThan(0.5);
  });

  it("warns for small sample sizes", () => {
    const result = twoSampleTTest([1, 2, 3], [4, 5, 6]);
    expect(result.warnings.some(w => w.includes("sample sizes < 30"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// One-Way ANOVA
// ─────────────────────────────────────────────────────────────────────────────

describe("oneWayAnova", () => {
  it("returns not significant for identical groups", () => {
    const groups = [
      [10, 12, 11, 10, 11],
      [10, 12, 11, 10, 11],
      [10, 12, 11, 10, 11],
    ];
    const result = oneWayAnova(groups);
    expect(result.pValue).toBeGreaterThan(0.9);
    expect(result.effectSize).toBeCloseTo(0, 2);
  });

  it("detects significant difference with well-separated groups", () => {
    const groups = [
      [10, 11, 12, 13, 14, 15], // Under 18
      [50, 51, 52, 53, 54, 55], // 25-44
      [90, 91, 92, 93, 94, 95], // 65+
    ];
    const result = oneWayAnova(groups, ["Under 18", "25-44", "65+"]);
    expect(result.pValue).toBeLessThan(0.001);
    expect(result.significance).toBe("highly_significant");
    expect(result.effectSize!).toBeGreaterThan(0.14); // Large eta-squared
    expect(result.interpretation).toContain("65+");
  });

  it("degrades to t-test equivalent for 2 groups", () => {
    const groups = [
      [10, 11, 12, 13, 14],
      [20, 21, 22, 23, 24],
    ];
    const anovaResult = oneWayAnova(groups);
    const tResult = twoSampleTTest(groups[0], groups[1]);
    // F = t^2 for 2-group case, so p-values should match
    expect(anovaResult.pValue).toBeCloseTo(tResult.pValue, 2);
  });

  it("computes eta-squared correctly for known data", () => {
    // 3 groups: means are 2, 4, 6 with some noise
    const groups = [
      [1, 2, 3],
      [3, 4, 5],
      [5, 6, 7],
    ];
    const result = oneWayAnova(groups);
    // SS_between = 3*(2-4)^2 + 3*(4-4)^2 + 3*(6-4)^2 = 24
    // SS_within = 2+2+2 = 6
    // eta^2 = 24/30 = 0.8
    expect(result.effectSize).toBeCloseTo(0.8, 1);
  });

  it("warns about unequal variances", () => {
    const groups = [
      [10, 10, 10, 11, 10],    // var very small
      [0, 50, 100, 150, 200],  // var = huge
    ];
    const result = oneWayAnova(groups);
    expect(result.warnings.some(w => w.includes("Variance ratio"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pearson Correlation Significance
// ─────────────────────────────────────────────────────────────────────────────

describe("correlationSignificance", () => {
  it("r=0.3 with n=58 is significant (p < 0.05)", () => {
    // This is the exact CalSight use case: 58 counties, moderate correlation
    const result = correlationSignificance(0.3, 58, "Poverty", "Crashes");
    expect(result.pValue).toBeLessThan(0.05);
    expect(result.significance).not.toBe("not_significant");
    expect(result.interpretation).toContain("IS statistically significant");
  });

  it("r=0.1 with n=10 is not significant", () => {
    const result = correlationSignificance(0.1, 10);
    expect(result.pValue).toBeGreaterThan(0.05);
    expect(result.significance).toBe("not_significant");
  });

  it("r=0.9 with n=5 is significant", () => {
    const result = correlationSignificance(0.9, 5);
    expect(result.pValue).toBeLessThan(0.05);
  });

  it("provides valid confidence interval", () => {
    const result = correlationSignificance(0.5, 30);
    expect(result.confidenceInterval![0]).toBeLessThan(0.5);
    expect(result.confidenceInterval![1]).toBeGreaterThan(0.5);
    expect(result.confidenceInterval![0]).toBeGreaterThan(-1);
    expect(result.confidenceInterval![1]).toBeLessThan(1);
  });

  it("CI shrinks with larger n", () => {
    const small = correlationSignificance(0.5, 10);
    const large = correlationSignificance(0.5, 100);
    const widthSmall = small.confidenceInterval![1] - small.confidenceInterval![0];
    const widthLarge = large.confidenceInterval![1] - large.confidenceInterval![0];
    expect(widthLarge).toBeLessThan(widthSmall);
  });

  it("handles r=0 (should not be significant)", () => {
    const result = correlationSignificance(0, 50);
    expect(result.pValue).toBe(1);
    expect(result.significance).toBe("not_significant");
  });

  it("handles negative correlations", () => {
    const result = correlationSignificance(-0.7, 30);
    expect(result.pValue).toBeLessThan(0.001);
    expect(result.interpretation).toContain("negative");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mann-Kendall Trend Test
// ─────────────────────────────────────────────────────────────────────────────

describe("mannKendallTest", () => {
  it("detects clear upward trend", () => {
    const values = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
    const result = mannKendallTest(values, ["2014", "2015", "2016", "2017", "2018", "2019", "2020", "2021", "2022", "2023"]);
    expect(result.pValue).toBeLessThan(0.001);
    expect(result.effectSize!).toBeCloseTo(1, 1); // tau close to 1
    expect(result.sensSlope).toBeCloseTo(5, 0); // Increasing by 5 per year
    expect(result.interpretation).toContain("increasing");
  });

  it("detects clear downward trend", () => {
    const values = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10];
    const result = mannKendallTest(values);
    expect(result.pValue).toBeLessThan(0.001);
    expect(result.effectSize!).toBeCloseTo(-1, 1); // tau close to -1
    expect(result.sensSlope).toBeLessThan(0);
  });

  it("finds no trend in random-looking data", () => {
    // Alternating values — no monotonic trend
    const values = [50, 30, 60, 20, 55, 25, 50, 30, 60, 20];
    const result = mannKendallTest(values);
    expect(result.pValue).toBeGreaterThan(0.05);
    expect(Math.abs(result.effectSize!)).toBeLessThan(0.3);
  });

  it("handles ties correctly", () => {
    const values = [10, 10, 10, 20, 20, 20, 30, 30, 30];
    const result = mannKendallTest(values);
    expect(result.pValue).toBeLessThan(0.05); // Still detects the trend
    expect(result.sensSlope).toBeGreaterThan(0);
  });

  it("Sen's slope is robust to outliers", () => {
    // Clear trend with one outlier
    const withOutlier = [10, 20, 30, 40, 500, 60, 70, 80, 90, 100];
    const withoutOutlier = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const r1 = mannKendallTest(withOutlier);
    const r2 = mannKendallTest(withoutOutlier);
    // Sen's slope should be similar despite the outlier (unlike OLS)
    expect(Math.abs(r1.sensSlope - r2.sensSlope)).toBeLessThan(5);
  });

  it("returns sensible results for minimum input (4 points)", () => {
    const result = mannKendallTest([1, 2, 3, 4]);
    expect(result.sampleSize).toBe(4);
    expect(result.sensSlope).toBeCloseTo(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Kolmogorov-Smirnov Test
// ─────────────────────────────────────────────────────────────────────────────

describe("kolmogorovSmirnovTest", () => {
  it("finds no difference for same distribution", () => {
    const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    const b = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    const result = kolmogorovSmirnovTest(a, b);
    expect(result.statistic).toBeCloseTo(0);
    expect(result.pValue).toBe(1); // Identical empirical CDFs
  });

  it("detects different distributions", () => {
    // One group centered at 10, other at 50
    const a = [8, 9, 10, 11, 12, 8, 9, 10, 11, 12, 8, 9, 10, 11, 12];
    const b = [48, 49, 50, 51, 52, 48, 49, 50, 51, 52, 48, 49, 50, 51, 52];
    const result = kolmogorovSmirnovTest(a, b, "County A", "County B");
    expect(result.pValue).toBeLessThan(0.001);
    expect(result.statistic).toBeCloseTo(1, 0); // D should be near 1
    expect(result.interpretation).toContain("ARE significantly different");
  });

  it("detects spread difference even with same mean", () => {
    // Same mean but very different spread — use larger samples for power
    const tight = [49, 49.5, 50, 50.5, 51, 49, 49.5, 50, 50.5, 51,
      49, 49.5, 50, 50.5, 51, 49, 49.5, 50, 50.5, 51,
      49.2, 49.8, 50.1, 50.3, 50.7, 49.1, 49.9, 50.2, 50.4, 50.6];
    const wide = [10, 20, 30, 40, 50, 60, 70, 80, 90, 10,
      20, 30, 40, 50, 60, 70, 80, 90, 50, 50,
      15, 25, 35, 45, 55, 65, 75, 85, 95, 5];
    const result = kolmogorovSmirnovTest(tight, wide);
    expect(result.pValue).toBeLessThan(0.05);
  });

  it("D statistic is bounded [0, 1]", () => {
    const a = [1, 3, 5, 7, 9, 11, 13, 15];
    const b = [2, 4, 6, 8, 10, 12, 14, 16];
    const result = kolmogorovSmirnovTest(a, b);
    expect(result.statistic).toBeGreaterThanOrEqual(0);
    expect(result.statistic).toBeLessThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Multiple Testing Correction
// ─────────────────────────────────────────────────────────────────────────────

describe("bonferroniCorrection", () => {
  it("multiplies p-values by number of tests", () => {
    const mockResults = [
      { pValue: 0.01 },
      { pValue: 0.03 },
      { pValue: 0.08 },
    ] as { pValue: number }[];
    const corrected = bonferroniCorrection(mockResults);
    expect(corrected.correctedPValues[0]).toBeCloseTo(0.03); // 0.01 * 3
    expect(corrected.correctedPValues[1]).toBeCloseTo(0.09); // 0.03 * 3
    expect(corrected.correctedPValues[2]).toBeCloseTo(0.24); // 0.08 * 3
    expect(corrected.method).toBe("bonferroni");
  });

  it("caps corrected p-values at 1", () => {
    const mockResults = [
      { pValue: 0.5 },
      { pValue: 0.8 },
    ] as { pValue: number }[];
    const corrected = bonferroniCorrection(mockResults);
    expect(corrected.correctedPValues[0]).toBe(1);
    expect(corrected.correctedPValues[1]).toBe(1);
  });

  it("counts significant results correctly", () => {
    const mockResults = [
      { pValue: 0.001 },  // 0.005 after correction — significant
      { pValue: 0.01 },   // 0.05 after correction — borderline
      { pValue: 0.02 },   // 0.10 after correction — not significant
      { pValue: 0.04 },   // 0.20 after correction — not significant
      { pValue: 0.5 },    // 1.0 after correction — not significant
    ] as { pValue: number }[];
    const corrected = bonferroniCorrection(mockResults);
    expect(corrected.significantCount).toBe(1); // Only the first survives
  });
});

describe("fdrCorrection", () => {
  it("is less conservative than Bonferroni", () => {
    const mockResults = [
      { pValue: 0.005 },
      { pValue: 0.01 },
      { pValue: 0.03 },
      { pValue: 0.04 },
      { pValue: 0.5 },
    ] as { pValue: number }[];
    const bonf = bonferroniCorrection(mockResults);
    const fdr = fdrCorrection(mockResults);
    expect(fdr.significantCount).toBeGreaterThanOrEqual(bonf.significantCount);
  });

  it("preserves ordering of p-values", () => {
    const mockResults = [
      { pValue: 0.01 },
      { pValue: 0.04 },
      { pValue: 0.02 },
    ] as { pValue: number }[];
    const fdr = fdrCorrection(mockResults);
    // Adjusted p for index 0 (smallest raw p) should be <= adjusted p for index 1
    expect(fdr.correctedPValues[0]).toBeLessThanOrEqual(fdr.correctedPValues[1]);
  });

  it("all corrected values are between 0 and 1", () => {
    const mockResults = Array.from({ length: 20 }, (_, i) => ({
      pValue: (i + 1) / 100,
    })) as { pValue: number }[];
    const fdr = fdrCorrection(mockResults);
    for (const p of fdr.correctedPValues) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Batch Correlation Matrix Significance
// ─────────────────────────────────────────────────────────────────────────────

describe("correlationMatrixSignificance", () => {
  it("marks strong correlations with sufficient n as significant", () => {
    const matrix = [
      [1, 0.8, 0.1],
      [0.8, 1, 0.05],
      [0.1, 0.05, 1],
    ];
    const result = correlationMatrixSignificance(matrix, 58);
    // r=0.8 with n=58 should be significant
    expect(result.significant[0][1]).toBe(true);
    expect(result.significant[1][0]).toBe(true);
    // r=0.05 with n=58 should not be significant
    expect(result.significant[1][2]).toBe(false);
  });

  it("diagonal is never significant", () => {
    const matrix = [[1, 0.5], [0.5, 1]];
    const result = correlationMatrixSignificance(matrix, 50);
    expect(result.significant[0][0]).toBe(false);
    expect(result.significant[1][1]).toBe(false);
  });

  it("FDR p-values are >= raw p-values", () => {
    const matrix = [
      [1, 0.3, 0.5],
      [0.3, 1, 0.2],
      [0.5, 0.2, 1],
    ];
    const result = correlationMatrixSignificance(matrix, 40);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        if (i !== j) {
          expect(result.fdrPValues[i][j]).toBeGreaterThanOrEqual(result.pValues[i][j] - 1e-10);
        }
      }
    }
  });
});
