import { describe, it, expect } from "vitest";
import { getMapSeverityColors, getTokens } from "./tokens";
import { PALETTE_SEVERITY } from "./palettes";

describe("getMapSeverityColors", () => {
  const themeSeverity = getTokens("default", false).severity;

  it("defers to the theme severity tokens for the default map palette", () => {
    expect(getMapSeverityColors("default", false, themeSeverity)).toBe(themeSeverity);
    expect(getMapSeverityColors("default", true, themeSeverity)).toBe(themeSeverity);
  });

  it("uses the colorblind-safe severity colors when the colorblind palette is selected", () => {
    expect(getMapSeverityColors("colorblind", false, themeSeverity)).toEqual(
      PALETTE_SEVERITY.colorblind,
    );
  });

  it("uses each non-default palette's hand-picked severity colors", () => {
    expect(getMapSeverityColors("warm", false, themeSeverity)).toEqual(PALETTE_SEVERITY.warm);
    expect(getMapSeverityColors("cool", false, themeSeverity)).toEqual(PALETTE_SEVERITY.cool);
  });

  it("lightens non-default palette colors in dark mode", () => {
    const light = getMapSeverityColors("colorblind", false, themeSeverity);
    const dark = getMapSeverityColors("colorblind", true, themeSeverity);
    expect(dark.fatal).not.toBe(light.fatal);
    expect(dark.injury).not.toBe(light.injury);
    expect(dark.pdo).not.toBe(light.pdo);
    // Same treatment getTokens applies to its own severity tokens.
    expect(dark).toEqual(getTokens("colorblind", true).severity);
  });
});
