import { describe, it, expect, beforeEach } from "vitest";
import { PALETTES, HATCH_PATTERN_ID, installHatchPattern, getPalette, type PaletteKey } from "./palettes";

describe("palettes", () => {
  const keys: PaletteKey[] = ["default", "warm", "cool", "colorblind"];

  it.each(keys)("palette %s has 5 light colors and 5 dark colors", (key) => {
    expect(PALETTES[key].light).toHaveLength(5);
    expect(PALETTES[key].dark).toHaveLength(5);
  });

  it.each(keys)("palette %s colors are all valid 6-digit hex (both variants)", (key) => {
    for (const hex of PALETTES[key].light) {
      expect(hex).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
    for (const hex of PALETTES[key].dark) {
      expect(hex).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("getPalette returns the light variant when isDark=false", () => {
    expect(getPalette("default", false)).toEqual(PALETTES.default.light);
  });

  it("getPalette returns the dark variant when isDark=true", () => {
    expect(getPalette("default", true)).toEqual(PALETTES.default.dark);
  });
});

describe("installHatchPattern", () => {
  beforeEach(() => {
    document.getElementById(`${HATCH_PATTERN_ID}-host`)?.remove();
  });

  it("mounts an SVG containing the pattern on first call", () => {
    installHatchPattern();
    const host = document.getElementById(`${HATCH_PATTERN_ID}-host`);
    expect(host).not.toBeNull();
    expect(host!.querySelector(`#${HATCH_PATTERN_ID}`)).not.toBeNull();
  });

  it("is idempotent on repeated calls", () => {
    installHatchPattern();
    installHatchPattern();
    installHatchPattern();
    expect(document.querySelectorAll(`#${HATCH_PATTERN_ID}-host`).length).toBe(1);
  });
});
