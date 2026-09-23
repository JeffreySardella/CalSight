import { test, expect, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5174";

// Hermetic phone-width e2e for pages/AskAiPage.tsx + components/Layout.tsx's
// bottom-nav clearance. Never sends a question (that hits the paid AI API) —
// this only checks that the input bar and its send button clear the fixed
// BottomTabBar, which is the layout bug this spec guards against.
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

async function mockApi(page: Page) {
  // AskAiPage renders fully client-side until a question is sent; this just
  // keeps the test hermetic if something unexpected calls out.
  await page.route("**/api/**", (route) => route.fulfill({ status: 404, body: "not mocked" }));
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("calsight-intro-seen", "1");
    sessionStorage.setItem("calsight-filter-prompt-dismissed", "1");
  });
  await mockApi(page);
});

test("the question input bar clears the bottom nav and the send button is a full 44px touch target", async ({ page }) => {
  await page.goto(`${BASE_URL}/ask`);

  const input = page.getByPlaceholder("Ask about crash data...");
  await expect(input).toBeVisible();
  const sendButton = page.getByRole("button", { name: "Send question" });
  const nav = page.getByRole("navigation", { name: "Mobile navigation" });
  await expect(nav).toBeVisible();

  const inputBox = await input.boundingBox();
  const sendBox = await sendButton.boundingBox();
  const navBox = await nav.boundingBox();
  expect(inputBox && sendBox && navBox).toBeTruthy();

  // The input bar (and its send button) must sit entirely above the fixed
  // bottom nav — no overlap between the two fixed-position stacks.
  expect(inputBox!.y + inputBox!.height).toBeLessThanOrEqual(navBox!.y + 1);
  expect(sendBox!.y + sendBox!.height).toBeLessThanOrEqual(navBox!.y + 1);

  // The send button must be a full 44x44 touch target, fully inside the viewport.
  expect(sendBox!.width).toBeGreaterThanOrEqual(44);
  expect(sendBox!.height).toBeGreaterThanOrEqual(44);
  const viewport = page.viewportSize()!;
  expect(sendBox!.x).toBeGreaterThanOrEqual(0);
  expect(sendBox!.x + sendBox!.width).toBeLessThanOrEqual(viewport.width);
  expect(sendBox!.y).toBeGreaterThanOrEqual(0);
  expect(sendBox!.y + sendBox!.height).toBeLessThanOrEqual(viewport.height);
});
