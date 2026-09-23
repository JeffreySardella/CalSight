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
    lat: 40.718,
    lon: -122.42,
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
    lat: 38.683,
    lon: -121.183,
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
    // station_count is how many reported on latest_date — a subset of the
    // two Central Sierra marks the map draws, as the live API behaves.
    { region: "Central Sierra", station_count: 1, latest_date: "2026-03-01", swe_in: 24.6, avg_swe_in: 22.0, pct_of_average: 112 },
    { region: "Northern Sierra / Trinity", station_count: 5, latest_date: "2026-03-01", swe_in: 30.1, avg_swe_in: 24.0, pct_of_average: 125 },
    { region: "Southern Sierra", station_count: 5, latest_date: "2026-03-01", swe_in: 18.0, avg_swe_in: 20.0, pct_of_average: 90 },
  ],
  // Per-station rows feed the drought map's snow layer; real staMeta
  // coordinates so they land inside the shipped county topojson.
  stations: [
    {
      station_id: "CSL",
      name: "Central Sierra Snow Lab",
      region: "Central Sierra",
      elevation_ft: 6900,
      lat: 39.325,
      lon: -120.366,
      latest_date: "2026-03-01",
      swe_in: 24.6,
      pct_of_average: 112,
    },
    {
      station_id: "GIN",
      name: "Gin Flat",
      region: "Central Sierra",
      elevation_ft: 7050,
      lat: 37.767,
      lon: -119.773,
      latest_date: "2026-03-01",
      swe_in: 18.0,
      pct_of_average: null,
    },
    // No coordinates — the layer must skip it rather than misplace it.
    {
      station_id: "ZZZ",
      name: "Nowhere Meadow",
      region: "Southern Sierra",
      elevation_ft: 8000,
      lat: null,
      lon: null,
      latest_date: "2026-03-01",
      swe_in: 5.0,
      pct_of_average: 40,
    },
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
  // Basemap tiles are scenery; keep the run off the network. The drawn
  // layers don't depend on them.
  await page.route(/basemaps\.cartocdn\.com|arcgisonline\.com|tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 204 }),
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
    page.getByRole("heading", { name: /California.s Water Year/ }),
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

test("tapping a reservoir circle on the drought map opens its detail panel", async ({ page }) => {
  await page.goto(`${BASE_URL}/water`);

  const shasta = page.getByRole("button", { name: /Shasta Lake, 75% of capacity/ });
  await expect(shasta).toBeVisible();
  await shasta.click();

  const panel = page.getByRole("group", { name: /Shasta Lake detail/i });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("3.41M of 4.55M acre-feet");
  await expect(panel).toContainText("110% of average for this date");

  // "Show in list" jumps to the card up the page and expands it.
  await panel.getByRole("button", { name: /show in list/i }).click();
  const card = page.locator("article", { hasText: "Shasta Lake" });
  await expect(card.getByRole("button", { name: /hide past year/i })).toBeVisible();
});

test("tapping a snow cluster on the drought map opens its region panel", async ({ page }) => {
  await page.goto(`${BASE_URL}/water`);

  // One target per DWR region, not one per station: the marks are texture.
  const region = page.getByRole("button", {
    name: /Central Sierra snowpack, 112% of average, 2 stations/,
  });
  await expect(region).toBeVisible();
  await expect(page.getByRole("button", { name: /snow station/ })).toHaveCount(0);
  // The coordinate-less station is skipped, so its region gets no circle.
  await expect(page.getByRole("button", { name: /Nowhere Meadow/ })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Southern Sierra snowpack/ }),
  ).toHaveCount(0);

  await region.click();
  const panel = page.getByRole("group", { name: /Central Sierra detail/i });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("112");
  await expect(panel).toContainText("1 of 2 stations reporting");
  await expect(panel).toContainText("2026-03-01");

  // "Show in list" highlights the region's row up in the snowpack section.
  await panel.getByRole("button", { name: /show in list/i }).click();
  const row = page.locator("#snowpack-central-sierra");
  await expect(row).toBeVisible();
  await expect(row).toHaveClass(/ring-2/);

  // One selection at a time: opening a reservoir closes the region panel.
  await page.getByRole("button", { name: /Shasta Lake, 75% of capacity/ }).click();
  await expect(panel).toBeHidden();
  await expect(page.getByRole("group", { name: /Shasta Lake detail/i })).toBeVisible();

  // Escape clears whatever is open.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("group", { name: /Shasta Lake detail/i })).toBeHidden();
});

test("the drought map zooms from its buttons and keeps marks the same size", async ({ page }) => {
  await page.goto(`${BASE_URL}/water`);

  // The layers ride one Leaflet overlay: its on-screen width is the zoom.
  const overlay = page.locator("svg.leaflet-image-layer");
  await expect(overlay).toBeVisible();
  const before = (await overlay.boundingBox())!.width;
  const shasta = page.getByTestId("reservoir-dot-SHA");
  const dotBefore = (await shasta.boundingBox())!.width;

  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect
    .poll(async () => (await overlay.boundingBox())!.width / before)
    .toBeCloseTo(2, 1);
  // Zooming spreads the marks apart; it doesn't blow them up.
  expect((await shasta.boundingBox())!.width).toBeCloseTo(dotBefore, 0);

  // The mouse wheel scrolls the page past the map instead of zooming it.
  const zoomed = (await overlay.boundingBox())!.width;
  const box = (await page.locator(".leaflet-container").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 200);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  expect((await overlay.boundingBox())!.width).toBeCloseTo(zoomed, 0);

  await page.getByRole("button", { name: /show all of california/i }).click();
  await expect
    .poll(async () => (await overlay.boundingBox())!.width)
    .toBeCloseTo(before, 0);
});

test.describe("on a touch phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("the drought map pinch-zooms, and one finger scrolls the page", async ({ page, context }) => {
    await page.goto(`${BASE_URL}/water`);
    const map = page.locator(".leaflet-container");
    const overlay = page.locator("svg.leaflet-image-layer");
    await expect(overlay).toBeVisible();
    await map.scrollIntoViewIfNeeded();

    // Roughly 60–70% of the phone's height, and no sideways scroll.
    const box = (await map.boundingBox())!;
    expect(box.height / 812).toBeGreaterThan(0.6);
    expect(box.height / 812).toBeLessThan(0.7);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);

    // Playwright has no pinch gesture; drive the touch points over CDP.
    const cdp = await context.newCDPSession(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const touches = (d: number) => [
      { x: cx - d, y: cy, id: 0 },
      { x: cx + d, y: cy, id: 1 },
    ];
    const before = (await overlay.boundingBox())!.width;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touches(30) });
    for (let d = 40; d <= 110; d += 10) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: touches(d) });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect
      .poll(async () => (await overlay.boundingBox())!.width / before)
      .toBeGreaterThan(2);

    // A tap still selects after zooming.
    await page.getByRole("button", { name: /Central Sierra snowpack/ }).tap();
    await expect(page.getByRole("group", { name: /Central Sierra detail/i })).toBeVisible();

    // One finger on the map scrolls the page; the map itself stays put.
    const scrollY = await page.evaluate(() => window.scrollY);
    const zoomed = (await overlay.boundingBox())!;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx, y: cy, id: 0 }] });
    for (let dy = 15; dy <= 150; dy += 15) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx, y: cy - dy, id: 0 }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrollY);
    const after = (await overlay.boundingBox())!;
    // Moved up exactly as far as the page scrolled: panned with the page,
    // not within the map.
    expect(after.width).toBeCloseTo(zoomed.width, 0);
    expect(zoomed.y - after.y).toBeCloseTo(
      (await page.evaluate(() => window.scrollY)) - scrollY,
      0,
    );
  });
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

test("water page is public: direct link works and the nav advertises it", async ({ page }) => {
  await page.goto(`${BASE_URL}/water`);
  await expect(
    page.getByRole("heading", { name: /California.s Water Year/ }),
  ).toBeVisible();
  // Since WATER_PAGE_PUBLIC flipped (2026-09-12) the main nav links to it
  // from every page.
  await page.goto(`${BASE_URL}/about`);
  const water = page.getByRole("link", { name: "Water", exact: true }).first();
  await expect(water).toBeVisible();
  await expect(water).toHaveAttribute("href", "/water");
});
