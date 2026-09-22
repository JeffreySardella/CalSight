import { describe, it, expect } from "vitest";
import { buildCaptionLines, CAPTION_ATTRIBUTION } from "./chartCaption";

describe("buildCaptionLines", () => {
  it("composes just the title and attribution for a plain crash-count chart with no filters", () => {
    const lines = buildCaptionLines({ title: "Crashes by Year" });

    expect(lines).toEqual([
      { text: "Crashes by Year", kind: "title" },
      { text: CAPTION_ATTRIBUTION, kind: "attribution" },
    ]);
  });

  it("includes the mode footnote verbatim for a person-level chart", () => {
    const modeNote = "* Counts people injured or killed, not crashes. Mode data starts in 2016 (CCRS).";
    const lines = buildCaptionLines({ title: "People by Mode of Travel*", footnotes: [modeNote] });

    expect(lines).toEqual([
      { text: "People by Mode of Travel*", kind: "title" },
      { text: modeNote, kind: "footnote" },
      { text: CAPTION_ATTRIBUTION, kind: "attribution" },
    ]);
  });

  it("includes the active-filter summary for a chart with year + severity + county filters", () => {
    const filterSummary = "Fresno County · 2019-01 → 2024-12 · Fatal, Injury";
    const lines = buildCaptionLines({ title: "Crashes by Year", filterSummary });

    expect(lines).toEqual([
      { text: "Crashes by Year", kind: "title" },
      { text: filterSummary, kind: "filter" },
      { text: CAPTION_ATTRIBUTION, kind: "attribution" },
    ]);
  });

  it("puts the filter summary before footnotes, and the attribution line last no matter how many lines precede it", () => {
    const lines = buildCaptionLines({
      title: "Killed or Seriously Injured by Year*",
      filterSummary: "Fresno County · 2015-01 → 2018-12",
      footnotes: ["KSI footnote.", "Partial-year footnote."],
    });

    expect(lines.map((l) => l.kind)).toEqual(["title", "filter", "footnote", "footnote", "attribution"]);
    expect(lines[lines.length - 1]).toEqual({ text: CAPTION_ATTRIBUTION, kind: "attribution" });
  });

  it("omits the filter line when filterSummary is null, undefined, or empty", () => {
    for (const filterSummary of [null, undefined, ""] as const) {
      const lines = buildCaptionLines({ title: "Crashes by Year", filterSummary });
      expect(lines.some((l) => l.kind === "filter")).toBe(false);
    }
  });

  it("skips falsy footnote entries without leaving gaps", () => {
    const lines = buildCaptionLines({
      title: "Crashes by Year",
      footnotes: [null, "Real note.", undefined, ""],
    });

    expect(lines).toEqual([
      { text: "Crashes by Year", kind: "title" },
      { text: "Real note.", kind: "footnote" },
      { text: CAPTION_ATTRIBUTION, kind: "attribution" },
    ]);
  });

  it("always appends the attribution line even with no filters or footnotes", () => {
    const lines = buildCaptionLines({ title: "Any Chart" });
    expect(lines[lines.length - 1]).toEqual({ text: CAPTION_ATTRIBUTION, kind: "attribution" });
  });
});
