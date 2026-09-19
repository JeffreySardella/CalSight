import { test, expect, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5174";

// Hermetic e2e for the Safety Overview year chart's secondary line (PR
// preset.ts "Crashes vs Deaths per 1,000 Crashes by Year" — the two lines
// diverge after 2019, which a crash-count-only chart never shows). Every
// /api call is fulfilled from fixtures via route interception, same spirit
// as water.spec.ts, so the dual-axis chart always has data to draw.

const CURRENT_YEAR = new Date().getFullYear();

// 11 years of "year" rows: the app drops the in-progress current year, so
// this leaves exactly 10 complete years for the chart.
const YEAR_ROWS = Array.from({ length: 11 }, (_, i) => {
  const year = CURRENT_YEAR - 10 + i;
  return { year, crash_count: 200_000 - i * 1_000, total_killed: 3_000 + i * 40, total_injured: 90_000 };
});

const BATCH_RESPONSE = {
  severity: [
    { severity: "Fatal", crash_count: 3_500, total_killed: 3_500, total_injured: 0 },
    { severity: "Injury", crash_count: 150_000, total_killed: 0, total_injured: 200_000 },
    { severity: "Property Damage Only", crash_count: 46_500, total_killed: 0, total_injured: 0 },
  ],
  cause: [
    { canonical_cause: "speeding", crash_count: 50_000, total_killed: 900, total_injured: 60_000 },
    { canonical_cause: "dui", crash_count: 20_000, total_killed: 700, total_injured: 25_000 },
  ],
  year: YEAR_ROWS,
  county: [
    { county_code: 19, county_name: "Los Angeles", crash_count: 80_000, total_killed: 900, total_injured: 100_000 },
    { county_code: 34, county_name: "Sacramento", crash_count: 20_000, total_killed: 250, total_injured: 25_000 },
  ],
};

async function mockStatsApi(page: Page) {
  await page.route("**/api/**", (route) => route.fulfill({ status: 404, body: "not mocked" }));
  await page.route("**/api/stats/batch", (route) => route.fulfill({ json: BATCH_RESPONSE }));
  await page.route("**/api/demographics**", (route) => route.fulfill({ json: [] }));
}

test.beforeEach(async ({ page }) => {
  await mockStatsApi(page);
});

test("Safety Overview year chart shows the Deaths per 1,000 Crashes secondary line with a right axis", async ({ page }) => {
  await page.goto(`${BASE_URL}/stats`);
  await page.waitForSelector(".chart-card-enter", { timeout: 15000 });

  // The dual-axis chart's title merges both measures around "by Year".
  const heading = page.locator("h3", { hasText: "Deaths per 1,000 Crashes by Year" });
  await expect(heading).toBeVisible();

  const card = page.locator(".chart-card-enter").filter({ has: heading });

  // Wait for the dual-axis SVG to actually draw (skeleton clears once data lands).
  const svg = card.locator("svg").first();
  await expect(svg).toBeVisible();

  // The right Y-axis is drawn as a <line> in the secondary (tertiary) color —
  // distinct from the left axis, which uses the primary color.
  const rightAxisLine = svg.locator('line[stroke="rgb(var(--tertiary))"]');
  await expect(rightAxisLine.first()).toBeAttached();

  // The legend names both series.
  await expect(svg.locator("text", { hasText: "Crash Count" })).toBeVisible();
  await expect(svg.locator("text", { hasText: "Deaths per 1,000 Crashes" })).toBeVisible();
});
