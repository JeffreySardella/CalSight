import type { PresetKey } from "./types";
import { PRESETS } from "./presets";
import type { DataStory } from "./stories";

/**
 * Per-route <title>/description for /stats. A deep-linked story (?story=<id>)
 * uses the reader's own headline and subtitle; otherwise every preset gets a
 * distinct description built from its existing PRESETS[key].description copy
 * — so no preset is stuck sharing the generic "Statistics Dashboard" title.
 * Pulled out of StatsPage so it's unit-testable without mounting the page.
 */
export function buildStatsPageSeo(params: {
  preset: PresetKey;
  story: DataStory | null;
  counties: string[];
  totalIncidents: number | null;
}): { title: string; description: string } {
  if (params.story) {
    return {
      title: `${params.story.title} — CalSight`,
      description: params.story.subtitle,
    };
  }

  const activePreset = PRESETS[params.preset] ?? PRESETS.overview;
  const parts = [activePreset.description];
  if (params.counties.length > 0 && params.counties.length <= 3) {
    parts.push(`for ${params.counties.join(", ")}`);
  }
  if (params.totalIncidents != null) {
    parts.push(`— ${params.totalIncidents.toLocaleString()} incidents`);
  }
  parts.push(". Explore on CalSight.");

  return {
    title: `${activePreset.label} — CalSight`,
    description: parts.join(" "),
  };
}
