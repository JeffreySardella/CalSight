import { describe, it, expect } from "vitest";
import { quantileBuckets, legendEdges, bucketFor, MIN_BUCKET_SUBSET } from "./binning";

describe("quantileBuckets", () => {
  it("returns 6 edges for 10 values split into 5 buckets", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const edges = quantileBuckets(values, 5);
    expect(edges).not.toBeNull();
    expect(edges).toHaveLength(6);
    expect(edges![0]).toBe(1);
    expect(edges![5]).toBe(10);
  });

  it("returns null when fewer than MIN_BUCKET_SUBSET values", () => {
    expect(quantileBuckets([1, 2], 5)).toBeNull();
    expect(MIN_BUCKET_SUBSET).toBe(3);
  });

  it("handles ties by producing non-decreasing edges", () => {
    const values = [5, 5, 5, 5, 5, 5, 5, 5];
    const edges = quantileBuckets(values, 5);
    expect(edges).not.toBeNull();
    for (let i = 1; i < edges!.length; i++) {
      expect(edges![i]).toBeGreaterThanOrEqual(edges![i - 1]);
    }
  });

  it("ignores NaN/null values", () => {
    const edges = quantileBuckets([1, NaN, 2, 3, 4, 5] as number[], 5);
    expect(edges).not.toBeNull();
    expect(edges![0]).toBe(1);
    expect(edges![5]).toBe(5);
  });

  it("rounds every edge to an integer when opts.integer is set", () => {
    // These values interpolate to fractional quantiles (e.g. 437.924) unless
    // rounded — the bug an integer measure like "Total crashes" must not show.
    const values = [12, 137, 254, 883, 1204, 3100];
    const edges = quantileBuckets(values, 5, { integer: true });
    expect(edges).not.toBeNull();
    for (const e of edges!) {
      expect(Number.isInteger(e)).toBe(true);
    }
  });
});

describe("legendEdges", () => {
  it("returns null for zero values", () => {
    expect(legendEdges([], 5)).toBeNull();
  });

  it("collapses a single value to a single-class [min, max] range, not five breaks", () => {
    const edges = legendEdges([42], 5);
    expect(edges).toEqual([42, 42]);
  });

  it("collapses fewer-than-MIN_BUCKET_SUBSET values to their actual range", () => {
    const edges = legendEdges([3, 9], 5);
    expect(edges).toEqual([3, 9]);
  });

  it("never freezes onto a stale multi-bucket shape for too-few values", () => {
    const edges = legendEdges([1], 5);
    expect(edges).not.toBeNull();
    expect(edges!.length).toBe(2);
  });

  it("rounds the single-class range to integers for an integer measure", () => {
    const edges = legendEdges([1.7], 5, { integer: true });
    expect(edges).toEqual([2, 2]);
  });

  it("still computes real quantiles once there are enough values", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const edges = legendEdges(values, 5);
    expect(edges).toHaveLength(6);
    expect(edges![0]).toBe(1);
    expect(edges![5]).toBe(10);
  });
});

describe("bucketFor", () => {
  const edges = [0, 10, 20, 30, 40, 50];

  it("returns 0 at or below edge[0]", () => {
    expect(bucketFor(-5, edges)).toBe(0);
    expect(bucketFor(0, edges)).toBe(0);
    expect(bucketFor(10, edges)).toBe(0);
  });

  it("returns last bucket index at or above max", () => {
    expect(bucketFor(50, edges)).toBe(4);
    expect(bucketFor(99, edges)).toBe(4);
  });

  it("places intermediate values in the correct bucket", () => {
    expect(bucketFor(15, edges)).toBe(1);
    expect(bucketFor(25, edges)).toBe(2);
    expect(bucketFor(35, edges)).toBe(3);
    expect(bucketFor(45, edges)).toBe(4);
  });
});
