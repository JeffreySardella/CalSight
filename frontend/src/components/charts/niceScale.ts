// Tick values 0..ticks*step where step is the smallest "nice" step (1/2/5 x 10^n)
// with step >= maxVal/ticks, so the top tick always covers the data. The old
// rounding thresholds (1.5/3/7) could pick a step below maxVal/ticks and draw
// the largest points above the plot area.
export function niceScale(maxVal: number, ticks: number): number[] {
  if (maxVal <= 0) return Array.from({ length: ticks + 1 }, (_, i) => i);
  const rawStep = maxVal / ticks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const residual = rawStep / magnitude;
  let niceStep: number;
  if (residual <= 1) niceStep = 1 * magnitude;
  else if (residual <= 2) niceStep = 2 * magnitude;
  else if (residual <= 5) niceStep = 5 * magnitude;
  else niceStep = 10 * magnitude;
  return Array.from({ length: ticks + 1 }, (_, i) => Math.round(niceStep * i * 100) / 100);
}
