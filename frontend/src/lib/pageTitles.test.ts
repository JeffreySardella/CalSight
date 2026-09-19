import { describe, it, expect } from "vitest";
import { pageTitleFor, DEFAULT_PAGE_TITLE } from "./pageTitles";
import { PRESETS } from "./dashboard/presets";
import { DATA_STORIES } from "./dashboard/stories";

describe("pageTitleFor", () => {
  it("titles the known routes", () => {
    expect(pageTitleFor("/")).toBe("Map Explorer — CalSight");
    expect(pageTitleFor("/stats")).toBe("Statistics Dashboard — CalSight");
    expect(pageTitleFor("/water")).toBe("Water — CalSight");
  });

  it("bare /stats (no query) keeps the generic dashboard title", () => {
    expect(pageTitleFor("/stats", "")).toBe("Statistics Dashboard — CalSight");
    expect(pageTitleFor("/stats", "?dashboard=abc123")).toBe("Statistics Dashboard — CalSight");
  });

  it("/stats?story=<id> titles the tab with the story, not the dashboard default", () => {
    const story = DATA_STORIES[0];
    expect(pageTitleFor("/stats", `?story=${story.id}`)).toBe(`${story.title} — CalSight`);
    // An unrecognised story id is not a crash — falls back to the generic title.
    expect(pageTitleFor("/stats", "?story=does-not-exist")).toBe("Statistics Dashboard — CalSight");
  });

  it("/stats?preset=<key> titles the tab with the preset", () => {
    expect(pageTitleFor("/stats", "?preset=dui")).toBe(`${PRESETS.dui.label} — CalSight`);
    expect(pageTitleFor("/stats", "?preset=equity")).toBe(`${PRESETS.equity.label} — CalSight`);
    // An unrecognised preset key falls back to overview rather than crashing.
    expect(pageTitleFor("/stats", "?preset=not-a-preset")).toBe(`${PRESETS.overview.label} — CalSight`);
  });

  it("story wins over preset when both are present", () => {
    const story = DATA_STORIES[0];
    expect(pageTitleFor("/stats", `?preset=dui&story=${story.id}`)).toBe(`${story.title} — CalSight`);
  });

  it("falls back to the site title for anything unrecognised", () => {
    expect(pageTitleFor("/nope")).toBe(DEFAULT_PAGE_TITLE);
    expect(pageTitleFor("/county")).toBe(DEFAULT_PAGE_TITLE);
    expect(pageTitleFor("/county/alpine")).toBe(DEFAULT_PAGE_TITLE);
  });

  it("stands aside for the county report card, which knows its own county", () => {
    // Null means "the page sets document.title" — Layout's effect runs after
    // the page's, so anything it returned here would win over the county name.
    expect(pageTitleFor("/county/alpine/report")).toBeNull();
    expect(pageTitleFor("/county/los-angeles/report")).toBeNull();
    expect(pageTitleFor("/county/alpine/report/")).toBeNull();
    // Including a slug that is not a county: the page titles that one too,
    // with its not-found title.
    expect(pageTitleFor("/county/atlantis/report")).toBeNull();
  });

  it("does not stand aside for neighbouring paths", () => {
    expect(pageTitleFor("/county/alpine/report/extra")).toBe(DEFAULT_PAGE_TITLE);
    expect(pageTitleFor("/county//report")).toBe(DEFAULT_PAGE_TITLE);
  });
});
