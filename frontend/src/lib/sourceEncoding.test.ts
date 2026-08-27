import { describe, it, expect } from "vitest";

/**
 * Guard against UTF-8 text being re-saved through a CP1252 round-trip, which
 * turns an em dash into a three-character run starting with U+00E2 and mangles
 * an ellipsis the same way. A batch of source files had been damaged like that
 * and it reached users: the map's progress toast rendered its ellipsis as
 * garbage. Editors and tooling do this silently, so check the characters rather
 * than trusting review to catch it. Deliberately written without any example of
 * the corruption, so this file passes its own check.
 */

// A mojibake run always starts with one of the UTF-8 lead bytes that a CP1252
// decode renders as U+00C2/C3/E2/CE/CF, followed by a continuation byte shown
// either as Latin-1 (U+0080-U+00BF) or as the CP1252 character for that byte.
const MOJIBAKE =
  /[\u00c2\u00c3\u00e2\u00ce\u00cf](?:[\u0080-\u00bf]|[\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178])/;

const sources = import.meta.glob("../**/*.{ts,tsx,css}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("source encoding", () => {
  it("finds source files to check", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100);
  });

  it("has no CP1252 mojibake", () => {
    const bad: string[] = [];
    for (const [path, text] of Object.entries(sources)) {
      text.split("\n").forEach((line, i) => {
        const hit = MOJIBAKE.exec(line);
        if (hit) bad.push(`${path}:${i + 1}  ${JSON.stringify(hit[0])}`);
      });
    }
    expect(bad).toEqual([]);
  });

  it("has no byte-order marks", () => {
    const bad = Object.entries(sources)
      .filter(([, text]) => text.charCodeAt(0) === 0xfeff)
      .map(([path]) => path);
    expect(bad).toEqual([]);
  });
});
