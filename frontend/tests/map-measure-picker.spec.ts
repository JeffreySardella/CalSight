import { test, expect, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5174";

// Hermetic e2e for the choropleth measure picker (components/map/
// ChoroplethLegend.tsx + lib/choropleth/measures.ts). Every /api call is
// fulfilled from fixtures via route interception, same spirit as
// water.spec.ts, so the per-driver and per-road-mile denominators (only
// fetched once their measure is selected — see useChoroplethData's `enabled`
// flags) always have data to color with.

const COUNTIES = [
  { county_code: 15, county_name: "Kern" },
  { county_code: 34, county_name: "Sacramento" },
  { county_code: 45, county_name: "Shasta" },
  { county_code: 19, county_name: "Los Angeles" },
];
const YEARS = [2023, 2024];

const COUNTY_STATS = COUNTIES.map((c, i) => ({
  ...c,
  crash_count: 5_000 + i * 1_000,
  total_killed: 40 + i * 5,
  total_injured: 4_000 + i * 500,
}));
const YEAR_STATS = YEARS.map((year) => ({ year, crash_count: 10_000, total_killed: 100, total_injured: 9_000 }));
const DEMOGRAPHICS = COUNTIES.flatMap((c) =>
  YEARS.map((year) => ({ county_code: c.county_code, year, population: 500_000 })),
);
const LICENSED_DRIVERS = COUNTIES.flatMap((c) =>
  YEARS.map((year) => ({ county_code: c.county_code, year, driver_count: 300_000 })),
);
const ROAD_MILES = COUNTIES.map((c) => ({ county_code: c.county_code, total_miles: 2_000 }));

async function mockChoroplethApi(page: Page) {
  await page.route("**/api/**", (route) => route.fulfill({ status: 404, body: "not mocked" }));
  await page.route("**/api/stats**", (route) => {
    const url = route.request().url();
    if (url.includes("group_by=county")) return route.fulfill({ json: COUNTY_STATS });
    if (url.includes("group_by=year")) return route.fulfill({ json: YEAR_STATS });
    // Plain /api/stats — the intro overlay's live crash total.
    return route.fulfill({ json: { total_crashes: 11_500_000 } });
  });
  await page.route("**/api/demographics**", (route) => route.fulfill({ json: DEMOGRAPHICS }));
  await page.route("**/api/licensed-drivers**", (route) => route.fulfill({ json: LICENSED_DRIVERS }));
  await page.route("**/api/road-miles**", (route) => route.fulfill({ json: ROAD_MILES }));
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("calsight-intro-seen", "1"));
  await mockChoroplethApi(page);
});

test("switching to per-licensed-driver and per-road-mile measures updates the legend, and the choice round-trips", async ({ page }) => {
  await page.goto(`${BASE_URL}/`);

  const legend = page.locator('[data-testid="choropleth-legend"]');
  await expect(legend).toBeVisible();
  const trigger = page.locator('button[aria-haspopup="listbox"]');
  // The trigger button also carries an "expand_more" icon span, so the label
  // is read from its own span rather than the button's full text content.
  const triggerLabel = trigger.locator("span").first();

  async function selectMeasure(label: string) {
    await trigger.click();
    await page.getByRole("option", { name: label }).click();
  }

  // Bucket edges recompute async (CountyBoundaries' effect), so read the
  // legend only once it's past the "Loading data…" placeholder.
  async function stableLegendText(): Promise<string> {
    await expect(legend).not.toContainText("Loading data…");
    return legend.innerText();
  }

  await expect(triggerLabel).toHaveText("Crashes per 100k residents");
  const initialLegendText = await stableLegendText();

  await selectMeasure("Crashes per 10k licensed drivers");
  await expect(triggerLabel).toHaveText("Crashes per 10k licensed drivers");
  const driverLegendText = await stableLegendText();
  expect(driverLegendText).not.toBe(initialLegendText);

  await selectMeasure("Crashes per 100 road miles");
  await expect(triggerLabel).toHaveText("Crashes per 100 road miles");
  const roadMileLegendText = await stableLegendText();
  expect(roadMileLegendText).not.toBe(driverLegendText);

  // Round-trip: switching back to the original measure reproduces the
  // original legend exactly (deterministic — same fixture data throughout).
  await selectMeasure("Crashes per 100k residents");
  await expect(triggerLabel).toHaveText("Crashes per 100k residents");
  await expect.poll(() => stableLegendText()).toBe(initialLegendText);
});
