import { describe, it, expect } from "vitest";
import { DATA_STORIES, STORY_IDS, getStoryById } from "./stories";

/** Every narrative body in the holidays story, resolved against no filters. */
function holidayNarratives(): string[] {
  return getStoryById("holidays-on-the-road")!.blocks.flatMap((block) => {
    if (block.type !== "narrative") return [];
    return [
      typeof block.body === "function"
        ? block.body({
            countyCount: 58, countyNames: [], hasSeverityFilter: false,
            severities: [], hasDateFilter: false, isFiltered: false,
          })
        : block.body,
    ];
  });
}

describe("data story registration", () => {
  it("has unique ids and every story is reachable by id", () => {
    expect(new Set(STORY_IDS).size).toBe(STORY_IDS.length);
    for (const id of STORY_IDS) {
      expect(getStoryById(id)?.id).toBe(id);
    }
  });

  it("gives every story a title, subtitle, icon and at least one block", () => {
    for (const story of DATA_STORIES) {
      expect(story.title).toBeTruthy();
      expect(story.subtitle).toBeTruthy();
      expect(story.icon).toBeTruthy();
      expect(story.blocks.length).toBeGreaterThan(0);
    }
  });

  it("registers the holidays story", () => {
    const story = getStoryById("holidays-on-the-road");
    expect(story).toBeDefined();
    expect(story!.title).toBe("Holidays on the road");
    expect(story!.blocks.some((b) => b.type === "holidays")).toBe(true);
  });

  it("keeps hard-coded figures out of the holidays narrative — every number is rendered from the endpoint", () => {
    for (const body of holidayNarratives()) {
      // Calendar dates (October 31, November 1) are definitions, not findings;
      // a percentage or a thousands-separated count would be a stale figure.
      expect(body).not.toMatch(/\d+(\.\d+)?\s?%/);
      expect(body).not.toMatch(/\d,\d{3}/);
    }
  });

  it("keeps the holidays copy on the DUI metric, not on alcohol generally", () => {
    // The metric is canonical_cause = 'dui', an officer-coded primary cause —
    // not a measure of whether anyone had been drinking.
    for (const body of holidayNarratives()) {
      expect(body.toLowerCase()).not.toMatch(/alcohol|drinking|drunk/);
    }
  });

  it("gives every chart block a unique slot id", () => {
    const ids = DATA_STORIES.flatMap((s) =>
      s.blocks.filter((b) => "id" in b).map((b) => (b as { id: string }).id),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});
