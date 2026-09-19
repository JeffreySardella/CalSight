import { test, expect, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5174";

// Hermetic e2e for the Stats hero sparklines (lib/partialYear.ts's
// excludePartialYear): the in-progress calendar year must never be plotted,
// since it would read as a dramatic drop that's really just missing months.
// Every /api call is fulfilled from fixtures via route interception, same
// spirit as water.spec.ts.

const CURRENT_YEAR = new Date().getFullYear();

// 10 complete years, each measure trending UP so the most recent complete
// year (CURRENT_YEAR - 1) holds the MAX value — its sparkline dot lands near
// the TOP. The current (partial) year is a deliberate cliff: far below every
// complete year, so if it ever leaked into the sparkline the end dot would
// jump to the BOTTOM instead. That gap is what the assertions below detect.
const COMPLETE_YEARS = Array.from({ length: 10 }, (_, i) => ({
  year: CURRENT_YEAR - 10 + i,
  crash_count: 100_000 + i * 5_000,
  total_killed: 1_000 + i * 50,
  total_injured: 20_000 + i * 300,
}));
const PARTIAL_CURRENT_YEAR = { year: CURRENT_YEAR, crash_count: 500, total_killed: 5, total_injured: 50 };

const BATCH_RESPONSE = {
  year: [...COMPLETE_YEARS, PARTIAL_CURRENT_YEAR],
};

async function mockStatsApi(page: Page) {
  await page.route("**/api/**", (route) => route.fulfill({ status: 404, body: "not mocked" }));
  await page.route("**/api/stats/batch", (route) => route.fulfill({ json: BATCH_RESPONSE }));
  await page.route("**/api/demographics**", (route) => route.fulfill({ json: [] }));
}

test.beforeEach(async ({ page }) => {
  await mockStatsApi(page);
});

const SPARKLINES = [
  { name: /Incident trend, last 10 years/i },
  // The tile is "Killed and injured" before the KSI frontend lands and
  // "Killed or seriously injured" after it; the partial-year rule is the same.
  { name: /Killed (and injured|or seriously injured) trend, last 10 years/i },
  { name: /Fatality trend, last 10 years/i },
];

test("hero sparklines cover the last 10 complete years and never plot the in-progress year", async ({ page }) => {
  await page.goto(`${BASE_URL}/stats`);
  await page.waitForSelector(".chart-card-enter", { timeout: 15000 });
  await expect(page.locator("p.hero-value").first()).toBeVisible({ timeout: 15000 });

  for (const { name } of SPARKLINES) {
    const sparkline = page.getByRole("img", { name });
    await expect(sparkline).toBeVisible();

    // The end dot (showEndDot) is the only <circle> in the sparkline. Its cy
    // encodes the last plotted value: with our fixture, the correct last
    // point (CURRENT_YEAR - 1) is the series MAX (cy near the top, ~3 of a
    // 20px-tall sparkline). A regression that plots the partial current year
    // instead would plot the series MIN there (cy near the bottom, ~17).
    const cy = await sparkline.locator("circle").getAttribute("cy");
    expect(cy).not.toBeNull();
    expect(Number(cy)).toBeLessThan(10);
  }
});
