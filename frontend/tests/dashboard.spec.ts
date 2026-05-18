import { test, expect } from "@playwright/test";

const BASE_URL = "http://localhost:5174";

test.describe("Dashboard Builder - Preset Switching", () => {
  test("Safety Overview is the default preset with expected chart headings", async ({ page }) => {
    await page.goto(`${BASE_URL}/stats`);

    // Wait for dashboard to load (skeleton disappears)
    await page.waitForSelector(".chart-card-enter", { timeout: 15000 });

    // Safety Overview is the default - verify its preset button is active
    const overviewBtn = page.locator('button[aria-pressed="true"]', { hasText: "Safety Overview" });
    await expect(overviewBtn).toBeVisible();

    // Check for chart headings from the overview preset
    await expect(page.locator("h3", { hasText: "Crashes by Severity" })).toBeVisible();
    await expect(page.locator("h3", { hasText: "Crashes by Cause" })).toBeVisible();
    await expect(page.locator("h3", { hasText: "Crashes by Year" })).toBeVisible();
    await expect(page.locator("h3", { hasText: "Crashes by County" })).toBeVisible();
  });

  test("switching to Time Patterns changes chart count and headings", async ({ page }) => {
    await page.goto(`${BASE_URL}/stats`);
    await page.waitForSelector(".chart-card-enter", { timeout: 15000 });

    // Overview has 4 charts
    const initialCards = page.locator("h3.text-sm.font-headline");
    const overviewCount = await initialCards.count();
    expect(overviewCount).toBe(4);

    // Click Time Patterns preset
    await page.click('button:has-text("Time Patterns")');

    // Time Patterns has 3 charts - count should change
    await expect(page.locator("h3", { hasText: "Crashes by Hour" })).toBeVisible();
    const timeCards = page.locator("h3.text-sm.font-headline");
    const timeCount = await timeCards.count();
    expect(timeCount).toBe(3);
  });

  test("switching to Demographics shows demographic chart headings", async ({ page }) => {
    await page.goto(`${BASE_URL}/stats`);
    await page.waitForSelector(".chart-card-enter", { timeout: 15000 });

    // Click Demographics preset
    await page.click('button:has-text("Demographics")');

    // Verify Demographics preset is active
    const demoBtn = page.locator('button[aria-pressed="true"]', { hasText: "Demographics" });
    await expect(demoBtn).toBeVisible();

    // Check for demographic-specific chart headings
    await expect(page.locator("h3", { hasText: "Crashes by Gender" })).toBeVisible();
    await expect(page.locator("h3", { hasText: "Crashes by Age Bracket" })).toBeVisible();
    await expect(page.locator("h3", { hasText: "Crashes by At-Fault Gender" })).toBeVisible();
    await expect(page.locator("h3", { hasText: "Crashes by At-Fault Age Bracket" })).toBeVisible();
  });
});

test.describe("Dashboard Builder - Builder Mode", () => {
  test("Builder toggle shows Add Chart card and guidance text", async ({ page }) => {
    await page.goto(`${BASE_URL}/stats`);
    await page.waitForSelector(".chart-card-enter", { timeout: 15000 });

    // Click the "Builder" toggle to enter advanced mode
    await page.click('button:has-text("Builder")');

    // Assert Builder is pressed
    const builderBtn = page.locator('button[aria-pressed="true"]', { hasText: "Builder" });
    await expect(builderBtn).toBeVisible();

    // In advanced mode with no custom charts, guidance text should be visible
    await expect(page.locator("text=Build your own dashboard")).toBeVisible();

    // Add Chart card should be visible
    await expect(page.locator("text=Add Chart")).toBeVisible();
  });

  test("adding a chart via the config panel creates a new chart card", async ({ page }) => {
    await page.goto(`${BASE_URL}/stats`);
    await page.waitForSelector(".chart-card-enter", { timeout: 15000 });

    // Switch to Builder mode
    await page.click('button:has-text("Builder")');
    await expect(page.locator("text=Add Chart")).toBeVisible();

    // Click "Add Chart" to open the config panel
    await page.click("text=Add Chart");

    // The config panel should appear with dimension selector
    await expect(page.locator("#cfg-dimension")).toBeVisible();
    await expect(page.locator("#cfg-measure")).toBeVisible();

    // Select dimension: "cause"
    await page.selectOption("#cfg-dimension", "cause");

    // Select measure: "killed"
    await page.selectOption("#cfg-measure", "killed");

    // Select chart type: "Bar"
    await page.click('button[role="radio"]:has-text("Bar")');

    // Click the "Add" button to confirm
    await page.click('button:has-text("Add")');

    // A new chart card with the configured title should appear
    await expect(page.locator("h3", { hasText: "Killed by Cause" })).toBeVisible();
  });
});

test.describe("Dashboard Builder - Chart Interactions", () => {
  test("hovering over a bar chart shows a tooltip", async ({ page }) => {
    await page.goto(`${BASE_URL}/stats`);
    await page.waitForSelector(".chart-card-enter", { timeout: 15000 });

    // Switch to Time Patterns preset which has a bar chart (Crashes by Hour)
    await page.click('button:has-text("Time Patterns")');
    await expect(page.locator("h3", { hasText: "Crashes by Hour" })).toBeVisible();

    // Find a bar rect inside the SVG and hover over it
    const barRect = page.locator("svg rect").first();
    await barRect.hover();

    // Assert tooltip becomes visible
    const tooltip = page.locator('[role="tooltip"]');
    await expect(tooltip).toBeVisible();
  });
});

test.describe("Dashboard Builder - Data Table Toggle", () => {
  test("clicking table toggle shows data table, clicking again returns to chart", async ({ page }) => {
    await page.goto(`${BASE_URL}/stats`);
    await page.waitForSelector(".chart-card-enter", { timeout: 15000 });

    // Find the first chart card's table toggle button (aria-label "View data")
    const tableToggle = page.locator('button[aria-label="View data"]').first();
    await tableToggle.click();

    // Assert a table element appears
    const table = page.locator("table").first();
    await expect(table).toBeVisible();

    // Assert the table has data rows (tbody tr)
    const rows = table.locator("tbody tr");
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);

    // Click toggle again to return to chart (now labeled "Show chart")
    const chartToggle = page.locator('button[aria-label="Show chart"]').first();
    await chartToggle.click();

    // Table should no longer be visible
    await expect(table).not.toBeVisible();
  });
});

test.describe("Dashboard Builder - localStorage Persistence", () => {
  test("selected preset persists after page reload", async ({ page }) => {
    await page.goto(`${BASE_URL}/stats`);
    await page.waitForSelector(".chart-card-enter", { timeout: 15000 });

    // Switch to Demographics preset
    await page.click('button:has-text("Demographics")');
    const demoBtn = page.locator('button[aria-pressed="true"]', { hasText: "Demographics" });
    await expect(demoBtn).toBeVisible();

    // Wait for localStorage debounce (400ms in useDashboardConfig)
    await page.waitForTimeout(600);

    // Reload the page
    await page.reload();
    await page.waitForSelector(".chart-card-enter", { timeout: 15000 });

    // Assert Demographics preset is still active after reload
    const demoBtnAfter = page.locator('button[aria-pressed="true"]', { hasText: "Demographics" });
    await expect(demoBtnAfter).toBeVisible();

    // Verify demographic charts are still shown
    await expect(page.locator("h3", { hasText: "Crashes by Gender" })).toBeVisible();
  });
});

test.describe("Dashboard Builder - Mobile Viewport", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("charts render in single column on mobile", async ({ page }) => {
    await page.goto(`${BASE_URL}/stats`);
    await page.waitForSelector(".chart-card-enter", { timeout: 15000 });

    // Get the grid container
    const grid = page.locator(".grid.grid-cols-1");
    await expect(grid).toBeVisible();

    // All chart cards should be stacked vertically (single column)
    // Verify multiple chart cards exist
    const chartCards = page.locator(".chart-card-enter");
    const count = await chartCards.count();
    expect(count).toBeGreaterThan(1);

    // Verify cards are in a single column by checking their bounding boxes
    // In single column, all cards should have approximately the same x position
    const firstCard = chartCards.nth(0);
    const secondCard = chartCards.nth(1);
    const firstBox = await firstCard.boundingBox();
    const secondBox = await secondCard.boundingBox();

    // Both cards should start at approximately the same x offset (single column)
    expect(firstBox).not.toBeNull();
    expect(secondBox).not.toBeNull();
    if (firstBox && secondBox) {
      expect(Math.abs(firstBox.x - secondBox.x)).toBeLessThan(5);
      // Second card should be below the first (stacked)
      expect(secondBox.y).toBeGreaterThan(firstBox.y);
    }
  });

  test("preset picker is horizontally scrollable on mobile", async ({ page }) => {
    await page.goto(`${BASE_URL}/stats`);
    await page.waitForSelector(".chart-card-enter", { timeout: 15000 });

    // The preset picker container should have overflow-x-auto
    const presetContainer = page.locator(".overflow-x-auto.no-scrollbar");
    await expect(presetContainer).toBeVisible();

    // The container's scrollWidth should exceed its clientWidth (scrollable)
    const isScrollable = await presetContainer.evaluate((el) => {
      return el.scrollWidth > el.clientWidth;
    });
    expect(isScrollable).toBe(true);
  });
});
