import { test, expect } from "@playwright/test";

const BASE_URL = "http://localhost:5174";

test.describe("Dashboard - Hero Metrics", () => {
  test("page loads with hero metrics visible", async ({ page }) => {
    await page.goto(`${BASE_URL}/stats`);
    await page.waitForSelector(".chart-card-enter", { timeout: 15000 });

    // Verify all three hero metric cards are visible
    await expect(page.locator("text=Total Incidents")).toBeVisible();
    await expect(page.getByRole("group", { name: "Killed or seriously injured per 100K population" })).toBeVisible();
    await expect(page.getByRole("group", { name: "People killed" })).toBeVisible();

    // Verify hero metric elements render (values depend on API data availability)
    const metricValues = page.locator("p.hero-value");
    await expect(metricValues.first()).toBeVisible({ timeout: 15000 });
    const count = await metricValues.count();
    expect(count).toBe(3);
  });
});

test.describe("Dashboard - Preset Switching", () => {
  const presets = [
    { label: "Safety Overview", expectedChart: "Crashes by Severity" },
    { label: "Time Patterns", expectedChart: "Crashes by Hour" },
    { label: "Demographics", expectedChart: "People by Victim Gender" },
    { label: "Fatality Focus", expectedChart: "Fatalities by Primary Cause" },
    { label: "DUI Deep Dive", expectedChart: "Crashes by Hour" },
    { label: "Injury Analysis", expectedChart: "Injuries by Month" },
    { label: "Equity & Safety", expectedChart: "Deaths per 1,000 Crashes by County" },
    { label: "County Comparison", expectedChart: "Crashes by County" },
  ];

  for (const { label, expectedChart } of presets) {
    test(`switching to "${label}" shows expected charts`, async ({ page }) => {
      await page.goto(`${BASE_URL}/stats`);
      await page.waitForSelector(".chart-card-enter", { timeout: 15000 });

      // Click the preset button
      await page.click(`button:has-text("${label}")`);

      // Verify preset button becomes active
      const activeBtn = page.locator('button[aria-pressed="true"]', { hasText: label });
      await expect(activeBtn).toBeVisible();

      // Verify at least one expected chart heading appears
      await expect(page.locator("h3", { hasText: expectedChart })).toBeVisible({ timeout: 10000 });

      // Verify chart cards rendered
      const chartCards = page.locator("h3.text-sm.font-headline");
      const chartCount = await chartCards.count();
      expect(chartCount).toBeGreaterThanOrEqual(3);
    });
  }
});

test.describe("Dashboard - NLQ Query Bar", () => {
  test("typing 'crashes by hour' adds a chart", async ({ page }) => {
    await page.goto(`${BASE_URL}/stats`);
    await page.waitForSelector(".chart-card-enter", { timeout: 15000 });

    // Focus the NLQ input
    const nlqInput = page.locator('[aria-label="Natural language chart query"]');
    await nlqInput.click();
    await nlqInput.fill("crashes by hour");

    // Wait for parsing feedback to show the resolved query
    await page.waitForTimeout(300);

    // Press Enter to submit
    await nlqInput.press("Enter");

    // Should switch to builder mode and show the new chart
    // The chart "Crashes by Hour" should now be visible
    await expect(page.locator("h3", { hasText: "Crashes by Hour" })).toBeVisible({ timeout: 10000 });
    // ...and says so, rather than switching tabs silently.
    await expect(page.getByText(/Switched to the Builder tab/)).toBeVisible();
  });
});

test.describe("Dashboard - Builder Mode", () => {
  test("switch to Builder and add a chart via config panel", async ({ page }) => {
    await page.goto(`${BASE_URL}/stats`);
    await page.waitForSelector(".chart-card-enter", { timeout: 15000 });

    // Switch to Builder mode
    await page.click('button:has-text("Builder")');

    // Verify builder mode is active (radio group uses aria-checked)
    const builderBtn = page.locator('button[aria-checked="true"]', { hasText: "Builder" });
    await expect(builderBtn).toBeVisible();

    // Should show guidance text and Add Chart card
    await expect(page.locator("text=Build your own dashboard")).toBeVisible();
    await expect(page.locator("text=Add Chart")).toBeVisible();

    // Click Add Chart to open config panel
    await page.click("text=Add Chart");

    // Config panel should appear with dimension and measure selectors
    await expect(page.locator("#cfg-dimension")).toBeVisible();
    await expect(page.locator("#cfg-measure")).toBeVisible();

    // Select dimension: "severity"
    await page.selectOption("#cfg-dimension", "severity");

    // Select measure: "count"
    await page.selectOption("#cfg-measure", "count");

    // Select chart type: "Bar"
    await page.click('button[role="radio"]:has-text("Bar")');

    // Click Add button to create the chart
    await page.click('button:has-text("Add")');

    // Verify the new chart card appears
    await expect(page.locator("h3", { hasText: "Crashes by Severity" })).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Dashboard - Chart Rendering", () => {
  test("charts render SVG elements after data loads", async ({ page }) => {
    test.skip(!process.env.VITE_API_TARGET, "needs chart data from the API (cards show 'No data' without a backend)");
    await page.goto(`${BASE_URL}/stats`);
    await page.waitForSelector(".chart-card-enter", { timeout: 15000 });

    // Wait for multiple chart SVGs to render (skeletons load first)
    await page.waitForFunction(
      () => document.querySelectorAll(".chart-card-enter svg").length >= 2,
      { timeout: 15000 }
    );
    const svgElements = page.locator(".chart-card-enter svg");
    const svgCount = await svgElements.count();
    expect(svgCount).toBeGreaterThanOrEqual(2);

    // Verify SVGs contain rendered paths or rects (actual chart data)
    const firstSvg = svgElements.first();
    const hasShapes = await firstSvg.evaluate((svg) => {
      const paths = svg.querySelectorAll("path");
      const rects = svg.querySelectorAll("rect");
      const circles = svg.querySelectorAll("circle");
      return paths.length > 0 || rects.length > 0 || circles.length > 0;
    });
    expect(hasShapes).toBe(true);
  });
});

test.describe("Dashboard - Anomaly Panel", () => {
  test("anomaly panel appears with anomaly cards when data is loaded", async ({ page }) => {
    await page.goto(`${BASE_URL}/stats`);
    await page.waitForSelector(".chart-card-enter", { timeout: 15000 });

    // The anomaly panel heading should be visible (it appears after charts load)
    const anomalyHeading = page.locator("h3", { hasText: "Anomaly Detection" });

    // Anomaly detection may or may not produce anomalies depending on data,
    // but the panel should appear if anomalies exist
    const panelVisible = await anomalyHeading.isVisible().catch(() => false);

    if (panelVisible) {
      // Verify the panel contains anomaly cards with severity indicators
      const anomalyCards = page.locator("section").filter({ hasText: "Anomaly Detection" }).locator(".rounded-lg.border");
      const cardCount = await anomalyCards.count();
      expect(cardCount).toBeGreaterThan(0);

      // Each anomaly card should have a method label
      const methodLabels = page.locator("section").filter({ hasText: "Anomaly Detection" }).locator("text=/Statistical Outlier|Distribution Outlier|Structural Shift/");
      const methodCount = await methodLabels.count();
      expect(methodCount).toBeGreaterThan(0);
    } else {
      // If no anomalies detected, the panel won't render (by design).
      // Verify the page still loaded correctly by checking charts exist.
      const chartCards = page.locator(".chart-card-enter");
      const count = await chartCards.count();
      expect(count).toBeGreaterThan(0);
    }
  });
});

test.describe("Dashboard - Filter Interaction", () => {
  test("open filters, select a county, verify charts update", async ({ page }) => {
    await page.goto(`${BASE_URL}/stats`);
    await page.waitForSelector(".chart-card-enter", { timeout: 15000 });

    // Click "Edit Filters" to open the filter panel
    await page.click("text=Edit Filters");

    // Wait for filter sheet to appear (placeholder is an attribute, not visible text)
    const countySearch = page.locator('input[placeholder="Search California Counties..."]');
    await expect(countySearch).toBeVisible({ timeout: 10000 });
    await countySearch.fill("Los Angeles");

    // Click the Los Angeles option inside the filter panel (backdrop intercepts page-level clicks)
    const filterPanel = page.locator('[role="dialog"], .fixed.inset-0').last();
    await filterPanel.locator('text="Los Angeles"').click();

    // Close the filter panel
    await filterPanel.locator('button:has-text("Done")').click().catch(async () => {
      await page.keyboard.press("Escape");
    });

    // Verify the filter chip shows Los Angeles (use the visible chip, not the print-only one)
    await expect(page.locator(".rounded-full", { hasText: "Los Angeles" }).first()).toBeVisible({ timeout: 5000 });

    // Verify charts still render (data updated)
    await page.waitForSelector(".chart-card-enter", { timeout: 15000 });
    const chartCards = page.locator(".chart-card-enter");
    const count = await chartCards.count();
    expect(count).toBeGreaterThan(0);
  });
});

test.describe("Dashboard - Mobile Viewport", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("single-column layout with no horizontal overflow", async ({ page }) => {
    await page.goto(`${BASE_URL}/stats`);
    await page.waitForSelector(".chart-card-enter", { timeout: 15000 });

    // Verify the page body does not have horizontal overflow
    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasHorizontalOverflow).toBe(false);

    // Verify chart cards are stacked vertically (single column)
    const chartCards = page.locator(".chart-card-enter");
    const count = await chartCards.count();
    expect(count).toBeGreaterThan(1);

    // Check first two cards share the same x position (single column)
    const firstBox = await chartCards.nth(0).boundingBox();
    const secondBox = await chartCards.nth(1).boundingBox();
    expect(firstBox).not.toBeNull();
    expect(secondBox).not.toBeNull();

    if (firstBox && secondBox) {
      // Same x offset means single column
      expect(Math.abs(firstBox.x - secondBox.x)).toBeLessThan(5);
      // Second card is below the first
      expect(secondBox.y).toBeGreaterThan(firstBox.y);
    }

    // Verify the page itself doesn't produce a horizontal scrollbar
    // (individual elements may extend by a few px due to shadows/borders
    // without triggering actual overflow on the body)
    const bodyOverflows = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(bodyOverflows).toBe(false);
  });
});

test.describe("Dashboard - Keyboard Shortcuts", () => {
  test("pressing '2' switches to Time Patterns preset", async ({ page }) => {
    await page.goto(`${BASE_URL}/stats`);
    await page.waitForSelector(".chart-card-enter", { timeout: 15000 });

    // Verify we start on Safety Overview (default)
    const overviewBtn = page.locator('button[aria-pressed="true"]', { hasText: "Safety Overview" });
    await expect(overviewBtn).toBeVisible();

    // Press '2' to switch to Time Patterns (second preset)
    await page.keyboard.press("2");

    // Verify Time Patterns is now active
    const timeBtn = page.locator('button[aria-pressed="true"]', { hasText: "Time Patterns" });
    await expect(timeBtn).toBeVisible({ timeout: 5000 });

    // Verify Time Patterns charts are shown
    await expect(page.locator("h3", { hasText: "Crashes by Hour" })).toBeVisible();
  });
});

test.describe("Dashboard - Data Table Toggle", () => {
  test("clicking table icon on a chart shows data table", async ({ page }) => {
    test.skip(!process.env.VITE_API_TARGET, "needs chart data from the API (the table only renders when a card has data)");
    await page.goto(`${BASE_URL}/stats`);
    await page.waitForSelector(".chart-card-enter", { timeout: 15000 });

    // Scope to one chart card (pinned by index, since its toggle's label
    // flips): the Stats page also renders page-level tables (highway rankings,
    // county YoY), so page.locator("table").first() re-resolves to one of
    // those once the card's table is gone.
    const card = page.locator(".chart-card-enter").first();
    const tableToggle = card.getByRole("button", { name: "View data" }).first();
    await expect(tableToggle).toBeVisible();
    await tableToggle.click();

    // Verify a data table appears (the card may still be loading when the
    // toggle is clicked; the table replaces the skeleton once data lands).
    const table = card.getByRole("table");
    await expect(table).toBeVisible({ timeout: 15000 });

    // Verify the table has header row and data rows
    const headerCells = table.locator("thead th");
    const headerCount = await headerCells.count();
    expect(headerCount).toBeGreaterThan(0);

    const dataRows = table.locator("tbody tr");
    const rowCount = await dataRows.count();
    expect(rowCount).toBeGreaterThan(0);

    // Click the toggle again to return to chart view
    await card.getByRole("button", { name: "Show chart" }).first().click();

    // Table should no longer be visible
    await expect(table).not.toBeVisible();
  });
});

test.describe("Dashboard - Preliminary deaths", () => {
  // Last year's deaths are still being recorded all through this year
  // (lib/dashboard/provisionalDeaths.ts): the headline must lead with the
  // settled year and label last year preliminary, never call it "improved".
  const CY = new Date().getFullYear();
  const YEARS = [
    { year: CY - 3, crash_count: 377_431, total_killed: 4011, total_injured: 213_131, total_severe_injured: 16_132 },
    { year: CY - 2, crash_count: 415_406, total_killed: 4000, total_injured: 236_176, total_severe_injured: 17_182 },
    { year: CY - 1, crash_count: 401_710, total_killed: 3407, total_injured: 231_540, total_severe_injured: 17_037 },
  ];

  test("labels the lagging year preliminary on the KPI and the deaths chart", async ({ page }) => {
    await page.route("**/api/stats/batch", (route) => route.fulfill({ json: { year: YEARS } }));
    await page.goto(`${BASE_URL}/stats`);

    const tile = page.getByRole("group", { name: "People killed" });
    await expect(tile).toContainText(`People killed, ${CY - 2}`);
    await expect(tile).toContainText("4,000");
    await expect(tile).toContainText(`Change: ${CY - 2} vs ${CY - 3}`);
    await expect(tile.getByTestId("killed-preliminary")).toContainText(`${CY - 1} (preliminary): 3,407`);

    await page.click('button:has-text("Fatality Focus")');
    await expect(page.getByText(`Deaths for ${CY - 1} are preliminary`, { exact: false }).first()).toBeVisible({ timeout: 10000 });
  });
});
