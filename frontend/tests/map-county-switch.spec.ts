import { test, expect, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5174";

// Hermetic phone-width e2e for switching the county on the crash map
// (pages/MapPage.tsx, hooks/useFocusFollowsSelection.ts). Motion stays ON:
// the bug needs the animated fitBounds. Leaflet ignores a setView made while a
// zoom animation runs, so a camera that was sent new county -> old county ->
// new county settled on the old one, with the new county's heat off to the
// side ("fixed one problem with map, brought back another: it flashes and
// moves around").
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

// Heat fixtures sit where the two counties do not overlap, so a canvas that
// shows the wrong one cannot pass: north of Lodi (San Joaquin only) and
// around Turlock (Stanislaus only).
const SJ_HEAT = { lat: 38.2, lng: -121.3 };
const STAN_HEAT = { lat: 37.49, lng: -120.85 };
// Stanislaus' bounding box centre, where fitBounds puts the camera.
const STAN_CENTER = { lat: 37.61, lng: -120.94 };
// Modesto, inside Stanislaus: the point the test taps.
const MODESTO = { lat: 37.64, lng: -120.99 };

function cluster(c: { lat: number; lng: number }) {
  const points = [];
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) points.push({ lat: c.lat + i * 0.01, lng: c.lng + j * 0.01, weight: 5 });
  return points;
}

async function mockApi(page: Page) {
  await page.route("**/api/**", (route) => route.fulfill({ status: 404, body: "not mocked" }));
  // The walk takes a while; an unmocked health check swaps the page for the
  // "Can't reach CalSight" screen part-way through.
  await page.route("**/api/health", (route) => route.fulfill({ json: { status: "ok" } }));
  await page.route("**/api/stats**", (route) => {
    const groupBy = new URL(route.request().url()).searchParams.get("group_by");
    if (groupBy === "county") {
      return route.fulfill({
        json: [
          { county_code: 39, county_name: "San Joaquin", crash_count: 269_000, total_killed: 2_767, total_injured: 100_000 },
          { county_code: 50, county_name: "Stanislaus", crash_count: 182_000, total_killed: 1_892, total_injured: 80_000 },
        ],
      });
    }
    if (groupBy) return route.fulfill({ json: [] });
    return route.fulfill({ json: { total_crashes: 182_000 } });
  });
  await page.route("**/api/crashes/heatmap**", (route) => {
    const url = new URL(route.request().url());
    const county = url.searchParams.get("county");
    // Viewport dots (bbox) and the fatal overlay stay empty: only the heat
    // layer is under test.
    const points = url.searchParams.has("bbox") || url.searchParams.has("severity")
      ? []
      : county === "san-joaquin" ? cluster(SJ_HEAT) : county === "stanislaus" ? cluster(STAN_HEAT) : [];
    return route.fulfill({ json: { points, total_crashes: points.length * 5, batch: 1, total_batches: 1 } });
  });
}

/** The camera the URL mirrors (written on moveend). */
function camera(page: Page) {
  const u = new URL(page.url());
  return {
    lat: Number(u.searchParams.get("lat")),
    lng: Number(u.searchParams.get("lng")),
    zoom: Number(u.searchParams.get("zoom")),
    county: u.searchParams.get("county"),
  };
}

/** Web Mercator pixel of a lat/lng at `zoom` (Leaflet's EPSG:3857, 256px tiles). */
function world(lat: number, lng: number, zoom: number) {
  const scale = 256 * 2 ** zoom;
  const s = Math.sin((lat * Math.PI) / 180);
  return { x: (scale * (lng + 180)) / 360, y: scale * (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) };
}

function unworld(x: number, y: number, zoom: number) {
  const scale = 256 * 2 ** zoom;
  const lng = (x / scale) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / scale))) * 180) / Math.PI;
  return { lat, lng };
}

async function mapRect(page: Page) {
  return page.locator(".leaflet-container").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
}

/** Screen position of `p` under the camera in the URL. */
async function screenPoint(page: Page, p: { lat: number; lng: number }) {
  const cam = camera(page);
  const r = await mapRect(page);
  const c = world(cam.lat, cam.lng, cam.zoom);
  const w = world(p.lat, p.lng, cam.zoom);
  return { x: r.left + r.width / 2 + (w.x - c.x), y: r.top + r.height / 2 + (w.y - c.y) };
}

/** Lat/lng under the heat canvas' inked pixels (their centroid), or null if blank. */
async function heatInkCentroid(page: Page) {
  const ink = await page.evaluate(() => {
    const canvases = [...document.querySelectorAll<HTMLCanvasElement>("canvas.leaflet-heatmap-layer")];
    let sx = 0, sy = 0, n = 0;
    for (const c of canvases) {
      if (!c.width || !c.height) continue;
      const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      const r = c.getBoundingClientRect();
      for (let y = 0; y < c.height; y += 2) {
        for (let x = 0; x < c.width; x += 2) {
          if (data[(y * c.width + x) * 4 + 3] > 40) {
            sx += r.left + (x * r.width) / c.width;
            sy += r.top + (y * r.height) / c.height;
            n++;
          }
        }
      }
    }
    return n ? { x: sx / n, y: sy / n } : null;
  });
  if (!ink) return null;
  const cam = camera(page);
  const r = await mapRect(page);
  const c = world(cam.lat, cam.lng, cam.zoom);
  return unworld(c.x + ink.x - (r.left + r.width / 2), c.y + ink.y - (r.top + r.height / 2), cam.zoom);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("calsight-intro-seen", "1");
    sessionStorage.setItem("calsight-filter-prompt-dismissed", "1");
  });
  await mockApi(page);
});

test("tapping into a neighbouring county frames it once and paints its heat, not the old county's", async ({ page }) => {
  // The deep link's camera is San Joaquin's own framing, so the URL already
  // holds the settled view (the map only starts mirroring it after a warm-up).
  await page.goto(`${BASE_URL}/?county=san-joaquin&lat=37.8923&lng=-121.2518&zoom=9`);

  // San Joaquin's heat is painted.
  await expect.poll(async () => (await heatInkCentroid(page))?.lat ?? 0, { timeout: 10_000 }).toBeGreaterThan(38.1);

  // On a phone a tap zooms toward the point until the zoom runs out, then
  // selects the county under it.
  for (let i = 0; i < 8 && camera(page).county !== "stanislaus"; i++) {
    const before = camera(page);
    const p = await screenPoint(page, MODESTO);
    await page.touchscreen.tap(p.x, p.y);
    await expect.poll(() => {
      const now = camera(page);
      return now.county !== before.county || now.zoom !== before.zoom;
    }, { timeout: 5_000 }).toBe(true);
  }
  expect(camera(page).county).toBe("stanislaus");

  // One move, and it ends on Stanislaus. The camera used to settle back on
  // San Joaquin (37.89, -121.25) while the page said Stanislaus.
  await expect.poll(() => {
    const cam = camera(page);
    return Math.hypot(cam.lat - STAN_CENTER.lat, cam.lng - STAN_CENTER.lng);
  }, { timeout: 5_000 }).toBeLessThan(0.1);
  await page.waitForTimeout(600);
  const settled = camera(page);
  expect(Math.hypot(settled.lat - STAN_CENTER.lat, settled.lng - STAN_CENTER.lng)).toBeLessThan(0.1);

  // The heat on screen is Stanislaus', where Stanislaus is.
  await expect.poll(async () => {
    const ink = await heatInkCentroid(page);
    return ink ? Math.hypot(ink.lat - STAN_HEAT.lat, ink.lng - STAN_HEAT.lng) : Infinity;
  }, { timeout: 5_000 }).toBeLessThan(0.05);
  await expect(page.getByText("Stanislaus County").first()).toBeVisible();
});
