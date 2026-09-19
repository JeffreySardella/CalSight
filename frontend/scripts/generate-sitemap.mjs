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
  const src = readFileSync(path.join(ROOT, relPath), "utf8");
  const { code } = esbuild.transformSync(src, { loader: "ts", format: "esm" });
  const dataUrl = "data:text/javascript;base64," + Buffer.from(code).toString("base64");
  return import(dataUrl);
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
  const lastmod = new Date().toISOString().slice(0, 10);

  const urls = [
    ...STATIC_ROUTES,
    ...PRESET_KEYS.map((key) => ({ loc: `/stats?preset=${key}`, changefreq: "weekly", priority: "0.7" })),
    ...STORY_IDS.map((id) => ({ loc: `/stats?story=${id}`, changefreq: "weekly", priority: "0.6" })),
  ].map((u) => ({ ...u, lastmod }));

  return { urls, presetKeys: PRESET_KEYS, storyIds: STORY_IDS };
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
  const { urls, presetKeys, storyIds } = await buildSitemapEntries();
  writeFileSync(path.join(ROOT, "public/sitemap.xml"), renderSitemapXml(urls));
  console.log(`sitemap.xml: ${urls.length} URLs (${STATIC_ROUTES.length} static, ${presetKeys.length} presets, ${storyIds.length} stories)`);
}
