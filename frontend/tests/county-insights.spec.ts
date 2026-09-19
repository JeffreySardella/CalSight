import { test, expect, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5174";

// Hermetic e2e for the county-page insight banner (components/stats/
// InsightBanner.tsx), which rotates a YoY stat slide with fun-fact slides
// (hooks/useFunFacts.ts, backed by /api/fun-facts). Guards the causal-language
// gate work (fix/fun-fact-gate, fix/narrative-causal-gate): rendered cards
// must read as plain findings, never "because X caused Y". Every /api call is
// fulfilled from fixtures via route interception, same spirit as water.spec.ts.

const CURRENT_YEAR = new Date().getFullYear();

const FUN_FACTS = [
  {
    narrative: "Los Angeles County logged 3,204 pedestrian-involved crashes in 2023, more than any other county that year.",
    year: 2023,
    angle: "pedestrian",
    county_name: "Los Angeles",
  },
  {
    narrative: "Rainy days make up just 4% of days in Los Angeles County but 11% of its fatal crashes.",
    year: 2022,
    angle: "weather",
    county_name: "Los Angeles",
  },
];

const BATCH_RESPONSE = {
  year: [
    { year: CURRENT_YEAR - 2, crash_count: 100_000, total_killed: 900, total_injured: 120_000 },
    { year: CURRENT_YEAR - 1, crash_count: 95_000, total_killed: 800, total_injured: 110_000 },
    { year: CURRENT_YEAR, crash_count: 5_000, total_killed: 50, total_injured: 6_000 },
  ],
};

async function mockCountyApi(page: Page) {
  await page.route("**/api/**", (route) => route.fulfill({ status: 404, body: "not mocked" }));
  await page.route("**/api/stats/batch", (route) => route.fulfill({ json: BATCH_RESPONSE }));
  await page.route("**/api/demographics**", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/fun-facts**", (route) => route.fulfill({ json: FUN_FACTS }));
}

test.beforeEach(async ({ page }) => {
  await mockCountyApi(page);
});

test("fun-fact and YoY insight cards on a county page show text with no causal language", async ({ page }) => {
  await page.goto(`${BASE_URL}/stats?county=los-angeles`);
  await page.waitForSelector(".chart-card-enter", { timeout: 15000 });

  // ".insight-text" is unique to InsightBanner — the page has other
  // role="status" regions too (a global sr-only "Statistics loaded"
  // announcer, per-chart sr-only live regions).
  const insightText = page.locator(".insight-text");
  await expect(insightText).toBeVisible();

  // Slide 0: the YoY stat slide (pushed first when present) — plain
  // template text with digits, never a causal claim.
  await expect(insightText).toHaveText(/YoY/);
  await expect(insightText).toHaveText(/\d/);
  await expect(insightText).not.toHaveText(/\bbecause\b/i);
  await expect(insightText).not.toHaveText(/caused by/i);

  // Cycle through the two fun-fact slides and check each one.
  const nextButton = page.getByRole("button", { name: "Next insight" });
  const seen = new Set<string>();
  for (const fact of FUN_FACTS) {
    await nextButton.click();
    await expect(page.getByText("Did You Know?")).toBeVisible();
    const text = (await insightText.textContent())?.trim() ?? "";
    expect(text).toBe(fact.narrative);
    expect(text).toMatch(/\d/);
    expect(text.toLowerCase()).not.toMatch(/\bbecause\b/);
    expect(text.toLowerCase()).not.toMatch(/caused by/);
    seen.add(text);
  }
  expect(seen.size).toBe(FUN_FACTS.length);

  // A third click wraps back to the YoY slide.
  await nextButton.click();
  await expect(insightText).toHaveText(/YoY/);
});
