// @vitest-environment node
//
// esbuild's runtime self-check breaks under jsdom's patched TextEncoder (the
// project-wide default environment), so this file — which only touches
// node:fs and esbuild, never the DOM — opts back into the real Node env.
import { describe, it, expect } from "vitest";
import { buildSitemapEntries, renderSitemapXml, STATIC_ROUTES } from "./generate-sitemap.mjs";
import { STORY_IDS } from "../src/lib/dashboard/stories.ts";
import { PRESET_KEYS } from "../src/lib/dashboard/presets.ts";
import { CA_COUNTIES, slugify } from "../src/hooks/useFilterParams.ts";

// Guards the whole point of build-time generation: every story and preset
// that exists in the app must show up in the sitemap. If someone adds a
// story and forgets everything else, this fails instead of the story
// quietly staying unindexed forever.
describe("generate-sitemap", () => {
  it("includes every story id so a new story can never be forgotten", async () => {
    const { urls } = await buildSitemapEntries();
    const locs = urls.map((u) => u.loc);
    expect(STORY_IDS.length).toBeGreaterThan(0);
    for (const id of STORY_IDS) {
      expect(locs).toContain(`/stats?story=${id}`);
    }
  });

  it("includes every preset key", async () => {
    const { urls } = await buildSitemapEntries();
    const locs = urls.map((u) => u.loc);
    expect(PRESET_KEYS.length).toBeGreaterThan(0);
    for (const key of PRESET_KEYS) {
      expect(locs).toContain(`/stats?preset=${key}`);
    }
  });

  it("includes a report-card URL for every county", async () => {
    const { urls } = await buildSitemapEntries();
    const locs = urls.map((u) => u.loc);
    expect(CA_COUNTIES.length).toBe(58);
    for (const name of CA_COUNTIES) {
      expect(locs).toContain(`/county/${slugify(name)}/report`);
    }
  });

  it("includes every static route", async () => {
    const { urls } = await buildSitemapEntries();
    const locs = urls.map((u) => u.loc);
    for (const route of STATIC_ROUTES) {
      expect(locs).toContain(route.loc);
    }
  });

  it("renders well-formed XML with one <url> per entry", async () => {
    const { urls } = await buildSitemapEntries();
    const xml = renderSitemapXml(urls);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect((xml.match(/<url>/g) ?? []).length).toBe(urls.length);
    for (const u of urls) {
      expect(xml).toContain(`<loc>https://calsight.org${u.loc}</loc>`);
    }
  });
});
