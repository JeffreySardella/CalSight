import { test, expect, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5174";

// Hermetic e2e for the /water page: every /api call is fulfilled from
// fixtures via route interception, so no backend or database is needed —
// same spirit as a11y-focus-trap.spec.ts.

const RESERVOIRS = [
  {
    station_id: "SHA",
    name: "Shasta Lake",
    capacity_af: 4_552_000,
    county_code: 45,
    latest_date: "2026-07-09",
    storage_af: 3_414_000,
    pct_of_capacity: 75.0,
    avg_storage_af: 3_100_000,
    pct_of_average: 110.1,
  },
  {
    station_id: "FOL",
    name: "Folsom Lake",
    capacity_af: 977_000,
    county_code: 34,
    latest_date: "2026-07-09",
    storage_af: 488_500,
    pct_of_capacity: 50.0,
    avg_storage_af: null,
    pct_of_average: null,
  },
];

const SERIES = {
  station_id: "SHA",
  name: "Shasta Lake",
  capacity_af: 4_552_000,
  points: Array.from({ length: 30 }, (_, i) => ({
    date: `2026-06-${String(i + 1).padStart(2, "0")}`,
    storage_af: 3_300_000 + i * 4_000,
  })),
};

const DROUGHT = {
  week_start: "2026-06-30",
  statewide: { none_pct: 40, d0_pct: 20, d1_pct: 25, d2_pct: 10, d3_pct: 5, d4_pct: 0 },
  counties: [
    { county_code: 15, none_pct: 0, d0_pct: 5, d1_pct: 15, d2_pct: 50, d3_pct: 30, d4_pct: 0 },
    { county_code: 34, none_pct: 60, d0_pct: 20, d1_pct: 20, d2_pct: 0, d3_pct: 0, d4_pct: 0 },
  ],
};

const SNOWPACK = {
  latest_date: "2026-03-01",
  statewide_pct_of_average: 112,
  regions: [
    { region: "Central Sierra", station_count: 5, latest_date: "2026-03-01", swe_in: 24.6, avg_swe_in: 22.0, pct_of_average: 112 },
    { region: "Northern Sierra / Trinity", station_count: 5, latest_date: "2026-03-01", swe_in: 30.1, avg_swe_in: 24.0, pct_of_average: 125 },
    { region: "Southern Sierra", station_count: 5, latest_date: "2026-03-01", swe_in: 18.0, avg_swe_in: 20.0, pct_of_average: 90 },
  ],
};

const DROUGHT_SERIES = Array.from({ length: 10 }, (_, i) => ({
  week_start: `2026-0${Math.floor(i / 4) + 4}-0${(i % 4) + 1}`,
  none_pct: 60 - i * 2,
  d0_pct: 10,
  d1_pct: 20 + i * 2,
  d2_pct: 10,
  d3_pct: 0,
  d4_pct: 0,
}));

async function mockWaterApi(page: Page) {
  // Catch-all first — Playwright matches the most recently registered
  // route first, so the specific fixtures below take precedence.
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 404, body: "not mocked" }),
  );
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { status: "ok" } }),
  );
  await page.route("**/api/counties**", (route) =>
    route.fulfill({
      json: [
        { code: 15, name: "Kern" },
        { code: 34, name: "Sacramento" },
        { code: 45, name: "Shasta" },
      ],
    }),
  );
  await page.route("**/api/water/reservoirs", (route) =>
    route.fulfill({ json: RESERVOIRS }),
  );
  await page.route("**/api/water/reservoirs/SHA/series**", (route) =>
    route.fulfill({ json: SERIES }),
  );
  await page.route("**/api/water/drought", (route) =>
    route.fulfill({ json: DROUGHT }),
  );
  await page.route("**/api/water/drought/series**", (route) =>
    route.fulfill({ json: DROUGHT_SERIES }),
  );
  await page.route("**/api/water/snowpack", (route) =>
    route.fulfill({ json: SNOWPACK }),
  );
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("calsight-intro-seen", "1");
    localStorage.setItem("calsight-insight-seen", "1");
  });
  await mockWaterApi(page);
});

test("water page renders reservoir conditions and statewide summary", async ({ page }) => {
  await page.goto(`${BASE_URL}/water`);

  await expect(
    page.getByRole("heading", { name: /California.s Reservoirs/ }),
  ).toBeVisible();

  // Statewide summary derived from the fixtures: 3.9M AF of 5.53M (71%).
  const summary = page.getByRole("region", { name: /statewide summary/i });
  await expect(summary).toContainText("3.90M");
  await expect(summary).toContainText("71%");

  // Cards render with their gauge semantics.
  await expect(page.getByText("Shasta Lake")).toBeVisible();
  const gauge = page.getByRole("progressbar", { name: /Shasta Lake/ });
  await expect(gauge).toHaveAttribute("aria-valuenow", "75");

  // Folsom has no history — no "% of avg" figure on that card.
  const folsom = page.locator("article", { hasText: "Folsom Lake" });
  await expect(folsom).not.toContainText("of avg for today");
});

test("expanding a reservoir card fetches and draws the year sparkline", async ({ page }) => {
  await page.goto(`${BASE_URL}/water`);

  const shasta = page.locator("article", { hasText: "Shasta Lake" });
  const seriesRequest = page.waitForRequest("**/api/water/reservoirs/SHA/series**");
  await shasta.getByRole("button", { name: /show past year/i }).click();
  await seriesRequest;

  await expect(
    shasta.getByLabel(/storage over the past year/i),
  ).toBeVisible();
});

test("drought section shows weighted headline, choropleth, and hardest-hit counties", async ({ page }) => {
  await page.goto(`${BASE_URL}/water`);

  await expect(
    page.getByRole("heading", { name: /40% of California is in drought/ }),
  ).toBeVisible();

  // Choropleth builds from the real shipped topojson: all 58 county paths.
  const map = page.getByRole("img", { name: /map of california counties/i });
  await expect(map).toBeVisible();
  expect(await map.locator("path").count()).toBe(58);

  // Kern (95% D1+) leads the hardest-hit list; Sacramento (20%) follows.
  const list = page.locator("ul", { hasText: "Kern" }).last();
  await expect(list).toContainText("Kern");
  await expect(page.getByText("95%", { exact: true })).toBeVisible();
});

test("snowpack section shows statewide headline and per-region bars", async ({ page }) => {
  await page.goto(`${BASE_URL}/water`);

  await expect(
    page.getByRole("heading", { name: /Statewide snowpack is 112% of average/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("progressbar", { name: /Central Sierra: 112% of average/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("progressbar", { name: /Northern Sierra .* 125% of average/ }),
  ).toBeVisible();
});

test("hardest-hit county rows deep-link back to the county on the map", async ({ page }) => {
  await page.goto(`${BASE_URL}/water`);

  // Kern (code 15 in the fixtures) resolves via the shipped topojson and
  // links with the same ?county= param the Stats page's map link uses.
  const kern = page.getByRole("link", { name: "Kern", exact: true });
  await expect(kern).toHaveAttribute("href", "/?county=kern");

  // Clicking is a client-side navigation to the map with the county staged.
  await kern.click();
  await expect(page).toHaveURL(/\/\?county=kern/);
});

test("water page is soft-launched: direct link works, nav does not advertise it", async ({ page }) => {
  // While WATER_PAGE_PUBLIC is false the page must stay reachable by URL…
  await page.goto(`${BASE_URL}/water`);
  await expect(
    page.getByRole("heading", { name: /California.s Reservoirs/ }),
  ).toBeVisible();
  // …but no navigation surface may link to it.
  await page.goto(`${BASE_URL}/about`);
  await expect(
    page.getByRole("link", { name: "Water", exact: true }),
  ).toHaveCount(0);
});
