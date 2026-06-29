# Mobile Polish Audit

Running list of mobile (≈390px phone) polish issues — cut-off / not-centered / overflow / spacing. We add to this as we audit, and fix incrementally. Not blockers; UX polish.

**Viewport:** 390×844 (iPhone-class). **Site:** https://calsight.org (prod). **Started:** 2026-06-28.

Severity: 🔴 collision/unusable · 🟠 visibly broken/clipped · 🟡 minor (spacing/alignment).

---

## /stats — Statistics Dashboard

- 🔴 **AI companion popover overlaps the bottom tab bar.** `AiCompanion.tsx` dialog is `fixed bottom-4 right-4`; on mobile it sits on top of the MAP/STATS/ASK AI/ABOUT nav. Gets worse once the deep-dive answer renders (taller, scrolls into the nav). Fix: raise the bottom offset to clear the mobile nav (e.g. `bottom-20` on small screens / add safe-area + nav height), and/or make it a bottom sheet on mobile.
- 🟠 **Filter chips row clipped on the right.** "All Causes" chip is cut off at the screen edge in the FILTERS row. If it's a horizontal-scroll row, it reads as broken — add a fade/scroll affordance or wrap; if not scrollable, it's a real overflow.

---

## / — Map Explorer

- 🟡 **Two stacked bottom bars.** The "California Insight" panel header sits directly above the MAP/STATS/ASK AI/ABOUT nav (collapsed it's fine). Verify the *expanded* Insight panel doesn't overlap the nav or eat too much of the short mobile viewport.
- ✅ Map, legend ("Crashes per 100K residents"), and top-right controls (locate/share/filters) render cleanly at 390px. (Map tile labels like "Gulf of California" run off-edge — expected for a slippy map, not a UI bug.)

## /ask — Ask AI (+ Story Canvas)

- 🟠 **Missing icon glyphs — `auto_stories` (Story toggle), `push_pin` (pin button), and `delete_sweep` (panel Clear button) render as literal/garbled text** ("AUTO_STORIES", "PUSH_PIN", "🗑 _sweep"). NOT mobile-specific — affects desktop too. Root cause: every `.material-symbols-outlined` span correctly has `font-family: "Material Symbols Outlined"`, and older icons (settings/add/thumb_up/thumb_down/auto_awesome/send/close) render fine — but these three NEW glyphs are absent from the loaded (self-hosted/subset) font. All three were introduced by our Story Canvas work (`push_pin` Task 3, `auto_stories` + `delete_sweep` Tasks 5–6) and never added to the font's codepoint subset. Fix: add `auto_stories`, `push_pin`, `delete_sweep` to the Material Symbols subset/codepoint list (or switch those buttons to icons already in the subset). **First fix candidate — visible, brand-breaking, our regression.**
- 🟡 **"Ask AI" h1 wraps to two lines** on mobile (measured h1 height ≈56px = 2 lines) — the header row is crowded by the "Story" + "New Chat" buttons. Tighten header spacing / shorten labels / allow the title to stay on one line.
- (Note: a prior deep-dive Q&A persists in the chat from the companion's shared sessionStorage — expected behavior, not a bug.)

## /ask — Story Canvas panel (opened)

- ✅ Slide-over fills the viewport full-width (390px), fits with no overflow; title input + ✕ close reachable; empty-state copy + "Add note" present; Export PNG/PDF correctly disabled when the canvas is empty. (Only issue is the `delete_sweep` Clear icon — folded into the icon-glyph item above.)

## /about

- ✅ Clean and well-centered at 390px — heading, mission copy, nav all good.
- 🟡 Large vertical gap between the intro paragraph and "OUR MISSION" — likely intentional spacing; glance at it during a polish pass.

## / — Map: Highway Danger layer legibility (desktop + mobile)

- 🟠 **Highway Danger shading is not legible — can't tell if routes are shaded by danger.** With the layer ON ("Color by Fatality Rate"), at statewide AND z10/z13 LA zoom the freeway lines render as faint light-blue/lavender lines in the SAME hue family as the blue county choropleth ("Crashes per 100K") → essentially no visible danger gradient; the network blends into the choropleth + basemap roads. One anomalous thick BLACK route stands out (outlier/selected/dark end of scale) but the rest don't visibly vary. Confirmed via Playwright on prod (z13 LA freeways: Hollywood/Harbor/Santa Monica/Pomona/Santa Ana all near-uniform light blue). Backend data is fine (`/api/stats/highways` returns ranked routes). Likely causes to confirm in the highways layer code (from PR #326): (a) danger palette overlaps the choropleth's blue ramp → zero contrast; (b) thin lines with no contrasting casing/outline; (c) possibly low fatality-rate variance so most routes map to one end. Fix direction: when Highway Danger is on, use a high-contrast danger palette distinct from the choropleth (e.g. yellow→red), thicker lines with a dark casing, and/or auto-dim the county choropleth so highways read on top. **Strong fix candidate — it's a flagship feature (#326) that currently doesn't communicate its point.**
  - 🎨 **TODO: try several danger palettes** (per Jeff). Prototype a few and compare on-map: (a) sequential yellow→orange→red; (b) green→yellow→red diverging "safe→deadly"; (c) viridis/magma high-contrast; each with a dark casing/outline and increased line width. Also test auto-dimming the county choropleth (lower opacity) while the highways layer is active so the danger colors read on top. Pick the clearest in a side-by-side.

## /ask — Story Canvas EXPORT (BROKEN — top priority, not just polish)

- 🔴 **Export PNG/PDF downloads a BLANK white image.** Confirmed live on prod: pinned a real answer, clicked Export PNG → `calsight-story-2026-06-28.png` downloaded but is entirely blank. Root cause CONFIRMED: the offscreen `StoryReportView` target renders correctly in the DOM (720×344, real content) but is positioned `position:fixed; left:-9999px` — `html-to-image` preserves that offset on its clone and rasterizes the content off-canvas → blank output. PDF uses the same `toPng` path → same result. **Why our tests missed it:** every export test mocks `html-to-image`, so the suite was green while the real feature produces nothing. Fix: stop using `left:-9999px` for the capture target — render it on-screen-but-hidden (e.g. `opacity:0; pointer-events:none; position:fixed; inset:0; z-index:-1`) or neutralize the offset on the clone (html-to-image `style`/`onclone`), then re-verify the actual downloaded file (not a mock). Add a real (non-mocked) export smoke check.
- 🟠 **Even once rendering, exported fonts fall back (CSP blocks embedding).** During export, 4 console errors: `html-to-image` inlines fonts as `data:font/woff2;base64,…` but the site CSP is `font-src 'self' https://fonts.gstatic.com` → all `data:` fonts blocked. So the export can't embed CalSight's fonts/icons and will use fallback typefaces. Fix alongside the blank-export fix: add `data:` to `font-src` in `frontend/public/_headers` (weigh security) or supply `fontEmbedCSS`/skip-font options to html-to-image.
- ✅ Populated Story panel itself renders fine on mobile (pinned card readable; up/down/trash reorder icons render correctly — those glyphs ARE in the subset; Export buttons enable when content present). Only the Clear `delete_sweep` icon is garbled (see icon item).

## /stats — Mobile filter sheet

- ✅ Clean bottom sheet: drag handle, COUNTY (chip + search), DATE RANGE (From/To Month/Year), CAUSE chips that wrap well, Reset + full-width DONE. Cause/filter icons render fine (in subset). No overflow/cut-off.
- 🟡 Redundant-looking "Filters" chip directly under the "Filters" header — minor; verify it's a meaningful control, not duplication.

---

## Light mode (Appearance → Light)

- ✅ `/stats` light mode: white cards, dark text, good contrast across hero metrics, insight banner, Anomaly/Key Findings/Suggested Charts. Clean.
- ✅ AI companion popover adapts to light mode (light surface, dark headline/body, purple "Go deeper" button) — good contrast.
- ✅ Map light mode: chrome + basemap + insight card all go light correctly.
- 🟠 **Highways palette collision persists in light mode too** — confirms #2 is a palette problem, not a theme problem (highways blend into the blue choropleth in both themes). Also the very-light end of the choropleth ramp can blend into the light basemap (faint county edges) — minor, check during the palette work.

## Priority rollup

### ✅ FIXED + DEPLOYED 2026-06-28 (browser-verified on prod)
1. ✅ **Story Canvas Export blank file** — fixed (PR #332): html-to-image clone kept the `-9999px` offset → off-canvas. Added `style` override to anchor the clone at origin + allowed `data:` fonts in CSP. Verified: export renders the full story.
2. ✅ **Missing icon glyphs** — fixed (PR #332): added `auto_stories`/`push_pin`/`delete_sweep` to the Google Fonts `icon_names` subset. Verified: all 3 render as glyphs.
3. ✅ **Highway Danger legibility** — fixed (PR #332 palette + #333 casing): dedicated mono-danger ramp (orange→crimson, independent of choropleth) + white casing. Verified live: 150 lines in the danger palette + 152 white casings; routes now read distinctly (esp. the I-5 corridor). NOTE: dark-crimson high-danger routes are still a bit muted over the blue choropleth — optional future polish = dim the county choropleth opacity when Highway Danger is active (removes the competing blue entirely). PWA note: the update appears on the user's SECOND load (service worker serves cached bundle first).

### 🛣️ Highways — next-up backlog (from 2026-06-28 review w/ Jeff)
- **Highways now render ABOVE the county choropleth** (dedicated Leaflet pane, z-index 450) + this fixed click-to-select (the choropleth was eating clicks). Shipping now.
- **Click → highway stats already works** (`HighwaySidePanelContent`): route, miles, crashes, killed, injured, fatality rate, crashes/mile. Verified (SR-1).
- [x] **Highway AI cards** — DONE 2026-06-29 (`polish/mobile-and-highways`). Each stat in `HighwaySidePanelContent` is now an `Explainable` (kind `highway`, geography type `highway`) wired to the AI companion via a new `highwayStatContext` builder; MapPage threads the active filter snapshot in. Tests cover the affordances + companion-open.
- [x] **"Most dangerous highway" ranking feature** — Already shipped: `HighwayRankingsTable` is rendered always-on at `StatsPage.tsx:771` ("Most dangerous highways" section, sortable by total crashes / fatality rate / crashes-per-mile). The audit/memory note was stale.
- [ ] **Highway geometry fidelity** — `ca-highways.geojson` is **410KB**, simplified at tolerance **0.005° (~550m)** in `etl/build_highway_geometry.py` → straight/coarse lines when zoomed. Improving needs re-running the ETL against the Caltrans SHN source (not in-repo) + a deliberate size/perf decision. Best = zoom-adaptive multi-resolution; quick win = drop tolerance to ~0.002°. Deferred (needs source data).
- [x] **Performance / bundle audit (#302)** — export libs (`html-to-image` + `jspdf`) are lazy-loaded on first export (PR #336, `lib/story/exportCanvas.ts` dynamic imports).
- [x] **Backend query efficiency (#310)** — AUDITED 2026-06-29, **healthy**. `/api/stats/highways` is a single server-side `GROUP BY route_number` aggregate (COUNT/SUM, ~250-row output — no raw-row pull), `WHERE route_number IS NOT NULL` backed by the partial index `ix_crashes_route_number` (migration `q5r6s7t8u9v0`). The `crashes` table is indexed on every filter dimension (crash_year, county_code+datetime, canonical cause/weather/lighting/road/collision_type, alcohol/distraction/pedestrian/cyclist/drug partials, primary_factor, at_fault_driver_age, lat_lng). Endpoint sets `Cache-Control: max-age=3600, SWR 86400`. **Optional future opt (deferred, needs deliberate prod index migration):** a covering index `crashes(route_number) INCLUDE (number_killed, number_injured)` would make the unfiltered full-network aggregate index-only instead of heap-fetching the SUM columns — low priority given the 1h cache.

### ✅ FIXED 2026-06-29 (`polish/mobile-and-highways`)
4. ✅ **AI companion popover overlap** — raised to `bottom-[calc(4rem+safe-area)]` + `left-4/right-4` (clears the `h-14` nav, no left-edge overflow) below `lg`; keeps `bottom-4` on `lg+` where the nav is hidden (`AiCompanion.tsx`).
5. ✅ **Filter chips clipped right** (/stats) — the permanent `scroll-fade-r` mask was fading the last chip when scrolled to the end; added `pr-8` trailing scroll padding so the final chip clears the fade (`StatsPage.tsx`).
6. ✅ **"Ask AI" h1 wraps** — added `whitespace-nowrap` so the short title can't wrap when the button group squeezes the `min-w-0` column (`AskAiPage.tsx`).
7. ✅ **Map double bottom-bars** — VERIFIED no fix needed: `.bottom-card-mobile` = `bottom: calc(3.5rem + safe-area)` (exactly the `h-14` nav height) and the card is capped `max-h-[60vh]` with internal scroll, so it sits cleanly above the nav and can't overlap it or eat the viewport. About-page gap is intentional spacing.
8. ✅ **Export regression guard** — added a real (non-mocked) Playwright smoke check (`tests/story-export.spec.ts`): builds a note story, exports PNG, decodes the downloaded PNG's pixels (Node `zlib`) and asserts non-white content — catches the all-white blank-export class the mocks missed. Also strengthened the unit test to assert the offset-neutralizing `style` override, and fixed `playwright.config.ts` webServer port (was awaiting 5174 while `vite dev` served 5173, so the auto-start always timed out).

### ⏳ REMAINING (open backlog — not yet fixed)
- 🟡 /stats redundant "Filters" chip under the "Filters" header — verify it's a meaningful control, not duplication.
- Process: consider a pre-deploy browser pass for UI changes.
- Un-audited states: tablet (~768px), expanded Map "California Insight" panel, /ask in light mode.
