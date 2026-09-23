/** 1234 → "1.2K" ("1K" with kDigits 0), 2_500_000 → "2.5M"; below 1,000 it keeps locale grouping. */
export function formatCompact(val: number, kDigits = 1): string {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(kDigits)}K`;
  return val.toLocaleString();
}
