// Generates public/sitemap.xml from the source of truth (static routes below,
// plus every preset key and story id) instead of a hand-maintained file, so a
// new preset or story can never be silently left out of search indexing.
// Runs before `vite build` in the `build` npm script; the result lands in
// public/ so `vite build` copies it into dist/ like any other static asset.
//
// presets.ts/stories.ts are TypeScript, so we transpile them with esbuild
// (already a direct dependency of vite, hence already in node_modules)
// instead of adding a TS-execution package.
//
// buildSitemapEntries() is exported so generate-sitemap.test.mjs can assert
// coverage without re-implementing this logic.

import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import esbuild from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..");

async function loadTsModule(relPath) {
  // Bundled, not just transpiled: stories.ts imports its callout helpers, and
  // a data: URL module can't resolve relative imports on its own.
  const { outputFiles } = esbuild.buildSync({
    entryPoints: [path.join(ROOT, relPath)], bundle: true, format: "esm", write: false,
  });
  const code = outputFiles[0].text;
  const dataUrl = "data:text/javascript;base64," + Buffer.from(code).toString("base64");
  return import(dataUrl);
}

// CA_COUNTIES lives in useFilterParams.ts, which (unlike presets.ts/stories.ts)
// has real runtime imports (react, useSearchParamsWriter) that loadTsModule's
// bare esbuild-transform-and-import can't resolve. Reading the array out of
// the source text avoids executing the module at all, while still tracking
// it as the single source of truth instead of a hand-typed county list.
function loadCaCounties() {
  const src = readFileSync(path.join(ROOT, "src/hooks/useFilterParams.ts"), "utf8");
  const match = src.match(/export const CA_COUNTIES = \[([\s\S]*?)\] as const;/);
  if (!match) throw new Error("CA_COUNTIES not found in src/hooks/useFilterParams.ts");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

// Mirrors slugify() in src/hooks/useFilterParams.ts — keep the two in sync.
function slugify(value) {
  return value.toLowerCase().replace(/ /g, "-");
}

export const SITE_URL = "https://calsight.org";

// Site chrome — routes that aren't derived from a data module. Priority/
// changefreq mirror what these pages actually are (Water refreshes daily;
// legal pages almost never change).
export const STATIC_ROUTES = [
  { loc: "/", changefreq: "weekly", priority: "1.0" },
  { loc: "/stats", changefreq: "weekly", priority: "0.9" },
  { loc: "/ask", changefreq: "monthly", priority: "0.8" },
  { loc: "/water", changefreq: "daily", priority: "0.8" },
  { loc: "/about", changefreq: "monthly", priority: "0.6" },
  { loc: "/privacy", changefreq: "yearly", priority: "0.3" },
  { loc: "/terms", changefreq: "yearly", priority: "0.3" },
];

export async function buildSitemapEntries() {
  const { PRESET_KEYS } = await loadTsModule("src/lib/dashboard/presets.ts");
  const { STORY_IDS } = await loadTsModule("src/lib/dashboard/stories.ts");
  const countyNames = loadCaCounties();
  const lastmod = new Date().toISOString().slice(0, 10);

  const urls = [
    ...STATIC_ROUTES,
    ...PRESET_KEYS.map((key) => ({ loc: `/stats?preset=${key}`, changefreq: "weekly", priority: "0.7" })),
    ...STORY_IDS.map((id) => ({ loc: `/stats?story=${id}`, changefreq: "weekly", priority: "0.6" })),
    // The county report cards are the site's best pages (see mobile-audit)
    // and were previously missing from the sitemap entirely.
    ...countyNames.map((name) => ({ loc: `/county/${slugify(name)}/report`, changefreq: "monthly", priority: "0.7" })),
  ].map((u) => ({ ...u, lastmod }));

  return { urls, presetKeys: PRESET_KEYS, storyIds: STORY_IDS, countyNames };
}

export function renderSitemapXml(urls) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${SITE_URL}${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`,
  )
  .join("\n")}
</urlset>
`;
}

// Only run as a script when invoked directly (`node scripts/generate-sitemap.mjs`),
// not when imported by the vitest coverage test.
if (process.argv[1] === __filename) {
  const { urls, presetKeys, storyIds, countyNames } = await buildSitemapEntries();
  writeFileSync(path.join(ROOT, "public/sitemap.xml"), renderSitemapXml(urls));
  console.log(`sitemap.xml: ${urls.length} URLs (${STATIC_ROUTES.length} static, ${presetKeys.length} presets, ${storyIds.length} stories, ${countyNames.length} county reports)`);
}
