import { describe, it, expect } from "vitest";
import { buildStatsPageSeo } from "./pageSeo";
import { PRESETS, PRESET_KEYS } from "./presets";
import { DATA_STORIES } from "./stories";

describe("buildStatsPageSeo", () => {
  it("gives every preset its own title and description", () => {
    const seen = new Set<string>();
    for (const key of PRESET_KEYS) {
      const { title, description } = buildStatsPageSeo({
        preset: key,
        story: null,
        counties: [],
        totalIncidents: null,
      });
      expect(title).toBe(`${PRESETS[key].label} — CalSight`);
      expect(description).toContain(PRESETS[key].description);
      expect(seen.has(title)).toBe(false); // distinct per preset
      seen.add(title);
    }
  });

  it("uses the story's own title and subtitle when a story is active, ignoring the preset", () => {
    const story = DATA_STORIES[0];
    const { title, description } = buildStatsPageSeo({
      preset: "dui", // should be ignored while a story is active
      story,
      counties: [],
      totalIncidents: null,
    });
    expect(title).toBe(`${story.title} — CalSight`);
    expect(description).toBe(story.subtitle);
  });

  it("every story produces a title distinct from every preset's title", () => {
    const presetTitles = new Set(PRESET_KEYS.map((k) => `${PRESETS[k].label} — CalSight`));
    for (const story of DATA_STORIES) {
      const { title } = buildStatsPageSeo({ preset: "overview", story, counties: [], totalIncidents: null });
      expect(presetTitles.has(title)).toBe(false);
    }
  });

  it("folds in county names and the incident total when present", () => {
    const { description } = buildStatsPageSeo({
      preset: "overview",
      story: null,
      counties: ["Los Angeles"],
      totalIncidents: 12345,
    });
    expect(description).toContain("for Los Angeles");
    expect(description).toContain("12,345 incidents");
  });
});
