/** 1234 → "1.2K", 2_500_000 → "2.5M"; below 1,000 it keeps locale grouping. */
export function formatCompact(val: number): string {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return val.toLocaleString();
}
