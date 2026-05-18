export function linearRegression(values: number[]): { slope: number; intercept: number; r2: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0, r2: 0 };

  const xs = values.map((_, i) => i);
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((s, y) => s + y, 0) / n;

  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - xMean;
    const dy = values[i] - yMean;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const slope = denX > 0 ? num / denX : 0;
  const intercept = yMean - slope * xMean;
  const r2 = denX > 0 && denY > 0 ? (num * num) / (denX * denY) : 0;

  return { slope, intercept, r2 };
}

export function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length);
}

export function linearRegressionXY(points: { x: number; y: number }[]): { slope: number; intercept: number; r2: number } {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y ?? 0, r2: 0 };

  const xMean = points.reduce((s, p) => s + p.x, 0) / n;
  const yMean = points.reduce((s, p) => s + p.y, 0) / n;

  let num = 0, denX = 0, denY = 0;
  for (const p of points) {
    const dx = p.x - xMean;
    const dy = p.y - yMean;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const slope = denX > 0 ? num / denX : 0;
  const intercept = yMean - slope * xMean;
  const r2 = denX > 0 && denY > 0 ? (num * num) / (denX * denY) : 0;

  return { slope, intercept, r2 };
}

export function movingAverage(values: number[], window: number): number[] {
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const start = Math.max(0, i - half);
    const end = Math.min(values.length, i + half + 1);
    const slice = values.slice(start, end);
    return slice.reduce((s, v) => s + v, 0) / slice.length;
  });
}

export function polynomialRegression(values: number[], degree: number): { coefficients: number[]; r2: number; predict: (x: number) => number } {
  const n = values.length;
  if (n < degree + 1) return { coefficients: [mean(values)], r2: 0, predict: () => mean(values) };

  const xs = values.map((_, i) => i);
  const d = Math.min(degree, 3);

  const X: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j <= d; j++) row.push(Math.pow(xs[i], j));
    X.push(row);
  }

  const Xt = transpose(X);
  const XtX = matMul(Xt, X);
  const XtY = matVec(Xt, values);
  const coeffs = solveLinear(XtX, XtY);

  const yMean = mean(values);
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    let pred = 0;
    for (let j = 0; j <= d; j++) pred += coeffs[j] * Math.pow(xs[i], j);
    ssRes += (values[i] - pred) ** 2;
    ssTot += (values[i] - yMean) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  const predict = (x: number) => {
    let y = 0;
    for (let j = 0; j < coeffs.length; j++) y += coeffs[j] * Math.pow(x, j);
    return y;
  };

  return { coefficients: coeffs, r2, predict };
}

function transpose(m: number[][]): number[][] {
  const rows = m.length, cols = m[0].length;
  const t: number[][] = Array.from({ length: cols }, () => new Array(rows));
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++) t[j][i] = m[i][j];
  return t;
}

function matMul(a: number[][], b: number[][]): number[][] {
  const rows = a.length, cols = b[0].length, inner = b.length;
  const r: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++)
      for (let k = 0; k < inner; k++) r[i][j] += a[i][k] * b[k][j];
  return r;
}

function matVec(m: number[][], v: number[]): number[] {
  return m.map(row => row.reduce((s, c, j) => s + c * v[j], 0));
}

function solveLinear(A: number[][], b: number[]): number[] {
  const n = A.length;
  const aug: number[][] = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++)
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    if (Math.abs(aug[col][col]) < 1e-12) continue;
    for (let row = col + 1; row < n; row++) {
      const f = aug[row][col] / aug[col][col];
      for (let j = col; j <= n; j++) aug[row][j] -= f * aug[col][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = aug[i][n];
    for (let j = i + 1; j < n; j++) x[i] -= aug[i][j] * x[j];
    x[i] = Math.abs(aug[i][i]) > 1e-12 ? x[i] / aug[i][i] : 0;
  }
  return x;
}

export function holtWinters(values: number[], season: number, alpha = 0.3, beta = 0.1, gamma = 0.3): { fitted: number[]; forecast: (steps: number) => number[] } {
  const n = values.length;
  if (n < season * 2) {
    const reg = linearRegression(values);
    return {
      fitted: values.map((_, i) => reg.intercept + reg.slope * i),
      forecast: (steps: number) => Array.from({ length: steps }, (_, i) => reg.intercept + reg.slope * (n + i)),
    };
  }

  let level = mean(values.slice(0, season));
  let trend = (mean(values.slice(season, season * 2)) - mean(values.slice(0, season))) / season;
  const seasonal = new Array(season);
  for (let i = 0; i < season; i++) {
    seasonal[i] = values[i] / (level || 1);
  }

  const fitted: number[] = [];
  for (let i = 0; i < n; i++) {
    const si = i % season;
    const prevSeasonal = seasonal[si];
    const fit = (level + trend) * prevSeasonal;
    fitted.push(fit);

    const newLevel = alpha * (values[i] / (prevSeasonal || 1)) + (1 - alpha) * (level + trend);
    const newTrend = beta * (newLevel - level) + (1 - beta) * trend;
    seasonal[si] = gamma * (values[i] / (newLevel || 1)) + (1 - gamma) * prevSeasonal;

    level = newLevel;
    trend = newTrend;
  }

  const finalLevel = level;
  const finalTrend = trend;
  const finalSeasonal = [...seasonal];

  return {
    fitted,
    forecast: (steps: number) =>
      Array.from({ length: steps }, (_, i) => {
        const si = (n + i) % season;
        return (finalLevel + finalTrend * (i + 1)) * finalSeasonal[si];
      }),
  };
}

export type ForecastResult = {
  values: number[];
  upper: number[];
  lower: number[];
  method: string;
  r2: number;
};

export function forecast(values: number[], horizon: number, method: "linear" | "polynomial" | "holt-winters" = "linear"): ForecastResult {
  const n = values.length;
  if (n < 3) return { values: [], upper: [], lower: [], method, r2: 0 };

  const residualStd = (actual: number[], predicted: number[]) => {
    const resid = actual.map((v, i) => v - predicted[i]);
    return stddev(resid);
  };

  if (method === "holt-winters") {
    const season = n >= 24 ? 12 : n >= 14 ? 7 : 4;
    const hw = holtWinters(values, season);
    const fc = hw.forecast(horizon);
    const sigma = residualStd(values, hw.fitted);
    return {
      values: fc,
      upper: fc.map((v, i) => v + 1.96 * sigma * Math.sqrt(1 + i / n)),
      lower: fc.map((v, i) => Math.max(0, v - 1.96 * sigma * Math.sqrt(1 + i / n))),
      method: "Holt-Winters",
      r2: 0,
    };
  }

  if (method === "polynomial") {
    const poly = polynomialRegression(values, 2);
    const fc = Array.from({ length: horizon }, (_, i) => Math.max(0, poly.predict(n + i)));
    const fitted = values.map((_, i) => poly.predict(i));
    const sigma = residualStd(values, fitted);
    return {
      values: fc,
      upper: fc.map((v, i) => v + 1.96 * sigma * Math.sqrt(1 + (n + i) / n)),
      lower: fc.map((v, i) => Math.max(0, v - 1.96 * sigma * Math.sqrt(1 + (n + i) / n))),
      method: "Quadratic",
      r2: poly.r2,
    };
  }

  const reg = linearRegression(values);
  const fc = Array.from({ length: horizon }, (_, i) => Math.max(0, reg.intercept + reg.slope * (n + i)));
  const fitted = values.map((_, i) => reg.intercept + reg.slope * i);
  const sigma = residualStd(values, fitted);
  return {
    values: fc,
    upper: fc.map((v, i) => v + 1.96 * sigma * Math.sqrt(1 + (n + i) / n)),
    lower: fc.map((v, i) => Math.max(0, v - 1.96 * sigma * Math.sqrt(1 + (n + i) / n))),
    method: "Linear",
    r2: reg.r2,
  };
}
