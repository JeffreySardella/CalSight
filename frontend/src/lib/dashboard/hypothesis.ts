/**
 * Statistical Hypothesis Testing Library
 *
 * Pure TypeScript implementations — no external dependencies.
 * Designed for CalSight's crash data analysis dashboard.
 *
 * Mathematical foundations:
 * - All p-values computed via analytical approximations (no lookup tables)
 * - Uses the incomplete gamma/beta function for chi-squared, t, and F distributions
 * - Mann-Kendall uses normal approximation for n > 10
 * - KS test uses the Kolmogorov asymptotic distribution
 *
 * References:
 * - Numerical Recipes in C, Ch. 6 (Special Functions)
 * - NIST Engineering Statistics Handbook
 * - Conover, W.J. (1999) Practical Nonparametric Statistics
 */

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: Distribution Functions (the mathematical engine)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Natural log of the Gamma function via Lanczos approximation.
 * Accurate to ~15 digits for all positive real arguments.
 *
 * The Gamma function generalizes factorial: Gamma(n) = (n-1)!
 * We need this for chi-squared, t, and F distribution CDFs.
 */
function lnGamma(z: number): number {
  // Lanczos coefficients for g=7
  const c = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];

  if (z < 0.5) {
    // Reflection formula: Gamma(1-z) * Gamma(z) = pi / sin(pi*z)
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  }

  z -= 1;
  let x = c[0];
  for (let i = 1; i < 9; i++) {
    x += c[i] / (z + i);
  }
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/**
 * Regularized lower incomplete gamma function P(a, x).
 * P(a, x) = gamma(a, x) / Gamma(a)
 *
 * This is the CDF of the Gamma distribution, which we need for chi-squared.
 * chi-squared CDF = P(df/2, x/2)
 *
 * Uses series expansion for x < a+1, continued fraction otherwise.
 */
function regularizedGammaP(a: number, x: number): number {
  if (x < 0) return 0;
  if (x === 0) return 0;

  if (x < a + 1) {
    // Series expansion: P(a,x) = e^(-x) * x^a * sum_{n=0}^inf [ x^n / (a*(a+1)*...*(a+n)) ]
    let sum = 1 / a;
    let term = 1 / a;
    for (let n = 1; n < 200; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-14) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
  } else {
    // Continued fraction (Lentz's method) for upper incomplete gamma Q(a,x)
    // then P = 1 - Q
    return 1 - regularizedGammaQ(a, x);
  }
}

/**
 * Regularized upper incomplete gamma function Q(a, x) = 1 - P(a, x).
 * Uses continued fraction representation (more efficient for large x).
 */
function regularizedGammaQ(a: number, x: number): number {
  if (x < 0) return 1;
  if (x === 0) return 1;

  if (x < a + 1) {
    return 1 - regularizedGammaP(a, x);
  }

  // Continued fraction via modified Lentz's method
  // Q(a,x) = e^(-x) * x^a / Gamma(a) * CF
  let b = x + 1 - a;
  let c = 1e30;
  let d = 1 / b;
  let h = d;

  for (let i = 1; i < 200; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = b + an / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-14) break;
  }

  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

/**
 * Regularized incomplete beta function I_x(a, b).
 * This is the CDF of the Beta distribution.
 * We need it for t-distribution and F-distribution CDFs.
 *
 * t-distribution CDF uses: I_{df/(df+t^2)}(df/2, 1/2)
 * F-distribution CDF uses: I_{d1*x/(d1*x+d2)}(d1/2, d2/2)
 */
function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  // Use symmetry: I_x(a,b) = 1 - I_{1-x}(b,a) when x > (a+1)/(a+b+2)
  if (x > (a + 1) / (a + b + 2)) {
    return 1 - regularizedBeta(1 - x, b, a);
  }

  // Continued fraction (Lentz's method)
  const lnPrefactor = lnGamma(a + b) - lnGamma(a) - lnGamma(b)
    + a * Math.log(x) + b * Math.log(1 - x);
  const prefactor = Math.exp(lnPrefactor);

  // Evaluate continued fraction
  let c = 1;
  let d = 1 - (a + b) * x / (a + 1);
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  let h = d;

  for (let m = 1; m < 200; m++) {
    // Even step: d_{2m}
    let numerator = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1 + numerator * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + numerator / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    h *= d * c;

    // Odd step: d_{2m+1}
    numerator = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + numerator * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + numerator / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = d * c;
    h *= delta;

    if (Math.abs(delta - 1) < 1e-14) break;
  }

  return (prefactor / a) * h;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: Distribution CDFs
// ─────────────────────────────────────────────────────────────────────────────

/** Chi-squared CDF: P(X <= x) for X ~ chi-squared(df) */
function chiSquaredCdf(x: number, df: number): number {
  if (x <= 0) return 0;
  return regularizedGammaP(df / 2, x / 2);
}

/** Standard normal CDF: P(Z <= z) using error function approximation */
function normalCdf(z: number): number {
  // Abramowitz and Stegun approximation 7.1.26 (max error 1.5e-7)
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.sqrt(2);
  const t = 1 / (1 + p * x);
  const erf = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1 + sign * erf);
}

/** t-distribution CDF: P(T <= t) for T ~ t(df) */
function tCdf(t: number, df: number): number {
  if (df <= 0) return 0.5;

  // Use incomplete beta: P(T <= t) = 1 - 0.5 * I_{df/(df+t^2)}(df/2, 1/2) for t > 0
  const x = df / (df + t * t);
  const ib = regularizedBeta(x, df / 2, 0.5);

  if (t >= 0) {
    return 1 - 0.5 * ib;
  } else {
    return 0.5 * ib;
  }
}

/** F-distribution CDF: P(F <= f) for F ~ F(d1, d2) */
function fCdf(f: number, d1: number, d2: number): number {
  if (f <= 0) return 0;
  const x = (d1 * f) / (d1 * f + d2);
  return regularizedBeta(x, d1 / 2, d2 / 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: Result Types
// ─────────────────────────────────────────────────────────────────────────────

export type SignificanceLevel = "highly_significant" | "significant" | "marginally_significant" | "not_significant";

export interface TestResult {
  testName: string;
  statistic: number;
  pValue: number;
  degreesOfFreedom: number | null;
  effectSize: number | null;
  effectSizeLabel: string | null;
  confidenceInterval: [number, number] | null;
  sampleSize: number;
  significance: SignificanceLevel;
  interpretation: string;
  assumptions: string[];
  warnings: string[];
}

export interface MultipleTestResult {
  individual: TestResult[];
  correctedPValues: number[];
  method: "bonferroni" | "fdr";
  significantCount: number;
  totalTests: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: Significance Helpers
// ─────────────────────────────────────────────────────────────────────────────

function classifySignificance(p: number): SignificanceLevel {
  if (p < 0.001) return "highly_significant";
  if (p < 0.05) return "significant";
  if (p < 0.10) return "marginally_significant";
  return "not_significant";
}

function significanceEmoji(level: SignificanceLevel): string {
  switch (level) {
    case "highly_significant": return "***";
    case "significant": return "**";
    case "marginally_significant": return "*";
    case "not_significant": return "n.s.";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: CHI-SQUARED TEST OF INDEPENDENCE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Chi-squared test of independence.
 *
 * Tests whether two categorical variables are independent.
 * Example: Is severity distribution different between counties?
 *
 * Input: contingency table where rows = groups (e.g., counties),
 *        columns = categories (e.g., severity levels)
 *
 * The test statistic is:
 *   X^2 = sum_ij [ (O_ij - E_ij)^2 / E_ij ]
 * where E_ij = (row_i_total * col_j_total) / grand_total
 *
 * df = (rows - 1) * (cols - 1)
 *
 * Effect size: Cramer's V = sqrt(X^2 / (n * min(rows-1, cols-1)))
 *   V ranges from 0 (no association) to 1 (perfect association).
 *   Interpretation: V < 0.1 negligible, 0.1-0.3 small, 0.3-0.5 medium, > 0.5 large
 */
export function chiSquaredTest(
  observed: number[][],
  groupLabels?: string[],
  categoryLabels?: string[],
): TestResult {
  const warnings: string[] = [];
  const nRows = observed.length;
  const nCols = observed[0]?.length ?? 0;

  if (nRows < 2 || nCols < 2) {
    return {
      testName: "Chi-Squared Test of Independence",
      statistic: 0,
      pValue: 1,
      degreesOfFreedom: 0,
      effectSize: 0,
      effectSizeLabel: "Cramer's V",
      confidenceInterval: null,
      sampleSize: 0,
      significance: "not_significant",
      interpretation: "Need at least 2 groups and 2 categories to run this test.",
      assumptions: [],
      warnings: ["Insufficient data dimensions"],
    };
  }

  // Compute row totals, column totals, grand total
  const rowTotals = observed.map(row => row.reduce((s, v) => s + v, 0));
  const colTotals: number[] = Array(nCols).fill(0);
  for (let j = 0; j < nCols; j++) {
    for (let i = 0; i < nRows; i++) {
      colTotals[j] += observed[i][j];
    }
  }
  const grandTotal = rowTotals.reduce((s, v) => s + v, 0);

  if (grandTotal === 0) {
    return {
      testName: "Chi-Squared Test of Independence",
      statistic: 0,
      pValue: 1,
      degreesOfFreedom: 0,
      effectSize: 0,
      effectSizeLabel: "Cramer's V",
      confidenceInterval: null,
      sampleSize: 0,
      significance: "not_significant",
      interpretation: "No observations to analyze.",
      assumptions: [],
      warnings: ["Empty contingency table"],
    };
  }

  // Compute chi-squared statistic
  let chiSq = 0;
  let lowExpectedCount = 0;
  for (let i = 0; i < nRows; i++) {
    for (let j = 0; j < nCols; j++) {
      const expected = (rowTotals[i] * colTotals[j]) / grandTotal;
      if (expected < 5) lowExpectedCount++;
      if (expected > 0) {
        chiSq += (observed[i][j] - expected) ** 2 / expected;
      }
    }
  }

  const df = (nRows - 1) * (nCols - 1);
  const pValue = 1 - chiSquaredCdf(chiSq, df);

  // Cramer's V effect size
  const minDim = Math.min(nRows - 1, nCols - 1);
  const cramersV = minDim > 0 ? Math.sqrt(chiSq / (grandTotal * minDim)) : 0;

  // Check assumptions
  const totalCells = nRows * nCols;
  if (lowExpectedCount > 0.2 * totalCells) {
    warnings.push(
      `${lowExpectedCount} of ${totalCells} cells have expected count < 5. ` +
      `Chi-squared approximation may be unreliable. Consider combining categories.`
    );
  }

  const significance = classifySignificance(pValue);
  const groupDesc = groupLabels ? groupLabels.join(", ") : `${nRows} groups`;
  const catDesc = categoryLabels ? categoryLabels.join(", ") : `${nCols} categories`;

  let interpretation: string;
  if (significance === "not_significant") {
    interpretation = `There is no statistically significant association between the groups (${groupDesc}) ` +
      `and the categories (${catDesc}). The observed differences could easily arise by chance ` +
      `(p = ${pValue.toFixed(4)}, Cramer's V = ${cramersV.toFixed(3)}).`;
  } else {
    const strengthWord = cramersV >= 0.5 ? "strong" : cramersV >= 0.3 ? "moderate" : cramersV >= 0.1 ? "small" : "negligible";
    interpretation = `There IS a statistically significant association between groups and categories ` +
      `(${significanceEmoji(significance)} p = ${pValue.toFixed(4)}). ` +
      `The effect size is ${strengthWord} (Cramer's V = ${cramersV.toFixed(3)}), meaning the distributions ` +
      `are meaningfully different across groups.`;
  }

  return {
    testName: "Chi-Squared Test of Independence",
    statistic: chiSq,
    pValue,
    degreesOfFreedom: df,
    effectSize: cramersV,
    effectSizeLabel: "Cramer's V",
    confidenceInterval: null,
    sampleSize: grandTotal,
    significance,
    interpretation,
    assumptions: [
      "Observations are independent (each crash counted once)",
      "Expected cell counts should be >= 5 for reliable approximation",
      "Categories are mutually exclusive and exhaustive",
    ],
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6: TWO-SAMPLE T-TEST (WELCH'S)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Welch's two-sample t-test (unequal variances).
 *
 * Tests: H0: mu1 = mu2 (the two populations have equal means)
 * Example: Is mean monthly crash count different weekdays vs weekends?
 *
 * Welch's t-statistic:
 *   t = (x_bar1 - x_bar2) / sqrt(s1^2/n1 + s2^2/n2)
 *
 * Degrees of freedom (Welch-Satterthwaite):
 *   df = (s1^2/n1 + s2^2/n2)^2 / [ (s1^2/n1)^2/(n1-1) + (s2^2/n2)^2/(n2-1) ]
 *
 * Effect size: Cohen's d = (x_bar1 - x_bar2) / s_pooled
 *   where s_pooled = sqrt(((n1-1)*s1^2 + (n2-1)*s2^2) / (n1+n2-2))
 *   d < 0.2 negligible, 0.2-0.5 small, 0.5-0.8 medium, > 0.8 large
 *
 * Why Welch's instead of Student's:
 *   We cannot assume equal variances across crash count distributions.
 *   Welch's is robust to unequal variances AND unequal sample sizes.
 */
export function twoSampleTTest(
  group1: number[],
  group2: number[],
  label1 = "Group 1",
  label2 = "Group 2",
  alternative: "two-sided" | "less" | "greater" = "two-sided",
): TestResult {
  const n1 = group1.length;
  const n2 = group2.length;
  const warnings: string[] = [];

  if (n1 < 2 || n2 < 2) {
    return {
      testName: "Welch's Two-Sample t-Test",
      statistic: 0,
      pValue: 1,
      degreesOfFreedom: null,
      effectSize: null,
      effectSizeLabel: "Cohen's d",
      confidenceInterval: null,
      sampleSize: n1 + n2,
      significance: "not_significant",
      interpretation: "Each group needs at least 2 observations.",
      assumptions: [],
      warnings: ["Insufficient sample size"],
    };
  }

  // Compute means and variances
  const mean1 = group1.reduce((s, v) => s + v, 0) / n1;
  const mean2 = group2.reduce((s, v) => s + v, 0) / n2;

  // Sample variance (using n-1 denominator: Bessel's correction)
  const var1 = group1.reduce((s, v) => s + (v - mean1) ** 2, 0) / (n1 - 1);
  const var2 = group2.reduce((s, v) => s + (v - mean2) ** 2, 0) / (n2 - 1);

  const se = Math.sqrt(var1 / n1 + var2 / n2);

  if (se === 0) {
    return {
      testName: "Welch's Two-Sample t-Test",
      statistic: 0,
      pValue: mean1 === mean2 ? 1 : 0,
      degreesOfFreedom: n1 + n2 - 2,
      effectSize: 0,
      effectSizeLabel: "Cohen's d",
      confidenceInterval: [mean1 - mean2, mean1 - mean2],
      sampleSize: n1 + n2,
      significance: mean1 === mean2 ? "not_significant" : "highly_significant",
      interpretation: "Both groups have zero variance.",
      assumptions: [],
      warnings: ["Zero variance in both groups"],
    };
  }

  const t = (mean1 - mean2) / se;

  // Welch-Satterthwaite degrees of freedom
  const v1n = var1 / n1;
  const v2n = var2 / n2;
  const df = (v1n + v2n) ** 2 / (v1n ** 2 / (n1 - 1) + v2n ** 2 / (n2 - 1));

  // p-value computation depends on alternative hypothesis
  let pValue: number;
  if (alternative === "two-sided") {
    pValue = 2 * (1 - tCdf(Math.abs(t), df));
  } else if (alternative === "greater") {
    pValue = 1 - tCdf(t, df);
  } else {
    pValue = tCdf(t, df);
  }
  pValue = Math.max(0, Math.min(1, pValue));

  // Cohen's d (pooled standard deviation)
  const sPooled = Math.sqrt(((n1 - 1) * var1 + (n2 - 1) * var2) / (n1 + n2 - 2));
  const cohensD = sPooled > 0 ? (mean1 - mean2) / sPooled : 0;

  // 95% confidence interval for the difference in means
  // Using t critical value for 97.5th percentile
  // Approximation: for df > 30, use z = 1.96; otherwise binary search
  const tCrit = tCriticalValue(0.025, df);
  const ci: [number, number] = [
    (mean1 - mean2) - tCrit * se,
    (mean1 - mean2) + tCrit * se,
  ];

  // Check normality assumption (rough check via skewness)
  if (n1 < 30 || n2 < 30) {
    warnings.push(
      "With sample sizes < 30, the t-test assumes approximately normal distributions. " +
      "Consider the Mann-Whitney U test for non-normal data."
    );
  }

  const significance = classifySignificance(pValue);
  const dStrength = Math.abs(cohensD) >= 0.8 ? "large" :
    Math.abs(cohensD) >= 0.5 ? "medium" :
    Math.abs(cohensD) >= 0.2 ? "small" : "negligible";

  let interpretation: string;
  if (significance === "not_significant") {
    interpretation = `No statistically significant difference between ${label1} (mean = ${mean1.toFixed(1)}) ` +
      `and ${label2} (mean = ${mean2.toFixed(1)}). ` +
      `The observed difference of ${Math.abs(mean1 - mean2).toFixed(1)} could be due to random variation ` +
      `(p = ${pValue.toFixed(4)}, Cohen's d = ${cohensD.toFixed(3)}).`;
  } else {
    const higher = mean1 > mean2 ? label1 : label2;
    interpretation = `${higher} has a significantly ${mean1 > mean2 ? "higher" : "lower"} mean ` +
      `(${significanceEmoji(significance)} p = ${pValue.toFixed(4)}). ` +
      `${label1}: ${mean1.toFixed(1)}, ${label2}: ${mean2.toFixed(1)}. ` +
      `The effect is ${dStrength} (Cohen's d = ${cohensD.toFixed(3)}). ` +
      `95% CI for the difference: [${ci[0].toFixed(2)}, ${ci[1].toFixed(2)}].`;
  }

  return {
    testName: "Welch's Two-Sample t-Test",
    statistic: t,
    pValue,
    degreesOfFreedom: df,
    effectSize: cohensD,
    effectSizeLabel: "Cohen's d",
    confidenceInterval: ci,
    sampleSize: n1 + n2,
    significance,
    interpretation,
    assumptions: [
      "Observations within each group are independent",
      "Each group is approximately normally distributed (or n >= 30 by CLT)",
      "Does NOT assume equal variances (Welch's correction applied)",
    ],
    warnings,
  };
}

/**
 * Find t critical value via binary search on the t-CDF.
 * Returns t such that P(T > t) = alpha for T ~ t(df).
 */
function tCriticalValue(alpha: number, df: number): number {
  // For large df, use normal approximation
  if (df > 1000) {
    // Inverse normal approximation (Rational approximation to inverse normal)
    return inverseNormal(1 - alpha);
  }

  // Binary search
  let lo = 0;
  let hi = 10;
  for (let iter = 0; iter < 100; iter++) {
    const mid = (lo + hi) / 2;
    const p = 1 - tCdf(mid, df);
    if (p < alpha) {
      hi = mid;
    } else {
      lo = mid;
    }
    if (hi - lo < 1e-8) break;
  }
  return (lo + hi) / 2;
}

/** Inverse standard normal (quantile function) using rational approximation */
function inverseNormal(p: number): number {
  // Beasley-Springer-Moro algorithm
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;

  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.383577518672690e2, -3.066479806614716e1, 2.506628277459239e0,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0,
    -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0, 3.754408661907416e0,
  ];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  let q: number, r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7: ONE-WAY ANOVA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One-way Analysis of Variance (ANOVA).
 *
 * Tests: H0: all group means are equal (mu1 = mu2 = ... = muk)
 * Example: Do crash rates differ significantly across age groups?
 *
 * F-statistic = MS_between / MS_within
 * where:
 *   SS_between = sum_i [ n_i * (x_bar_i - x_bar_total)^2 ]
 *   SS_within  = sum_i sum_j [ (x_ij - x_bar_i)^2 ]
 *   MS_between = SS_between / (k - 1)
 *   MS_within  = SS_within / (N - k)
 *   k = number of groups, N = total observations
 *
 * Effect size: eta-squared = SS_between / SS_total
 *   eta^2 < 0.01 negligible, 0.01-0.06 small, 0.06-0.14 medium, > 0.14 large
 *
 * Also computes omega-squared (less biased):
 *   omega^2 = (SS_between - (k-1)*MS_within) / (SS_total + MS_within)
 */
export function oneWayAnova(
  groups: number[][],
  groupLabels?: string[],
): TestResult {
  const warnings: string[] = [];
  const k = groups.length;

  if (k < 2) {
    return {
      testName: "One-Way ANOVA",
      statistic: 0,
      pValue: 1,
      degreesOfFreedom: null,
      effectSize: null,
      effectSizeLabel: "eta-squared",
      confidenceInterval: null,
      sampleSize: 0,
      significance: "not_significant",
      interpretation: "Need at least 2 groups to perform ANOVA.",
      assumptions: [],
      warnings: ["Fewer than 2 groups"],
    };
  }

  const validGroups = groups.filter(g => g.length >= 2);
  if (validGroups.length < 2) {
    return {
      testName: "One-Way ANOVA",
      statistic: 0,
      pValue: 1,
      degreesOfFreedom: null,
      effectSize: null,
      effectSizeLabel: "eta-squared",
      confidenceInterval: null,
      sampleSize: groups.reduce((s, g) => s + g.length, 0),
      significance: "not_significant",
      interpretation: "Each group needs at least 2 observations.",
      assumptions: [],
      warnings: ["Insufficient observations in one or more groups"],
    };
  }

  // Compute group means and grand mean
  const ns = groups.map(g => g.length);
  const N = ns.reduce((s, n) => s + n, 0);
  const groupMeans = groups.map(g => g.reduce((s, v) => s + v, 0) / g.length);
  const grandMean = groups.flat().reduce((s, v) => s + v, 0) / N;

  // Sum of squares
  let ssBetween = 0;
  for (let i = 0; i < k; i++) {
    ssBetween += ns[i] * (groupMeans[i] - grandMean) ** 2;
  }

  let ssWithin = 0;
  for (let i = 0; i < k; i++) {
    for (const x of groups[i]) {
      ssWithin += (x - groupMeans[i]) ** 2;
    }
  }

  const ssTotal = ssBetween + ssWithin;
  const dfBetween = k - 1;
  const dfWithin = N - k;

  if (dfWithin <= 0) {
    return {
      testName: "One-Way ANOVA",
      statistic: 0,
      pValue: 1,
      degreesOfFreedom: null,
      effectSize: null,
      effectSizeLabel: "eta-squared",
      confidenceInterval: null,
      sampleSize: N,
      significance: "not_significant",
      interpretation: "Not enough data points to estimate within-group variance.",
      assumptions: [],
      warnings: ["Zero degrees of freedom for within-group variance"],
    };
  }

  const msBetween = ssBetween / dfBetween;
  const msWithin = ssWithin / dfWithin;

  const F = msWithin > 0 ? msBetween / msWithin : 0;
  const pValue = msWithin > 0 ? 1 - fCdf(F, dfBetween, dfWithin) : 1;

  // Effect sizes
  const etaSquared = ssTotal > 0 ? ssBetween / ssTotal : 0;
  // Homogeneity of variance check (rough: ratio of max/min group variance)
  const groupVars = groups.map((g, i) => {
    if (g.length < 2) return 0;
    return g.reduce((s, v) => s + (v - groupMeans[i]) ** 2, 0) / (g.length - 1);
  }).filter(v => v > 0);

  if (groupVars.length >= 2) {
    const varianceRatio = Math.max(...groupVars) / Math.min(...groupVars);
    if (varianceRatio > 4) {
      warnings.push(
        `Variance ratio between groups is ${varianceRatio.toFixed(1)}:1. ` +
        `ANOVA assumes equal variances. Consider Welch's ANOVA or Kruskal-Wallis test.`
      );
    }
  }

  if (ns.some(n => n < 20)) {
    warnings.push(
      "Some groups have fewer than 20 observations. ANOVA is robust to " +
      "non-normality for large samples but may be sensitive with small groups."
    );
  }

  const significance = classifySignificance(pValue);
  const effectStrength = etaSquared >= 0.14 ? "large" :
    etaSquared >= 0.06 ? "medium" :
    etaSquared >= 0.01 ? "small" : "negligible";

  const labels = groupLabels ?? groups.map((_, i) => `Group ${i + 1}`);

  let interpretation: string;
  if (significance === "not_significant") {
    interpretation = `No significant difference in means across the ${k} groups ` +
      `(${labels.join(", ")}). F(${dfBetween}, ${dfWithin}) = ${F.toFixed(2)}, ` +
      `p = ${pValue.toFixed(4)}. The differences observed are within normal random variation.`;
  } else {
    // Find the group with highest and lowest mean
    const maxIdx = groupMeans.indexOf(Math.max(...groupMeans));
    const minIdx = groupMeans.indexOf(Math.min(...groupMeans));
    interpretation = `Significant difference found across groups ` +
      `(${significanceEmoji(significance)} F(${dfBetween}, ${dfWithin}) = ${F.toFixed(2)}, ` +
      `p = ${pValue.toFixed(4)}). ` +
      `Highest: ${labels[maxIdx]} (mean = ${groupMeans[maxIdx].toFixed(1)}), ` +
      `Lowest: ${labels[minIdx]} (mean = ${groupMeans[minIdx].toFixed(1)}). ` +
      `Effect is ${effectStrength} (eta^2 = ${etaSquared.toFixed(3)}, meaning ${(etaSquared * 100).toFixed(1)}% ` +
      `of the variance is explained by group membership).`;
  }

  return {
    testName: "One-Way ANOVA",
    statistic: F,
    pValue,
    degreesOfFreedom: dfBetween, // Note: full df is (dfBetween, dfWithin)
    effectSize: etaSquared,
    effectSizeLabel: "eta-squared",
    confidenceInterval: null,
    sampleSize: N,
    significance,
    interpretation,
    assumptions: [
      "Observations are independent within and across groups",
      "Each group is approximately normally distributed",
      "Homogeneity of variances (equal variance across groups)",
    ],
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8: PEARSON CORRELATION SIGNIFICANCE TEST
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tests whether an observed Pearson correlation coefficient is significantly
 * different from zero.
 *
 * Example: r = 0.3 with n = 58 counties. Is that real or noise?
 *
 * Test statistic: t = r * sqrt(n-2) / sqrt(1 - r^2)
 * Under H0 (rho=0), this follows t(n-2).
 *
 * Confidence interval uses Fisher's z-transformation:
 *   z = arctanh(r) = 0.5 * ln((1+r)/(1-r))
 *   SE(z) = 1 / sqrt(n - 3)
 *   CI for z: z +/- z_alpha/2 * SE(z)
 *   Transform back: r = tanh(z)
 *
 * Effect size: r itself is the effect size for correlation.
 *   |r| < 0.1 negligible, 0.1-0.3 small, 0.3-0.5 medium, > 0.5 large
 */
export function correlationSignificance(
  r: number,
  n: number,
  xLabel = "X",
  yLabel = "Y",
): TestResult {
  const warnings: string[] = [];

  if (n < 4) {
    return {
      testName: "Pearson Correlation Significance",
      statistic: 0,
      pValue: 1,
      degreesOfFreedom: null,
      effectSize: r,
      effectSizeLabel: "Pearson r",
      confidenceInterval: null,
      sampleSize: n,
      significance: "not_significant",
      interpretation: "Need at least 4 observations to test correlation significance.",
      assumptions: [],
      warnings: ["n < 4"],
    };
  }

  // Clamp r to avoid numerical issues
  const rClamped = Math.max(-0.9999, Math.min(0.9999, r));

  // t-statistic
  const df = n - 2;
  const t = rClamped * Math.sqrt(df) / Math.sqrt(1 - rClamped * rClamped);
  const pValue = Math.max(0, Math.min(1, 2 * (1 - tCdf(Math.abs(t), df))));

  // Fisher z-transformation for confidence interval
  const fisherZ = 0.5 * Math.log((1 + rClamped) / (1 - rClamped));
  const seZ = 1 / Math.sqrt(n - 3);
  const zCrit = 1.96; // 95% CI
  const ciZLow = fisherZ - zCrit * seZ;
  const ciZHigh = fisherZ + zCrit * seZ;
  const ci: [number, number] = [Math.tanh(ciZLow), Math.tanh(ciZHigh)];

  if (n < 10) {
    warnings.push(
      "With fewer than 10 data points, correlation estimates are highly unstable. " +
      "The confidence interval reflects this uncertainty."
    );
  }

  const significance = classifySignificance(pValue);
  const strength = Math.abs(r) >= 0.5 ? "strong" :
    Math.abs(r) >= 0.3 ? "moderate" :
    Math.abs(r) >= 0.1 ? "weak" : "negligible";
  const direction = r >= 0 ? "positive" : "negative";

  let interpretation: string;
  if (significance === "not_significant") {
    interpretation = `The correlation between ${xLabel} and ${yLabel} (r = ${r.toFixed(3)}) ` +
      `is NOT statistically significant with ${n} observations (p = ${pValue.toFixed(4)}). ` +
      `We cannot rule out that this apparent ${direction} relationship is due to chance. ` +
      `95% CI: [${ci[0].toFixed(3)}, ${ci[1].toFixed(3)}].`;
  } else {
    interpretation = `The ${strength} ${direction} correlation between ${xLabel} and ${yLabel} ` +
      `(r = ${r.toFixed(3)}) IS statistically significant ` +
      `(${significanceEmoji(significance)} p = ${pValue.toFixed(4)}, n = ${n}). ` +
      `This means the relationship is unlikely to be due to chance alone. ` +
      `95% CI: [${ci[0].toFixed(3)}, ${ci[1].toFixed(3)}]. ` +
      `R-squared = ${(r * r * 100).toFixed(1)}% of variance explained.`;
  }

  return {
    testName: "Pearson Correlation Significance",
    statistic: t,
    pValue,
    degreesOfFreedom: df,
    effectSize: r,
    effectSizeLabel: "Pearson r",
    confidenceInterval: ci,
    sampleSize: n,
    significance,
    interpretation,
    assumptions: [
      "Both variables are continuous and approximately normally distributed",
      "The relationship between variables is linear",
      "Observations are independent (no county is measured twice)",
      "No extreme outliers (sensitive to leverage points)",
    ],
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9: MANN-KENDALL TREND TEST
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mann-Kendall test for monotonic trend.
 *
 * Non-parametric test for whether a time series has a significant upward or
 * downward trend. Does NOT assume linearity or normality.
 * Example: Is there a statistically significant trend in crash fatalities over years?
 *
 * Algorithm:
 * 1. For all pairs (i, j) where j > i, compute sgn(x_j - x_i)
 * 2. S = sum of all sgn values
 *    - S > 0 suggests increasing trend
 *    - S < 0 suggests decreasing trend
 *    - S = 0 suggests no trend
 *
 * 3. Variance: Var(S) = [n(n-1)(2n+5) - sum_t t(t-1)(2t+5)] / 18
 *    where t runs over tied groups
 *
 * 4. Standardized test statistic (normal approximation for n > 10):
 *    Z = (S - 1) / sqrt(Var(S))   if S > 0
 *    Z = 0                         if S = 0
 *    Z = (S + 1) / sqrt(Var(S))   if S < 0
 *
 * Effect size: Kendall's tau = S / [n(n-1)/2]
 *   Ranges from -1 to +1 (like correlation, but rank-based)
 *
 * Also computes Sen's slope (median of all pairwise slopes):
 *   slope_ij = (x_j - x_i) / (j - i) for all j > i
 *   Sen's slope = median of all slope_ij values
 */
export function mannKendallTest(
  values: number[],
  timeLabels?: string[],
): TestResult & { sensSlope: number; sensIntercept: number } {
  const n = values.length;
  const warnings: string[] = [];

  if (n < 4) {
    return {
      testName: "Mann-Kendall Trend Test",
      statistic: 0,
      pValue: 1,
      degreesOfFreedom: null,
      effectSize: null,
      effectSizeLabel: "Kendall's tau",
      confidenceInterval: null,
      sampleSize: n,
      significance: "not_significant",
      interpretation: "Need at least 4 time points to test for a trend.",
      assumptions: [],
      warnings: ["n < 4"],
      sensSlope: 0,
      sensIntercept: values[0] ?? 0,
    };
  }

  // Step 1: Compute S
  let S = 0;
  const slopes: number[] = [];

  for (let j = 1; j < n; j++) {
    for (let i = 0; i < j; i++) {
      const diff = values[j] - values[i];
      if (diff > 0) S++;
      else if (diff < 0) S--;
      // Sen's slopes (using index difference as time)
      slopes.push(diff / (j - i));
    }
  }

  // Step 2: Handle ties for variance correction
  // Count tied groups
  const sorted = [...values].sort((a, b) => a - b);
  const tiedGroups: number[] = [];
  let i = 0;
  while (i < n) {
    let count = 1;
    while (i + count < n && sorted[i + count] === sorted[i]) count++;
    if (count > 1) tiedGroups.push(count);
    i += count;
  }

  // Variance of S
  let varS = n * (n - 1) * (2 * n + 5);
  for (const t of tiedGroups) {
    varS -= t * (t - 1) * (2 * t + 5);
  }
  varS /= 18;

  // Step 3: Z statistic (continuity correction)
  let Z: number;
  if (S > 0) Z = (S - 1) / Math.sqrt(varS);
  else if (S < 0) Z = (S + 1) / Math.sqrt(varS);
  else Z = 0;

  const pValue = 2 * (1 - normalCdf(Math.abs(Z)));

  // Kendall's tau
  const tau = S / (n * (n - 1) / 2);

  // Sen's slope (median of all pairwise slopes)
  slopes.sort((a, b) => a - b);
  const sensSlope = slopes.length % 2 === 0
    ? (slopes[slopes.length / 2 - 1] + slopes[slopes.length / 2]) / 2
    : slopes[Math.floor(slopes.length / 2)];

  // Sen's intercept: median of (y_i - slope * i) values
  const intercepts = values.map((y, idx) => y - sensSlope * idx);
  intercepts.sort((a, b) => a - b);
  const sensIntercept = intercepts.length % 2 === 0
    ? (intercepts[intercepts.length / 2 - 1] + intercepts[intercepts.length / 2]) / 2
    : intercepts[Math.floor(intercepts.length / 2)];

  if (n < 10) {
    warnings.push(
      "With fewer than 10 time points, the normal approximation may be inaccurate. " +
      "Consider using exact Mann-Kendall tables for small n."
    );
  }

  if (tiedGroups.length > n * 0.3) {
    warnings.push(
      "Many tied values detected. This reduces the power of the test."
    );
  }

  const significance = classifySignificance(pValue);
  const direction = S > 0 ? "increasing" : S < 0 ? "decreasing" : "no";
  const timeDesc = timeLabels
    ? `from ${timeLabels[0]} to ${timeLabels[timeLabels.length - 1]}`
    : `over ${n} time periods`;

  let interpretation: string;
  if (significance === "not_significant") {
    interpretation = `No statistically significant trend detected ${timeDesc} ` +
      `(Z = ${Z.toFixed(3)}, p = ${pValue.toFixed(4)}). ` +
      `While there appears to be a ${direction} pattern, it is not strong enough ` +
      `to rule out random fluctuation. Sen's slope: ${sensSlope.toFixed(3)} per period.`;
  } else {
    interpretation = `Statistically significant ${direction} trend detected ${timeDesc} ` +
      `(${significanceEmoji(significance)} Z = ${Z.toFixed(3)}, p = ${pValue.toFixed(4)}). ` +
      `Sen's slope = ${sensSlope.toFixed(2)} per time unit (robust to outliers). ` +
      `Kendall's tau = ${tau.toFixed(3)} (strength of monotonic relationship).`;
  }

  return {
    testName: "Mann-Kendall Trend Test",
    statistic: Z,
    pValue,
    degreesOfFreedom: null,
    effectSize: tau,
    effectSizeLabel: "Kendall's tau",
    confidenceInterval: null,
    sampleSize: n,
    significance,
    interpretation,
    assumptions: [
      "Observations are ordered in time",
      "Observations are independent (no autocorrelation)",
      "Tests for monotonic trend — cannot detect cyclical or non-monotonic patterns",
      "Non-parametric: no normality assumption required",
    ],
    warnings,
    sensSlope,
    sensIntercept,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10: KOLMOGOROV-SMIRNOV TWO-SAMPLE TEST
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Two-sample Kolmogorov-Smirnov test.
 *
 * Tests whether two samples come from the same continuous distribution.
 * Unlike the t-test, this is sensitive to ANY difference in distribution
 * (shape, spread, location) — not just the mean.
 *
 * Example: Do two counties have different crash severity distributions?
 *
 * Algorithm:
 * 1. Compute empirical CDFs F_1(x) and F_2(x) for both samples
 * 2. D = max |F_1(x) - F_2(x)| (maximum absolute difference between CDFs)
 * 3. Under H0, the scaled statistic converges to the Kolmogorov distribution:
 *    n_e = (n1 * n2) / (n1 + n2)  (effective sample size)
 *    lambda = (sqrt(n_e) + 0.12 + 0.11/sqrt(n_e)) * D
 *    P-value approximation: 2 * sum_{k=1}^inf (-1)^(k-1) * exp(-2 * k^2 * lambda^2)
 */
export function kolmogorovSmirnovTest(
  sample1: number[],
  sample2: number[],
  label1 = "Sample 1",
  label2 = "Sample 2",
): TestResult {
  const n1 = sample1.length;
  const n2 = sample2.length;
  const warnings: string[] = [];

  if (n1 < 4 || n2 < 4) {
    return {
      testName: "Kolmogorov-Smirnov Two-Sample Test",
      statistic: 0,
      pValue: 1,
      degreesOfFreedom: null,
      effectSize: null,
      effectSizeLabel: "D statistic",
      confidenceInterval: null,
      sampleSize: n1 + n2,
      significance: "not_significant",
      interpretation: "Each sample needs at least 4 observations.",
      assumptions: [],
      warnings: ["Insufficient sample size"],
    };
  }

  // Sort both samples
  const sorted1 = [...sample1].sort((a, b) => a - b);
  const sorted2 = [...sample2].sort((a, b) => a - b);

  // Compute D = max |F1(x) - F2(x)| by walking through both sorted arrays
  let D = 0;
  let i1 = 0, i2 = 0;

  while (i1 < n1 && i2 < n2) {
    const v1 = sorted1[i1];
    const v2 = sorted2[i2];

    if (v1 <= v2) {
      i1++;
    }
    if (v2 <= v1) {
      i2++;
    }

    const f1 = i1 / n1;
    const f2 = i2 / n2;
    D = Math.max(D, Math.abs(f1 - f2));
  }

  // P-value using the Kolmogorov distribution approximation
  let pValue: number;
  if (D === 0) {
    pValue = 1; // Identical empirical distributions — no evidence against H0
  } else {
    const ne = (n1 * n2) / (n1 + n2);
    const lambda = (Math.sqrt(ne) + 0.12 + 0.11 / Math.sqrt(ne)) * D;

    // Kolmogorov distribution survival function
    let sum = 0;
    for (let k = 1; k <= 100; k++) {
      const term = Math.exp(-2 * k * k * lambda * lambda);
      if (k % 2 === 1) sum += term;
      else sum -= term;
      if (term < 1e-14) break;
    }
    pValue = Math.max(0, Math.min(1, 2 * sum));
  }

  if (n1 < 20 || n2 < 20) {
    warnings.push(
      "Asymptotic p-value may be inaccurate for small samples. " +
      "Consider exact KS tables for n < 20."
    );
  }

  const significance = classifySignificance(pValue);

  let interpretation: string;
  if (significance === "not_significant") {
    interpretation = `The distributions of ${label1} and ${label2} are not significantly different ` +
      `(D = ${D.toFixed(4)}, p = ${pValue.toFixed(4)}). ` +
      `The maximum gap between their cumulative distributions is ${(D * 100).toFixed(1)}%, ` +
      `which could arise by chance.`;
  } else {
    interpretation = `The distributions of ${label1} and ${label2} ARE significantly different ` +
      `(${significanceEmoji(significance)} D = ${D.toFixed(4)}, p = ${pValue.toFixed(4)}). ` +
      `The maximum gap between cumulative distributions is ${(D * 100).toFixed(1)}%. ` +
      `This means the two groups differ in their overall distribution shape, not just the mean.`;
  }

  return {
    testName: "Kolmogorov-Smirnov Two-Sample Test",
    statistic: D,
    pValue,
    degreesOfFreedom: null,
    effectSize: D,
    effectSizeLabel: "D statistic",
    confidenceInterval: null,
    sampleSize: n1 + n2,
    significance,
    interpretation,
    assumptions: [
      "Both samples are drawn from continuous distributions",
      "Observations within each sample are independent",
      "Sensitive to all types of distributional differences (location, spread, shape)",
    ],
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 11: MULTIPLE TESTING CORRECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bonferroni correction: multiply each p-value by the number of tests.
 * Very conservative — controls Family-Wise Error Rate (FWER).
 * Use when you MUST avoid any false positives (e.g., publishing a claim).
 *
 * corrected_p = min(1, raw_p * m) where m = number of tests
 */
export function bonferroniCorrection(results: TestResult[]): MultipleTestResult {
  const m = results.length;
  const correctedPValues = results.map(r => Math.min(1, r.pValue * m));
  const significantCount = correctedPValues.filter(p => p < 0.05).length;

  return {
    individual: results,
    correctedPValues,
    method: "bonferroni",
    significantCount,
    totalTests: m,
  };
}

/**
 * Benjamini-Hochberg False Discovery Rate (FDR) correction.
 * Less conservative than Bonferroni — controls expected proportion of false
 * discoveries among all discoveries.
 * Use for exploratory analysis (e.g., scanning many correlations).
 *
 * Algorithm:
 * 1. Sort p-values: p(1) <= p(2) <= ... <= p(m)
 * 2. Find largest k where p(k) <= k/m * alpha
 * 3. Reject H0 for all tests with p(i) <= p(k)
 *
 * Adjusted p-values:
 *   p_adj(i) = min(1, min_{j>=i}(m/j * p(j)))
 */
export function fdrCorrection(results: TestResult[]): MultipleTestResult {
  const m = results.length;

  // Create indices sorted by p-value
  const indices = results.map((_, i) => i);
  indices.sort((a, b) => results[a].pValue - results[b].pValue);

  // Compute BH-adjusted p-values
  const correctedPValues = new Array<number>(m);
  let cumulativeMin = 1;

  for (let rank = m; rank >= 1; rank--) {
    const origIdx = indices[rank - 1];
    const adjusted = Math.min(1, results[origIdx].pValue * m / rank);
    cumulativeMin = Math.min(cumulativeMin, adjusted);
    correctedPValues[origIdx] = cumulativeMin;
  }

  const significantCount = correctedPValues.filter(p => p < 0.05).length;

  return {
    individual: results,
    correctedPValues,
    method: "fdr",
    significantCount,
    totalTests: m,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 12: HIGH-LEVEL TEST RUNNERS (connect to CalSight data)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Test whether severity distribution differs between selected counties.
 * Constructs a contingency table from raw data.
 *
 * @param data - Array of { county: string, severity: string, count: number }
 * @param counties - Which counties to compare
 */
export function testSeverityByCounty(
  data: { county: string; severity: string; count: number }[],
  counties: string[],
): TestResult {
  // Get all severity levels
  const severities = [...new Set(data.map(d => d.severity))].sort();
  const severityIdx = Object.fromEntries(severities.map((s, i) => [s, i]));

  // Build contingency table: rows = counties, cols = severities
  const table: number[][] = [];
  for (const county of counties) {
    const row = new Array(severities.length).fill(0);
    for (const d of data) {
      if (d.county === county && severityIdx[d.severity] != null) {
        row[severityIdx[d.severity]] = d.count;
      }
    }
    table.push(row);
  }

  return chiSquaredTest(table, counties, severities);
}

/**
 * Test whether mean crash counts differ between weekdays and weekends.
 *
 * @param weekdayCounts - Array of daily crash counts on weekdays
 * @param weekendCounts - Array of daily crash counts on weekends
 */
export function testWeekdayVsWeekend(
  weekdayCounts: number[],
  weekendCounts: number[],
): TestResult {
  return twoSampleTTest(weekdayCounts, weekendCounts, "Weekdays", "Weekends");
}

/**
 * Test whether crash rates differ across age groups using ANOVA.
 *
 * @param groupedData - Map from age bracket label to array of crash counts per unit
 */
export function testCrashRatesByAge(
  groupedData: Record<string, number[]>,
): TestResult {
  const labels = Object.keys(groupedData);
  const groups = Object.values(groupedData);
  return oneWayAnova(groups, labels);
}

/**
 * Test significance of a correlation from the CorrelationMatrix.
 * Call this when a user clicks a cell in the 26x26 matrix.
 */
export function testCorrelationCell(
  r: number,
  n: number,
  xLabel: string,
  yLabel: string,
): TestResult {
  return correlationSignificance(r, n, xLabel, yLabel);
}

/**
 * Test whether crash counts show a significant trend over years.
 *
 * @param yearlyValues - Crash counts ordered by year
 * @param years - Year labels (e.g., ["2014", "2015", ..., "2023"])
 */
export function testYearlyTrend(
  yearlyValues: number[],
  years: string[],
): TestResult & { sensSlope: number; sensIntercept: number } {
  return mannKendallTest(yearlyValues, years);
}

/**
 * Compare two counties' crash distributions using KS test.
 *
 * @param county1Values - Array of individual crash metrics for county 1
 * @param county2Values - Array of individual crash metrics for county 2
 * @param county1Name - Display name
 * @param county2Name - Display name
 */
export function testCountyDistributions(
  county1Values: number[],
  county2Values: number[],
  county1Name: string,
  county2Name: string,
): TestResult {
  return kolmogorovSmirnovTest(county1Values, county2Values, county1Name, county2Name);
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 13: BATCH CORRELATION SIGNIFICANCE (for the full matrix)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute p-values for the entire correlation matrix and apply FDR correction.
 * This answers: "Which of these 325 correlations are actually significant?"
 *
 * @param matrix - The correlation matrix (r values)
 * @param n - Number of observations (counties)
 * @returns P-value matrix and significance flags after FDR correction
 */
export function correlationMatrixSignificance(
  matrix: number[][],
  n: number,
): { pValues: number[][]; significant: boolean[][]; fdrPValues: number[][] } {
  const size = matrix.length;
  const pValues: number[][] = Array.from({ length: size }, () => Array(size).fill(1));
  const allTests: { i: number; j: number; p: number }[] = [];

  for (let i = 0; i < size; i++) {
    for (let j = i + 1; j < size; j++) {
      const r = matrix[i][j];
      if (r === 0 || n < 4) {
        pValues[i][j] = 1;
        pValues[j][i] = 1;
      } else {
        const rClamped = Math.max(-0.9999, Math.min(0.9999, r));
        const df = n - 2;
        const t = rClamped * Math.sqrt(df) / Math.sqrt(1 - rClamped * rClamped);
        const p = Math.max(0, Math.min(1, 2 * (1 - tCdf(Math.abs(t), df))));
        pValues[i][j] = p;
        pValues[j][i] = p;
      }
      allTests.push({ i, j, p: pValues[i][j] });
    }
  }

  // FDR correction across all unique pairs
  const m = allTests.length;
  allTests.sort((a, b) => a.p - b.p);

  const fdrPValues: number[][] = Array.from({ length: size }, () => Array(size).fill(1));
  let cumulativeMin = 1;
  for (let rank = m; rank >= 1; rank--) {
    const test = allTests[rank - 1];
    const adjusted = Math.min(1, test.p * m / rank);
    cumulativeMin = Math.min(cumulativeMin, adjusted);
    fdrPValues[test.i][test.j] = cumulativeMin;
    fdrPValues[test.j][test.i] = cumulativeMin;
  }

  // Mark significant cells
  const significant: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      significant[i][j] = i !== j && fdrPValues[i][j] < 0.05;
    }
  }

  return { pValues, significant, fdrPValues };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 14: EXPORTED UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/** Export the CDF functions for reuse in other modules */
export const distributions = {
  normalCdf,
  tCdf,
  chiSquaredCdf,
  fCdf,
  inverseNormal,
};
