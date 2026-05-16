import { useMemo } from "react";
import type { TestResult, MultipleTestResult } from "../lib/dashboard/hypothesis";
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
} from "../lib/dashboard/hypothesis";

// ─────────────────────────────────────────────────────────────────────────────
// Types for the "Compare Groups" panel
// ─────────────────────────────────────────────────────────────────────────────

export type StatTestType =
  | "chi-squared"
  | "t-test"
  | "anova"
  | "correlation"
  | "mann-kendall"
  | "ks-test";

export interface TestConfig {
  testType: StatTestType;
  /** For chi-squared / t-test / ANOVA: which dimension to group by */
  groupDimension?: string;
  /** Which specific groups to compare (e.g., ["Los Angeles", "San Francisco"]) */
  selectedGroups?: string[];
  /** Which measure to compare (e.g., "count", "fatality_rate") */
  measure?: string;
  /** For correlation: the two fields being correlated */
  correlationFields?: { x: string; y: string };
  /** For correlation: the r value and sample size */
  correlationR?: number;
  correlationN?: number;
  /** For Mann-Kendall: time-ordered values */
  timeSeriesValues?: number[];
  timeSeriesLabels?: string[];
  /** For KS test: two samples */
  sample1?: number[];
  sample2?: number[];
  sample1Label?: string;
  sample2Label?: string;
  /** For chi-squared: the contingency table */
  contingencyTable?: number[][];
  groupLabels?: string[];
  categoryLabels?: string[];
  /** For t-test: the two groups */
  group1?: number[];
  group2?: number[];
  group1Label?: string;
  group2Label?: string;
  /** For ANOVA: multiple groups */
  groups?: number[][];
  /** Multiple testing correction */
  correctionMethod?: "none" | "bonferroni" | "fdr";
}

export interface TestOutput {
  result: TestResult | null;
  multipleResult: MultipleTestResult | null;
  loading: boolean;
  error: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main hook: runs the selected test on provided data
// ─────────────────────────────────────────────────────────────────────────────

export function useHypothesisTest(config: TestConfig | null): TestOutput {
  return useMemo(() => {
    if (!config) {
      return { result: null, multipleResult: null, loading: false, error: null };
    }

    try {
      let result: TestResult | null = null;

      switch (config.testType) {
        case "chi-squared": {
          if (!config.contingencyTable || config.contingencyTable.length < 2) {
            return { result: null, multipleResult: null, loading: false, error: "Need a contingency table with at least 2 groups." };
          }
          result = chiSquaredTest(
            config.contingencyTable,
            config.groupLabels,
            config.categoryLabels,
          );
          break;
        }

        case "t-test": {
          if (!config.group1 || !config.group2) {
            return { result: null, multipleResult: null, loading: false, error: "Need two groups of data." };
          }
          result = twoSampleTTest(
            config.group1,
            config.group2,
            config.group1Label ?? "Group 1",
            config.group2Label ?? "Group 2",
          );
          break;
        }

        case "anova": {
          if (!config.groups || config.groups.length < 2) {
            return { result: null, multipleResult: null, loading: false, error: "Need at least 2 groups." };
          }
          result = oneWayAnova(config.groups, config.groupLabels);
          break;
        }

        case "correlation": {
          if (config.correlationR == null || config.correlationN == null) {
            return { result: null, multipleResult: null, loading: false, error: "Need r value and sample size." };
          }
          result = correlationSignificance(
            config.correlationR,
            config.correlationN,
            config.correlationFields?.x ?? "X",
            config.correlationFields?.y ?? "Y",
          );
          break;
        }

        case "mann-kendall": {
          if (!config.timeSeriesValues || config.timeSeriesValues.length < 4) {
            return { result: null, multipleResult: null, loading: false, error: "Need at least 4 time points." };
          }
          result = mannKendallTest(config.timeSeriesValues, config.timeSeriesLabels);
          break;
        }

        case "ks-test": {
          if (!config.sample1 || !config.sample2) {
            return { result: null, multipleResult: null, loading: false, error: "Need two samples." };
          }
          result = kolmogorovSmirnovTest(
            config.sample1,
            config.sample2,
            config.sample1Label ?? "Sample 1",
            config.sample2Label ?? "Sample 2",
          );
          break;
        }
      }

      return { result, multipleResult: null, loading: false, error: null };
    } catch (e) {
      return { result: null, multipleResult: null, loading: false, error: String(e) };
    }
  }, [config]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook for batch testing with multiple-testing correction
// ─────────────────────────────────────────────────────────────────────────────

export function useMultipleTests(
  results: TestResult[],
  method: "bonferroni" | "fdr" = "fdr",
): MultipleTestResult | null {
  return useMemo(() => {
    if (results.length === 0) return null;
    return method === "bonferroni"
      ? bonferroniCorrection(results)
      : fdrCorrection(results);
  }, [results, method]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook for correlation matrix p-values (integrates with CorrelationMatrix.tsx)
// ─────────────────────────────────────────────────────────────────────────────

export function useCorrelationSignificance(
  matrix: number[][] | undefined,
  countyCount: number,
) {
  return useMemo(() => {
    if (!matrix || matrix.length === 0 || countyCount < 4) {
      return null;
    }
    return correlationMatrixSignificance(matrix, countyCount);
  }, [matrix, countyCount]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Descriptive labels for UI
// ─────────────────────────────────────────────────────────────────────────────

export const TEST_DESCRIPTIONS: Record<StatTestType, {
  name: string;
  question: string;
  when: string;
}> = {
  "chi-squared": {
    name: "Chi-Squared Test of Independence",
    question: "Are the category distributions different between groups?",
    when: "Comparing proportions (e.g., severity breakdown) across counties or time periods",
  },
  "t-test": {
    name: "Welch's Two-Sample t-Test",
    question: "Is the average different between two groups?",
    when: "Comparing means (e.g., weekday vs weekend crash counts)",
  },
  "anova": {
    name: "One-Way ANOVA",
    question: "Do means differ across multiple groups?",
    when: "Comparing 3+ groups (e.g., crash rates by age bracket)",
  },
  "correlation": {
    name: "Pearson Correlation Significance",
    question: "Is this correlation statistically real?",
    when: "Testing if an observed r value is different from zero",
  },
  "mann-kendall": {
    name: "Mann-Kendall Trend Test",
    question: "Is there a significant upward/downward trend over time?",
    when: "Testing for monotonic trends in yearly data (non-parametric, robust to outliers)",
  },
  "ks-test": {
    name: "Kolmogorov-Smirnov Test",
    question: "Do two groups have different overall distributions?",
    when: "Comparing entire distributions (sensitive to shape/spread, not just mean)",
  },
};
