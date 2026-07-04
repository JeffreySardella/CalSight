import { describe, it, expect } from "vitest";
import { isValidConfig } from "./validateConfig";
import { PRESET_KEYS } from "./presets";
import { DIMENSIONS, MEASURES } from "./types";

const valid = {
  mode: "simple",
  preset: PRESET_KEYS[0],
  charts: [{ id: "a", order: 0, dimension: DIMENSIONS[0], measure: MEASURES[0], chartType: "bar" }],
};

describe("isValidConfig", () => {
  it("accepts a well-formed config", () => {
    expect(isValidConfig(valid)).toBe(true);
  });

  it("rejects non-objects", () => {
    expect(isValidConfig(null)).toBe(false);
    expect(isValidConfig("x")).toBe(false);
    expect(isValidConfig(42)).toBe(false);
  });

  it("rejects an invalid mode or unknown preset", () => {
    expect(isValidConfig({ ...valid, mode: "bogus" })).toBe(false);
    expect(isValidConfig({ ...valid, preset: "not-a-preset" })).toBe(false);
  });

  it("rejects when charts is not an array", () => {
    expect(isValidConfig({ ...valid, charts: "nope" })).toBe(false);
  });

  it("rejects a chart with an invalid dimension/measure/chartType", () => {
    expect(isValidConfig({ ...valid, charts: [{ id: "a", order: 0, dimension: "bad", measure: MEASURES[0], chartType: "bar" }] })).toBe(false);
    expect(isValidConfig({ ...valid, charts: [{ id: "a", order: 0, dimension: DIMENSIONS[0], measure: MEASURES[0], chartType: "xyz" }] })).toBe(false);
  });

  it("does not throw on a null/garbage chart element", () => {
    expect(isValidConfig({ ...valid, charts: [null] })).toBe(false);
    expect(isValidConfig({ ...valid, charts: ["x"] })).toBe(false);
  });
});
