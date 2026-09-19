import { describe, it, expect } from "vitest";
import { DATA_STORIES, STORY_IDS, getStoryById } from "./stories";

describe("DATA_STORIES index", () => {
  it("has unique story ids and unique block ids within each story", () => {
    expect(new Set(STORY_IDS).size).toBe(STORY_IDS.length);
    for (const story of DATA_STORIES) {
      const blockIds = story.blocks
        .map((b) => ("id" in b ? b.id : null))
        .filter((id): id is string => id !== null);
      expect(new Set(blockIds).size).toBe(blockIds.length);
    }
  });

  it("gives every story a title, subtitle, icon and at least one block", () => {
    for (const story of DATA_STORIES) {
      expect(story.title).toBeTruthy();
      expect(story.subtitle).toBeTruthy();
      expect(story.icon).toBeTruthy();
      expect(story.blocks.length).toBeGreaterThan(0);
      expect(getStoryById(story.id)).toBe(story);
    }
  });

  it("registers the tule-fog story with a county block per valley county it names", () => {
    const story = getStoryById("tule-fog");
    expect(story).toBeDefined();
    expect(STORY_IDS).toContain("tule-fog");
    const counties = story!.blocks
      .filter((b) => b.type === "tule-fog")
      .map((b) => (b as { countySlug: string }).countySlug);
    expect(counties).toEqual(["fresno", "kern"]);
    // It must state the limits of the data, not just the finding.
    const narratives = story!.blocks.filter((b) => b.type === "narrative");
    const bodies = narratives
      .map((b) => (b as { body: unknown }).body)
      .filter((b): b is string => typeof b === "string")
      .join(" ");
    expect(bodies).toMatch(/association/i);
    expect(bodies).toMatch(/cannot say the fog caused/i);
  });
});
