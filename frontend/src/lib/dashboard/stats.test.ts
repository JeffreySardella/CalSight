import { describe, it, expect } from "vitest";
import { linearRegression, linearRegressionXY, mean, median, stddev, movingAverage, polynomialRegression, holtWinters, forecast } from "./stats";

describe("linearRegression", () => {
  it("returns slope=0, intercept=0, r2=0 for empty array", () => {
    const result = linearRegression([]);
    expect(result).toEqual({ slope: 0, intercept: 0, r2: 0 });
  });

  it("returns slope=0 and intercept=value for single element", () => {
    const result = linearRegression([7]);
    expect(result).toEqual({ slope: 0, intercept: 7, r2: 0 });
  });

  it("returns slope=1, intercept=0, r2=1 for perfectly linear [0,1,2,3,4]", () => {
    const result = linearRegression([0, 1, 2, 3, 4]);
    expect(result.slope).toBeCloseTo(1);
    expect(result.intercept).toBeCloseTo(0);
    expect(result.r2).toBeCloseTo(1);
  });

  it("returns slope=0 and r2=0 for flat constant [5,5,5,5]", () => {
    const result = linearRegression([5, 5, 5, 5]);
    expect(result.slope).toBeCloseTo(0);
    expect(result.intercept).toBeCloseTo(5);
    expect(result.r2).toBe(0);
  });

  it("returns slope=-1, r2=1 for decreasing [4,3,2,1,0]", () => {
    const result = linearRegression([4, 3, 2, 1, 0]);
    expect(result.slope).toBeCloseTo(-1);
    expect(result.intercept).toBeCloseTo(4);
    expect(result.r2).toBeCloseTo(1);
  });

  it("returns 0 < r2 < 1 for noisy data", () => {
    const result = linearRegression([1, 3, 2, 5, 4, 7, 6]);
    expect(result.r2).toBeGreaterThan(0);
    expect(result.r2).toBeLessThan(1);
    expect(result.slope).toBeGreaterThan(0);
  });

  it("handles slope=2 for [0,2,4,6,8]", () => {
    const result = linearRegression([0, 2, 4, 6, 8]);
    expect(result.slope).toBeCloseTo(2);
    expect(result.intercept).toBeCloseTo(0);
    expect(result.r2).toBeCloseTo(1);
  });

  it("handles large values without overflow", () => {
    const result = linearRegression([1e6, 2e6, 3e6, 4e6, 5e6]);
    expect(result.slope).toBeCloseTo(1e6);
    expect(result.r2).toBeCloseTo(1);
  });

  it("handles negative values correctly", () => {
    const result = linearRegression([-4, -3, -2, -1, 0]);
    expect(result.slope).toBeCloseTo(1);
    expect(result.intercept).toBeCloseTo(-4);
    expect(result.r2).toBeCloseTo(1);
  });

  it("handles two-element array", () => {
    const result = linearRegression([3, 7]);
    expect(result.slope).toBeCloseTo(4);
    expect(result.intercept).toBeCloseTo(3);
    expect(result.r2).toBeCloseTo(1);
  });

  it("r2 is bounded between 0 and 1", () => {
    const datasets = [
      [10, 20, 15, 25, 18, 30, 22],
      [100, 50, 80, 20, 90, 10],
      [1, 1, 1, 1, 100],
    ];
    for (const data of datasets) {
      const result = linearRegression(data);
      expect(result.r2).toBeGreaterThanOrEqual(0);
      expect(result.r2).toBeLessThanOrEqual(1);
    }
  });
});

describe("linearRegressionXY", () => {
  it("returns slope=0, intercept=0, r2=0 for empty array", () => {
    const result = linearRegressionXY([]);
    expect(result).toEqual({ slope: 0, intercept: 0, r2: 0 });
  });

  it("returns intercept=y and slope=0 for single point", () => {
    const result = linearRegressionXY([{ x: 3, y: 5 }]);
    expect(result).toEqual({ slope: 0, intercept: 5, r2: 0 });
  });

  it("computes perfect line through two points", () => {
    const result = linearRegressionXY([{ x: 0, y: 1 }, { x: 2, y: 5 }]);
    expect(result.slope).toBeCloseTo(2);
    expect(result.intercept).toBeCloseTo(1);
    expect(result.r2).toBeCloseTo(1);
  });

  it("computes positive correlation", () => {
    const points = [
      { x: 1, y: 2 },
      { x: 2, y: 4 },
      { x: 3, y: 5 },
      { x: 4, y: 4 },
      { x: 5, y: 7 },
    ];
    const result = linearRegressionXY(points);
    expect(result.slope).toBeGreaterThan(0);
    expect(result.r2).toBeGreaterThan(0);
    expect(result.r2).toBeLessThanOrEqual(1);
  });

  it("computes negative correlation", () => {
    const points = [
      { x: 1, y: 10 },
      { x: 2, y: 8 },
      { x: 3, y: 6 },
      { x: 4, y: 4 },
      { x: 5, y: 2 },
    ];
    const result = linearRegressionXY(points);
    expect(result.slope).toBeCloseTo(-2);
    expect(result.intercept).toBeCloseTo(12);
    expect(result.r2).toBeCloseTo(1);
  });

  it("returns slope=0 for horizontal line (all same y)", () => {
    const points = [
      { x: 1, y: 3 },
      { x: 2, y: 3 },
      { x: 3, y: 3 },
      { x: 4, y: 3 },
    ];
    const result = linearRegressionXY(points);
    expect(result.slope).toBeCloseTo(0);
    expect(result.intercept).toBeCloseTo(3);
    expect(result.r2).toBe(0);
  });

  it("handles non-sequential x values", () => {
    const points = [
      { x: 10, y: 20 },
      { x: 20, y: 40 },
      { x: 30, y: 60 },
    ];
    const result = linearRegressionXY(points);
    expect(result.slope).toBeCloseTo(2);
    expect(result.intercept).toBeCloseTo(0);
    expect(result.r2).toBeCloseTo(1);
  });

  it("handles negative x values", () => {
    const points = [
      { x: -2, y: -4 },
      { x: -1, y: -2 },
      { x: 0, y: 0 },
      { x: 1, y: 2 },
      { x: 2, y: 4 },
    ];
    const result = linearRegressionXY(points);
    expect(result.slope).toBeCloseTo(2);
    expect(result.intercept).toBeCloseTo(0);
    expect(result.r2).toBeCloseTo(1);
  });

  it("handles all same x values (vertical line) gracefully", () => {
    const points = [
      { x: 5, y: 1 },
      { x: 5, y: 2 },
      { x: 5, y: 3 },
    ];
    const result = linearRegressionXY(points);
    // denX = 0, so slope=0 and r2=0
    expect(result.slope).toBe(0);
    expect(result.r2).toBe(0);
  });

  it("produces same result as linearRegression for sequential x", () => {
    const values = [3, 7, 11, 15, 19];
    const points = values.map((y, i) => ({ x: i, y }));
    const fromValues = linearRegression(values);
    const fromPoints = linearRegressionXY(points);
    expect(fromPoints.slope).toBeCloseTo(fromValues.slope);
    expect(fromPoints.intercept).toBeCloseTo(fromValues.intercept);
    expect(fromPoints.r2).toBeCloseTo(fromValues.r2);
  });
});

describe("mean", () => {
  it("returns 0 for empty array", () => {
    expect(mean([])).toBe(0);
  });

  it("returns the value for single element", () => {
    expect(mean([42])).toBe(42);
  });

  it("computes mean of [1,2,3]", () => {
    expect(mean([1, 2, 3])).toBe(2);
  });

  it("handles negative numbers", () => {
    expect(mean([-2, 0, 2])).toBe(0);
  });

  it("handles all negative numbers", () => {
    expect(mean([-10, -20, -30])).toBe(-20);
  });

  it("handles decimals", () => {
    expect(mean([0.1, 0.2, 0.3])).toBeCloseTo(0.2);
  });

  it("handles large arrays", () => {
    const arr = Array.from({ length: 1000 }, (_, i) => i + 1);
    expect(mean(arr)).toBeCloseTo(500.5);
  });

  it("handles identical values", () => {
    expect(mean([7, 7, 7, 7, 7])).toBe(7);
  });
});

describe("median", () => {
  it("returns 0 for empty array", () => {
    expect(median([])).toBe(0);
  });

  it("returns the middle element for odd length", () => {
    expect(median([1, 2, 3])).toBe(2);
  });

  it("returns average of two middles for even length", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("handles unsorted input correctly", () => {
    expect(median([5, 1, 3, 2, 4])).toBe(3);
  });

  it("handles single element", () => {
    expect(median([7])).toBe(7);
  });

  it("handles two elements", () => {
    expect(median([10, 20])).toBe(15);
  });

  it("handles duplicate values", () => {
    expect(median([5, 5, 5, 5, 5])).toBe(5);
  });

  it("handles negative values", () => {
    expect(median([-5, -3, -1, 0, 2])).toBe(-1);
  });

  it("does not mutate the original array", () => {
    const arr = [5, 1, 3, 2, 4];
    const copy = [...arr];
    median(arr);
    expect(arr).toEqual(copy);
  });

  it("handles large even-length array", () => {
    const arr = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(median(arr)).toBe(50.5);
  });
});

describe("stddev", () => {
  it("returns 0 for empty array", () => {
    expect(stddev([])).toBe(0);
  });

  it("returns 0 for single element", () => {
    expect(stddev([5])).toBe(0);
  });

  it("returns 0 when all values are the same", () => {
    expect(stddev([3, 3, 3, 3])).toBe(0);
  });

  it("computes correct stddev for [2,4,4,4,5,5,7,9]", () => {
    const result = stddev([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(result).toBeCloseTo(2.0, 1);
  });

  it("computes correct stddev for [1,2,3,4,5]", () => {
    // population stddev of [1,2,3,4,5] = sqrt(2) ~ 1.4142
    const result = stddev([1, 2, 3, 4, 5]);
    expect(result).toBeCloseTo(Math.sqrt(2), 4);
  });

  it("handles two identical elements", () => {
    expect(stddev([4, 4])).toBe(0);
  });

  it("handles two different elements", () => {
    // mean=5, variance=((4-5)^2 + (6-5)^2)/2 = 1, stddev=1
    expect(stddev([4, 6])).toBeCloseTo(1);
  });

  it("handles negative values", () => {
    // [-2, -1, 0, 1, 2] mean=0, variance=(4+1+0+1+4)/5=2, stddev=sqrt(2)
    expect(stddev([-2, -1, 0, 1, 2])).toBeCloseTo(Math.sqrt(2), 4);
  });

  it("increases with more spread data", () => {
    const tight = stddev([9, 10, 11]);
    const wide = stddev([0, 10, 20]);
    expect(wide).toBeGreaterThan(tight);
  });

  it("is invariant to element order", () => {
    expect(stddev([1, 5, 3, 2, 4])).toBeCloseTo(stddev([1, 2, 3, 4, 5]));
  });
});

describe("movingAverage", () => {
  it("returns same values when window=1", () => {
    const input = [1, 2, 3, 4, 5];
    expect(movingAverage(input, 1)).toEqual(input);
  });

  it("returns empty array for empty input", () => {
    expect(movingAverage([], 3)).toEqual([]);
  });

  it("computes correct moving average with window=3", () => {
    const result = movingAverage([1, 2, 3, 4, 5], 3);
    // i=0: avg(1,2) = 1.5
    // i=1: avg(1,2,3) = 2
    // i=2: avg(2,3,4) = 3
    // i=3: avg(3,4,5) = 4
    // i=4: avg(4,5) = 4.5
    expect(result[0]).toBeCloseTo(1.5);
    expect(result[1]).toBeCloseTo(2);
    expect(result[2]).toBeCloseTo(3);
    expect(result[3]).toBeCloseTo(4);
    expect(result[4]).toBeCloseTo(4.5);
  });

  it("handles window larger than array length", () => {
    const result = movingAverage([2, 4, 6], 7);
    // All elements will look at the full array since window extends beyond bounds
    expect(result[0]).toBeCloseTo(mean([2, 4, 6]));
    expect(result[1]).toBeCloseTo(mean([2, 4, 6]));
    expect(result[2]).toBeCloseTo(mean([2, 4, 6]));
  });

  it("handles single element", () => {
    expect(movingAverage([10], 3)).toEqual([10]);
  });

  it("returns same output length as input", () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = movingAverage(input, 5);
    expect(result.length).toBe(input.length);
  });

  it("computes correct moving average with window=5", () => {
    const result = movingAverage([10, 20, 30, 40, 50], 5);
    // i=0: half=2, start=0, end=3 -> avg(10,20,30) = 20
    // i=1: start=0, end=4 -> avg(10,20,30,40) = 25
    // i=2: start=0, end=5 -> avg(10,20,30,40,50) = 30
    // i=3: start=1, end=5 -> avg(20,30,40,50) = 35
    // i=4: start=2, end=5 -> avg(30,40,50) = 40
    expect(result[0]).toBeCloseTo(20);
    expect(result[1]).toBeCloseTo(25);
    expect(result[2]).toBeCloseTo(30);
    expect(result[3]).toBeCloseTo(35);
    expect(result[4]).toBeCloseTo(40);
  });

  it("with window=2 uses asymmetric windows correctly", () => {
    // half = floor(2/2) = 1
    // i=0: start=max(0,-1+1)=0, end=min(3,0+1+1)=2 -> avg(1,2)=1.5
    // i=1: start=max(0,1-1)=0, end=min(3,1+1+1)=3 -> avg(1,2,3)=2
    // i=2: start=max(0,2-1)=1, end=min(3,2+1+1)=3 -> avg(2,3)=2.5
    const result = movingAverage([1, 2, 3], 2);
    expect(result[0]).toBeCloseTo(1.5);
    expect(result[1]).toBeCloseTo(2);
    expect(result[2]).toBeCloseTo(2.5);
  });

  it("returns all same value for constant array", () => {
    const result = movingAverage([5, 5, 5, 5, 5], 3);
    for (const v of result) {
      expect(v).toBe(5);
    }
  });

  it("smooths out a spike in the middle", () => {
    const input = [1, 1, 1, 100, 1, 1, 1];
    const result = movingAverage(input, 3);
    // The spike at index 3 should be dampened
    expect(result[3]).toBeLessThan(100);
    expect(result[3]).toBeGreaterThan(1);
    // Neighbors of the spike should also be affected
    expect(result[2]).toBeGreaterThan(1);
    expect(result[4]).toBeGreaterThan(1);
  });
});

describe("polynomialRegression", () => {
  it("fits a perfect quadratic y = x^2", () => {
    const values = [0, 1, 4, 9, 16, 25];
    const result = polynomialRegression(values, 2);
    expect(result.r2).toBeGreaterThan(0.99);
    expect(result.predict(6)).toBeCloseTo(36, 0);
  });

  it("returns mean for insufficient data", () => {
    const result = polynomialRegression([5, 10], 2);
    expect(result.predict(0)).toBeCloseTo(7.5);
  });

  it("degree 1 matches linear regression", () => {
    const values = [2, 4, 6, 8, 10];
    const poly = polynomialRegression(values, 1);
    const lin = linearRegression(values);
    expect(poly.r2).toBeCloseTo(lin.r2, 2);
  });
});

describe("holtWinters", () => {
  it("produces fitted values same length as input", () => {
    const values = Array.from({ length: 24 }, (_, i) => 100 + 20 * Math.sin((i / 12) * Math.PI * 2) + i * 2);
    const hw = holtWinters(values, 12);
    expect(hw.fitted).toHaveLength(24);
  });

  it("forecasts future values", () => {
    const values = Array.from({ length: 24 }, (_, i) => 100 + i * 3);
    const hw = holtWinters(values, 12);
    const fc = hw.forecast(5);
    expect(fc).toHaveLength(5);
    expect(fc[0]).toBeGreaterThan(values[values.length - 1] * 0.5);
  });

  it("falls back to linear for short series", () => {
    const values = [10, 20, 30, 40, 50];
    const hw = holtWinters(values, 12);
    expect(hw.fitted).toHaveLength(5);
    const fc = hw.forecast(3);
    expect(fc).toHaveLength(3);
  });
});

describe("forecast", () => {
  it("linear forecast produces values and confidence bands", () => {
    const values = [100, 115, 118, 132, 138, 152];
    const result = forecast(values, 3, "linear");
    expect(result.values).toHaveLength(3);
    expect(result.upper).toHaveLength(3);
    expect(result.lower).toHaveLength(3);
    expect(result.values[0]).toBeGreaterThan(140);
    expect(result.upper[0]).toBeGreaterThan(result.values[0]);
    expect(result.lower[0]).toBeLessThan(result.values[0]);
    expect(result.method).toBe("Linear");
  });

  it("polynomial forecast produces non-negative values", () => {
    const values = [100, 90, 80, 70, 60, 50];
    const result = forecast(values, 3, "polynomial");
    result.values.forEach(v => expect(v).toBeGreaterThanOrEqual(0));
    result.lower.forEach(v => expect(v).toBeGreaterThanOrEqual(0));
  });

  it("holt-winters forecast works with seasonal data", () => {
    const values = Array.from({ length: 36 }, (_, i) => 200 + 50 * Math.sin((i / 12) * Math.PI * 2) + i * 2);
    const result = forecast(values, 6, "holt-winters");
    expect(result.values).toHaveLength(6);
    expect(result.method).toBe("Holt-Winters");
  });

  it("returns empty for very short series", () => {
    const result = forecast([5, 10], 3, "linear");
    expect(result.values).toHaveLength(0);
  });

  it("confidence bands widen with horizon", () => {
    const values = [100, 120, 110, 130, 140, 125, 150, 160];
    const result = forecast(values, 5, "linear");
    const widths = result.upper.map((u, i) => u - result.lower[i]);
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1] * 0.99);
    }
  });
});
