import { describe, it, expect } from "vitest";
import { niceScale } from "./niceScale";

describe("niceScale", () => {
  it("top tick always covers the max value", () => {
    for (const max of [0.7, 1, 3, 8, 11.5, 47, 478188, 999_999]) {
      const ticks = niceScale(max, 4);
      expect(ticks).toHaveLength(5);
      expect(ticks[0]).toBe(0);
      expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(max);
    }
  });

  it("uses 1/2/5 steps", () => {
    expect(niceScale(11.5, 4)).toEqual([0, 5, 10, 15, 20]);
    expect(niceScale(8, 4)).toEqual([0, 2, 4, 6, 8]);
    expect(niceScale(478188, 4)).toEqual([0, 200000, 400000, 600000, 800000]);
  });
});
