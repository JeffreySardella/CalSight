import { test, expect, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5174";

// Hermetic e2e for the choropleth's "nothing to color" empty state
// (pages/MapPage.tsx + hooks/useChoroplethData.ts's allCountiesNoData): a
// filter/measure combination can match plenty of crashes yet fail to color a
// single county (e.g. a per-driver measure with no DMV rows for any county).
// Every /api call is fulfilled from fixtures via route interception, same
// spirit as water.spec.ts.

// At least MIN_BUCKET_SUBSET(3) counties — quantileBuckets (lib/choropleth/
// binning.ts) returns null (no bucket breaks at all) below that floor.
const COUNTIES = [
  { county_code: 15, county_name: "Kern" },
  { county_code: 34, county_name: "Sacramento" },
  { county_code: 45, county_name: "Shasta" },
];

// Small (<1,000) counts so "Total crashes" formats as plain integers
// ("compact()" in lib/choropleth/measures.ts only adds a "K"/"M" suffix and
// a decimal above 1,000), which is what the last assertion checks for.
const COUNTY_STATS = COUNTIES.map((c, i) => ({ ...c, crash_count: 40 + i * 20, total_killed: 2, total_injured: 30 }));
const YEAR_STATS = [{ year: 2023, crash_count: 60, total_killed: 2, total_injured: 50 }, { year: 2024, crash_count: 40, total_killed: 2, total_injured: 30 }];

// A "Fatal"-only filter matches real crashes statewide (yearStats below) but
// leaves each individual county under the MIN_CRASHES_FOR_RATE(5) floor, so
// the default per-capita measure can't color any of them — a filter-driven
// empty state, distinct from test 1's data-driven one.
const RESTRICTED_COUNTY_STATS = COUNTIES.map((c) => ({ ...c, crash_count: 2, total_killed: 2, total_injured: 0 }));
const DEMOGRAPHICS = COUNTIES.flatMap((c) => [2023, 2024].map((year) => ({ county_code: c.county_code, year, population: 500_000 })));

async function mockChoroplethApi(page: Page) {
  await page.route("**/api/**", (route) => route.fulfill({ status: 404, body: "not mocked" }));
  await page.route("**/api/stats**", (route) => {
    const url = route.request().url();
    if (url.includes("group_by=county")) {
      return route.fulfill({ json: url.includes("severity=") ? RESTRICTED_COUNTY_STATS : COUNTY_STATS });
    }
    if (url.includes("group_by=year")) return route.fulfill({ json: YEAR_STATS });
    return route.fulfill({ json: { total_crashes: 11_500_000 } });
  });
  await page.route("**/api/demographics**", (route) => route.fulfill({ json: DEMOGRAPHICS }));
  // No licensed-driver rows for any county — the per-driver measure can't
  // compute a rate for a single one, even though crashes matched.
  await page.route("**/api/licensed-drivers**", (route) => route.fulfill({ json: [] }));
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("calsight-intro-seen", "1");
    // A filtered URL (test 2 loads with ?severity=fatal) otherwise opens the
    // "Filtered URL" prompt on top of everything, intercepting clicks meant
    // for the choropleth's own empty-state popup underneath it.
    sessionStorage.setItem("calsight-filter-prompt-dismissed", "1");
  });
  await mockChoroplethApi(page);
});

test("a measure with no colorable data shows the empty-state popup, and recovering restores the map", async ({ page }) => {
  await page.goto(`${BASE_URL}/?measure=crashes_per_10k_drivers`);

  const popup = page.getByRole("dialog", { name: "Nothing to color for this selection" });
  await expect(popup).toBeVisible();
  await expect(popup).toContainText("Crashes per 10k licensed drivers has no data");

  await popup.getByRole("button", { name: "Show total crashes" }).click();
  await expect(popup).not.toBeVisible();

  const legend = page.locator('[data-testid="choropleth-legend"]');
  const triggerLabel = legend.locator('button[aria-haspopup="listbox"] span').first();
  await expect(triggerLabel).toHaveText("Total crashes");

  // Bucket breaks for a raw count are plain integers (no "%", "$", or
  // decimal point — unlike every per-capita/rate measure's formatLabel).
  const bucketEdges = legend.locator(".flex.justify-between.text-\\[10px\\] span");
  await expect(bucketEdges.first()).toBeVisible();
  const edgeTexts = await bucketEdges.allTextContents();
  expect(edgeTexts.length).toBeGreaterThan(0);
  for (const text of edgeTexts) {
    expect(text).toMatch(/^[\d,]+$/);
  }
});

test("Clear All Filters recovers the default map from the empty state", async ({ page }) => {
  // The default (per-100k) measure, restricted to Fatal: every county's
  // fatal count is real but under the MIN_CRASHES_FOR_RATE(5) floor.
  await page.goto(`${BASE_URL}/?severity=fatal`);

  const popup = page.getByRole("dialog", { name: "Nothing to color for this selection" });
  await expect(popup).toBeVisible();

  await popup.getByRole("button", { name: "Clear All Filters" }).click();
  // A confirmation dialog guards the clear (there's active filter state to lose).
  await page.getByRole("button", { name: "Clear all", exact: true }).click();

  await expect(popup).not.toBeVisible();
  await expect(page).not.toHaveURL(/severity=/);

  // The measure is unchanged (crashes per 100k) — clearing the filter alone
  // brought every county back over the floor, restoring the default map.
  const legend = page.locator('[data-testid="choropleth-legend"]');
  const triggerLabel = legend.locator('button[aria-haspopup="listbox"] span').first();
  await expect(triggerLabel).toHaveText("Crashes per 100k residents");
});
