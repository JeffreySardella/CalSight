import { test, expect, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5174";

// Hermetic phone-width e2e for the crash map (pages/MapPage.tsx,
// components/map/ChoroplethLegend.tsx, components/map/filters/*). Every /api
// call is fulfilled from fixtures, same spirit as map-measure-picker.spec.ts;
// the county outlines come from the real /ca-counties.topo.json.

// reducedMotion turns the fitBounds animation off (lib/a11y/motion), so the
// camera has settled by the time the URL records it.
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, reducedMotion: "reduce" });

const COUNTIES = [
  { county_code: 10, county_name: "Fresno" },
  { county_code: 15, county_name: "Kern" },
  { county_code: 19, county_name: "Los Angeles" },
  { county_code: 34, county_name: "Sacramento" },
];
const COUNTY_STATS = COUNTIES.map((c, i) => ({
  ...c,
  crash_count: 233_000 + i * 100_000,
  total_killed: 3_000,
  total_injured: 100_000,
}));
const YEAR_STATS = [2024, 2025].map((year) => ({ year, crash_count: 5_000_000, total_killed: 40_000, total_injured: 3_000_000 }));
// Distinct statewide vs Fresno figures, so the test can tell which one is shown.
const STATEWIDE_TOTAL = 11_600_000;
const FRESNO_TOTAL = 233_000;
const FRESNO_YEARS = [{ year: 2024, crash_count: 21_000 }, { year: 2025, crash_count: 19_000 }];
const STATEWIDE_YEARS = [{ year: 2024, crash_count: 440_000 }, { year: 2025, crash_count: 402_000 }];

async function mockApi(page: Page) {
  await page.route("**/api/**", (route) => route.fulfill({ status: 404, body: "not mocked" }));
  await page.route("**/api/stats**", (route) => {
    const url = new URL(route.request().url());
    const fresno = url.searchParams.get("county") === "fresno";
    const groupBy = url.searchParams.get("group_by");
    if (groupBy === "county") return route.fulfill({ json: COUNTY_STATS });
    if (groupBy === "year") {
      // The choropleth's year query has no county; the filter sheet's facet
      // query carries the pending selection.
      if (url.searchParams.has("county")) return route.fulfill({ json: fresno ? FRESNO_YEARS : [] });
      return route.fulfill({ json: url.search.includes("start=") ? YEAR_STATS : STATEWIDE_YEARS });
    }
    if (groupBy) return route.fulfill({ json: [] });
    return route.fulfill({ json: { total_crashes: fresno ? FRESNO_TOTAL : STATEWIDE_TOTAL } });
  });
  await page.route("**/api/demographics**", (route) =>
    route.fulfill({ json: COUNTIES.flatMap((c) => [2024, 2025].map((year) => ({ county_code: c.county_code, year, population: 1_000_000 }))) }),
  );
  await page.route("**/api/crashes/heatmap**", (route) =>
    route.fulfill({ json: { points: [{ lat: 36.74, lng: -119.78, weight: 3 }], total_crashes: 107_000, batch: 1, total_batches: 1, grid_step: 0.002 } }),
  );
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("calsight-intro-seen", "1");
    sessionStorage.setItem("calsight-filter-prompt-dismissed", "1");
  });
  await mockApi(page);
});

test("the legend toggle and a popup's close button are 44px touch targets", async ({ page }) => {
  await page.goto(`${BASE_URL}/`);
  const toggle = page.getByTestId("legend-toggle");
  await expect(toggle).toBeVisible();
  const box = await toggle.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);

  // Leaflet builds the close button itself; measure the themed rule against
  // the same markup it produces.
  const close = await page.evaluate(() => {
    const container = document.querySelector(".leaflet-container")!;
    const popup = document.createElement("div");
    popup.className = "leaflet-popup";
    popup.style.position = "absolute";
    popup.innerHTML = '<a class="leaflet-popup-close-button" role="button" href="#close">×</a><div class="leaflet-popup-content-wrapper"></div>';
    container.appendChild(popup);
    const r = popup.querySelector("a")!.getBoundingClientRect();
    popup.remove();
    return { w: r.width, h: r.height };
  });
  expect(close.w).toBeGreaterThanOrEqual(44);
  expect(close.h).toBeGreaterThanOrEqual(44);
});

test("picking a county updates the counts before applying, and applying frames it and rescopes the legend", async ({ page }) => {
  await page.goto(`${BASE_URL}/`);
  const legend = page.getByTestId("choropleth-legend");
  await expect(legend).toBeVisible();

  await page.getByRole("button", { name: "Open filters" }).click();
  const sheet = page.getByRole("dialog");
  const apply = sheet.getByRole("button", { name: /^Show .* Crashes$/ });
  await expect(apply).toHaveText("Show 11.6M Crashes");
  await expect(sheet.getByRole("button", { name: /^2025\s*\(402K\)/ })).toBeVisible();

  await sheet.getByRole("combobox", { name: "Search California Counties..." }).fill("Fres");
  await sheet.getByRole("option", { name: "Fresno" }).click();

  // Before applying: the button and the year chips count Fresno alone.
  await expect(apply).toHaveText("Show 233K Crashes");
  await expect(sheet.getByRole("button", { name: /^2025\s*\(19K\)/ })).toBeVisible();

  await apply.click();
  await expect(sheet).toBeHidden();

  // The camera frames Fresno (the URL mirrors the settled view).
  await expect.poll(() => Number(new URL(page.url()).searchParams.get("zoom")), { timeout: 5_000 })
    .toBeGreaterThanOrEqual(7);
  const u = new URL(page.url());
  expect(Math.abs(Number(u.searchParams.get("lat")) - 36.75)).toBeLessThan(0.5);
  expect(Math.abs(Number(u.searchParams.get("lng")) + 119.65)).toBeLessThan(0.6);

  // The legend counts the county, not the state: plotted crashes out of
  // Fresno's total, and the statewide 11.6M is gone.
  await expect(legend.getByTestId("heatmap-mapped")).toHaveText("107K of 233K crashes mapped (46%)");
  await expect(legend).not.toContainText("11.6M");
});
