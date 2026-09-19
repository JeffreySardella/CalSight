import { test, expect, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5174";

// Hermetic e2e for the /stats?story= deep links (lib/dashboard/stories.ts).
// Every /api call is fulfilled from fixtures via route interception, same
// spirit as water.spec.ts, so each story's charts and stat-callouts always
// have data to render — guarding against the "NaN"/"undefined" leaks a
// division-by-zero or a missing group can produce (see useDashboardData's
// in-band-error handling for /api/stats/batch).

const BATCH_RESPONSE = {
  county: [
    { county_code: 19, county_name: "Los Angeles", crash_count: 80_000, total_killed: 480, total_injured: 100_000 },
    { county_code: 34, county_name: "Sacramento", crash_count: 20_000, total_killed: 120, total_injured: 25_000 },
    { county_code: 45, county_name: "Shasta", crash_count: 1_200, total_killed: 29, total_injured: 900 },
    { county_code: 15, county_name: "Kern", crash_count: 9_000, total_killed: 90, total_injured: 8_000 },
  ],
  severity: [
    { severity: "Fatal", crash_count: 3_500, total_killed: 3_500, total_injured: 0 },
    { severity: "Injury", crash_count: 150_000, total_killed: 0, total_injured: 200_000 },
    { severity: "Property Damage Only", crash_count: 46_500, total_killed: 0, total_injured: 0 },
  ],
  hour: Array.from({ length: 24 }, (_, h) => ({ hour: h, crash_count: 500 + h * 20, total_killed: h, total_injured: h * 5 })),
  day_of_week: Array.from({ length: 7 }, (_, d) => ({ day_of_week: d, crash_count: 2_000 + d * 100, total_killed: d * 3, total_injured: d * 40 })),
};

async function mockStatsApi(page: Page) {
  await page.route("**/api/**", (route) => route.fulfill({ status: 404, body: "not mocked" }));
  await page.route("**/api/stats/batch", (route) => route.fulfill({ json: BATCH_RESPONSE }));
  await page.route("**/api/demographics**", (route) => route.fulfill({ json: [] }));
}

test.beforeEach(async ({ page }) => {
  await mockStatsApi(page);
});

async function expectNoBrokenNumbers(page: Page) {
  const text = await page.locator("article").innerText();
  expect(text).not.toMatch(/NaN/);
  expect(text).not.toMatch(/undefined/);
}

test("two-californias story renders its callout with digits and no NaN/undefined", async ({ page }) => {
  await page.goto(`${BASE_URL}/stats?story=two-californias`);

  await expect(page.getByRole("heading", { name: "The Two Californias" })).toBeVisible();

  const callout = page.locator("p", { hasText: "4.1x" });
  await expect(callout).toBeVisible();
  await expect(callout).toHaveText(/\d/);

  await expectNoBrokenNumbers(page);
});

test("DUI Clock story renders its callout with digits and no NaN/undefined", async ({ page }) => {
  await page.goto(`${BASE_URL}/stats?story=dui-clock`);

  await expect(page.getByRole("heading", { name: "The DUI Clock" })).toBeVisible();

  const callout = page.getByText("10 PM", { exact: true });
  await expect(callout).toBeVisible();

  await expectNoBrokenNumbers(page);
});
