/**
 * Shared arrow-key stepping for keyboard-navigable charts.
 *
 * Mirrors the convention SimpleLineChart established: the chart's <svg> is
 * focusable (tabIndex=0), arrow keys walk the data points (tooltip follows),
 * Home/End jump to the first/last point, and each step is announced through a
 * polite `role="status"` live region rendered next to the svg.
 *
 * Returns the next index to focus, or null when the key is not a navigation
 * key (so callers can let other keys fall through untouched).
 */
export function nextChartIndex(
  key: string,
  current: number | null | undefined,
  length: number,
): number | null {
  if (length <= 0) return null;
  const cur = current ?? -1;
  // ArrowDown/ArrowUp are accepted as aliases so vertical layouts
  // (lollipops, stacked treemaps) and radial charts feel natural too.
  if (key === "ArrowRight" || key === "ArrowDown") {
    return cur === -1 ? 0 : Math.min(length - 1, cur + 1);
  }
  if (key === "ArrowLeft" || key === "ArrowUp") {
    return cur === -1 ? length - 1 : Math.max(0, cur - 1);
  }
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  return null;
}
