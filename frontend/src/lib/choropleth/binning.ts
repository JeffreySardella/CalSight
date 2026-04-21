/** Minimum number of valid values required to recompute bucket edges.
 *  Below this, callers should freeze the previous edges — rebucketing
 *  1 or 2 values across 5 colors is meaningless. */
export const MIN_BUCKET_SUBSET = 3;

/**
 * Compute quantile bucket edges.
 * Returns `null` if fewer than MIN_BUCKET_SUBSET valid values are supplied.
 * Output length: `n + 1` (bucket boundaries including min and max).
 */
export function quantileBuckets(values: number[], n: number): number[] | null {
  const clean = values
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .slice()
    .sort((a, b) => a - b);

  if (clean.length < MIN_BUCKET_SUBSET) return null;

  const edges: number[] = [];
  for (let i = 0; i <= n; i++) {
    const rank = (i / n) * (clean.length - 1);
    const lo = Math.floor(rank);
    const hi = Math.ceil(rank);
    const v = lo === hi ? clean[lo] : clean[lo] + (clean[hi] - clean[lo]) * (rank - lo);
    edges.push(v);
  }
  return edges;
}

/**
 * Given a value and sorted bucket edges (length n+1), return the bucket
 * index 0..n-1. Values outside the range clamp to the nearest bucket.
 */
export function bucketFor(value: number, edges: number[]): number {
  const n = edges.length - 1;
  if (value <= edges[0]) return 0;
  if (value >= edges[n]) return n - 1;
  for (let i = 1; i < n; i++) {
    if (value <= edges[i]) return i - 1;
  }
  return n - 1;
}
