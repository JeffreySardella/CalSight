/** Minimum number of valid values required to interpolate n quantile buckets.
 *  Below this, quantileBuckets returns null — rebucketing 1 or 2 values into
 *  n colors is meaningless. Callers that need a legend anyway for very small
 *  datasets should use `legendEdges`, which falls back to a single class
 *  spanning the actual values instead of fabricating quantiles. */
export const MIN_BUCKET_SUBSET = 3;

type BucketOpts = {
  /** Round every edge to the nearest integer — for measures that only ever
   *  take integer values (e.g. raw crash counts), so the legend never shows
   *  a fractional break like "437.924" from quantile interpolation. */
  integer?: boolean;
};

/**
 * Compute quantile bucket edges.
 * Returns `null` if fewer than MIN_BUCKET_SUBSET valid values are supplied.
 * Output length: `n + 1` (bucket boundaries including min and max).
 */
export function quantileBuckets(values: number[], n: number, opts: BucketOpts = {}): number[] | null {
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
    edges.push(opts.integer ? Math.round(v) : v);
  }
  return edges;
}

/**
 * Legend-ready bucket edges for a set of values. Unlike `quantileBuckets`,
 * this never leaves a caller to freeze a stale array from a previous, larger
 * dataset: with fewer than MIN_BUCKET_SUBSET values it collapses to a
 * single class spanning the actual min/max, and with zero values it returns
 * null (nothing to show).
 */
export function legendEdges(values: number[], n: number, opts: BucketOpts = {}): number[] | null {
  const clean = values
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .slice()
    .sort((a, b) => a - b);

  if (clean.length === 0) return null;

  const quantiles = quantileBuckets(clean, n, opts);
  if (quantiles) return quantiles;

  const range = [clean[0], clean[clean.length - 1]];
  return opts.integer ? range.map(Math.round) : range;
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
