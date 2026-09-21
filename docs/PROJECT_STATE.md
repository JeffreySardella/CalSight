# CalSight — Project State & Operator Handoff

*Snapshot: 2026-07-18. Active development is winding down; the platform is left
**live, stable, and self-sustaining**. This doc is the "where things stand and
what's left" reference for anyone (including future-you) picking it back up.*

## What it is

A self-hosted explorer of **11.6M California traffic-crash records** (SWITRS
2001–2015 + CCRS 2016–present) with interactive maps, configurable dashboards,
AI-generated insights, county demographic/economic context, and a
water-conditions module (reservoirs, snowpack, drought, Sierra precipitation
indices). Live at **https://calsight.org**. 12 providers (30 ETL jobs), 26M+ rows.

## It runs unattended

No day-to-day attention required:

- **Auto-deploy** from `main` — GitHub Actions → self-hosted runner
  `calsight-prod` on **VM 101** (hostname `docker-vm`: API, pipeline
  container, Cloudflare tunnel); Cloudflare Pages builds the frontend. The
  database is on **LXC 100** (`calsight-prod-db`, 10.27.27.88).
- **Daily ETL** — **two live schedulers**, both on VM 101, both to stay. A
  host cron (root, 02:00 UTC) runs `etl.run_all` inside `calsight-backend-1`;
  the `calsight-pipeline-1` container's APScheduler runs a local backup
  (07:00), the daily ETL (11:00 Mon–Sat), the weekly full refresh (Sun 09:00)
  and VACUUM (15:00). The 11:00 container run is the one that usually loads
  data (CCRS refreshes upstream at ~02:05, just after the host cron fires).
- **Nightly offsite backup → Cloudflare R2** — a root cron on **LXC 100**
  (19:00 UTC) runs the standalone script saved as
  `backend/deploy/lxc100-backup.py` (gzipped `pg_dump -Fc`, 3 local copies,
  Cloudflare 7-day retention, Discord + healthchecks.io ping). It is the
  **only** writer to R2; the container's 07:00 dump stays on VM 101. All of
  this is captured in `backend/deploy/lxc100-crontab.md` — read it before
  touching any scheduler.
- **Resilience baked in**: transient-failure retries w/ exponential backoff,
  React error boundaries, loud partial-failure handling in loaders,
  stale-source alerts, single-scheduler advisory lock, ETL run tracking.

## Current state (2026-09-21)

- **Live and healthy** — site 200, API ok, **11.60M** crash rows (94,804
  killed / 6.51M injured), unchanged since 2026-09-12 (nothing in this
  window reloaded crash totals). `main` @ `03ea9b3`, **zero open PRs**.
- **True KSI is live end to end.** The backend gained a per-crash
  `number_severe_injured` count, backfilled from both SWITRS (2001–2015)
  and CCRS (2016–present); the Stats hero tile and the year dashboard's
  new KSI measure now count people killed **or** seriously injured
  instead of every injury, with a definition footnote wherever a charted
  range crosses the 2015→2016 or 2017→2018 boundary.
- **A second feature wave shipped 2026-09-14 through 2026-09-21** on top
  of the water launch: a mode-of-travel dimension, the tule-fog and
  "Holidays on the road" stories, a VMT denominator, a school-proximity
  layer, a census-tract equity layer, streaming Ask AI, a printable
  county report card, and a build-time sitemap. Full list in "Shipped
  2026-09-14 to 2026-09-21" below.
- **The map is usable on a phone now.** Server-side heat aggregation,
  tap-to-zoom instead of a county switch, and a service-worker update
  that no longer reloads mid-gesture — all found and fixed against a
  real link the owner sent from their phone.
- **Water module** is unchanged from 2026-09-12: still **public**
  (`WATER_PAGE_PUBLIC = true` in `frontend/src/config.ts`), in the nav,
  sitemap and prefetch list at https://calsight.org/water.

## Operator checklist — the only things left

Everything below requires access the repo/CI cannot reach (GitHub secrets,
Cloudflare dashboard, or a shell on the Proxmox hosts). None of it blocks the
app from running; #1 is the one that matters most now that no one is watching.

### 1. Turn on observability — do this first

If something breaks while the app is unattended, **nothing currently alerts
you**. The code is all shipped; these just switch it on.

- [ ] **Backend Sentry** — set the `SENTRY_DSN` **GitHub Actions secret**. The
  next deploy writes it into the box `.env` automatically (it's a *managed*
  key — do **not** hand-edit `.env`, the deploy overwrites it).
- [ ] **Frontend Sentry** — set `VITE_SENTRY_DSN` in **Cloudflare Pages →
  Settings → Environment variables**, then **redeploy** Pages (Vite bakes env
  vars in at build time).
- [x] **Heartbeat / dead-man's-switch — DONE (2026-07-18).** `HEARTBEAT_URL`
  is set on VM 101, and the LXC 100 backup cron pings healthchecks.io — a monitor
  that emails if it ever stops. This is the important safety net for running
  unattended, and it's live. (The two Sentry items above remain optional — the
  heartbeat already covers the "did it stop running" case; Sentry only adds the
  "what errored" detail.)

### 2. ~~Retire the legacy host scheduler (#370)~~ — answered; do not retire either

**#370 is answered (2026-08-09, corrected 2026-09-13):** there are **three
live schedulers** on two hosts and all are wanted. VM 101: host cron (02:00
UTC, ETL) and the `calsight-pipeline-1` container (07:00 local backup, 11:00
daily ETL, Sun 09:00 weekly refresh, 15:00 VACUUM). LXC 100: root cron (19:00
UTC) running the standalone R2 backup script, the only path to offsite. The
earlier "unidentified R2 uploader" thread is closed — it was this cron, invisible
to Pipeline Diagnostics because that workflow runs on VM 101. Details,
redacted crontabs and the verbatim script: `backend/deploy/lxc100-crontab.md`.

### 3. Repo tidy (GitHub) — cosmetic, zero functional impact

- [x] **Delete merged remote branches — DONE.** Verified 2026-08-07:
  `git branch -r` shows only `origin/main`.

- [ ] Local clone still holds 18 merged branches and 4 stale agent worktrees.
  Purely local clutter — nothing on GitHub, no functional impact:

  ```bash
  git worktree prune          # after `git worktree remove` on any that remain
  git branch --merged main | grep -v '^\*\| main$' | xargs -r git branch -d
  ```

  (`-d` refuses to delete anything not actually merged, so this is safe.)

### 4. Optional / non-blocking

- [ ] **Formal accessibility sweep** (axe + Lighthouse in a browser) — every
  code-level a11y defect is fixed; this is the last WCAG gate if you ever want
  to certify it.
- [x] **Water page public launch** — public as of 2026-09-12: flag flipped,
  sitemap entry + speculationrules prefetch restored, CSP hash recomputed in
  `_headers`, `/water` noindex dropped, Ask AI prompt re-pointed. The rollback
  recipe lives in the flag's docstring in `frontend/src/config.ts`.
- [ ] **Roadmap** — issues #293 / #256 / #304 are a post-launch feature backlog,
  not unfinished work. The "first-rain-after-a-dry-spell" crash story shipped
  with the Water launch (`/stats?story=first-storm`, fed by `/api/first-rain`).

## Shipped 2026-09-14 to 2026-09-21

- **True KSI, backend and frontend.** A per-crash `number_severe_injured`
  count, a matview swap, and backfills from both SWITRS and CCRS; the
  hero tile and a new year-chart measure read people killed or
  seriously injured instead of every injury. Deaths per 1,000 crashes
  replaced the old fatality-rate percent on the default year view.
- **Mode of travel.** A new dimension splits people into pedestrian /
  cyclist / motorcyclist / occupant. It counts people, not crashes (a
  crash-level flag can't tell a pedestrian-only crash from one that also
  hit a cyclist), and only covers 2016+ — CCRS has no mode data for
  SWITRS years.
- **Tule fog story.** A NOAA Storm Events loader maps 83 NWS forecast
  zones onto 32 counties (fog and winter-storm rows carry a zone, never
  a county) and powers `/api/fog-days` and a new tule-fog story for the
  San Joaquin Valley.
- **"Holidays on the road" story.** A new daily matview backs a
  comparison of seven holiday periods (Thanksgiving, Christmas/New
  Year, July 4th, Memorial Day, Labor Day, Super Bowl Sunday, Halloween)
  against the ordinary days of their own month and year.
- **VMT denominator.** County vehicle-miles-traveled from CARB EMFAC2025
  backs a new "crashes per 100M vehicle miles" choropleth measure — the
  exposure metric the safety literature actually uses, versus
  population or road miles.
- **Crashes within 500 ft of schools.** A new matview and a bounding-box
  distance query color the existing school marker layer by nearby crash
  counts, with the per-county coordinate-coverage caveat stated in the
  popup (only ~37% of crashes statewide carry coordinates).
- **Census-tract equity layer.** `tract_ces` + `tract_crash_year` put
  recorded crash burden next to CalEnviroScreen's environmental-justice
  score at the tract level, joined with shapely's `STRtree` since the
  DB host has no PostGIS.
- **Streaming Ask AI.** `POST /api/ask/stream` renders the answer token
  by token over SSE; any failure before the first token falls back to
  the existing `/api/ask` call, so nothing gets worse for a client that
  can't stream.
- **Printable county report card** at `/county/:slug/report` — one
  Letter page per county with headline numbers, a ten-year chart, top
  collision factors, and a small-county rule that withholds a rate
  below its reliability threshold (10 deaths or 50 crashes a year) in
  favor of a pooled five-year figure.
- **SEO.** `sitemap.xml` now generates at build time from the same
  preset/story lists the app uses (27 URLs; the old hand-maintained
  file was missing 4 of 9 presets), plus static `WebSite`/`Dataset`
  JSON-LD and a distinct title per preset and story.
- **Causal-language gate reaches the AI county narratives**, not just
  the fun facts (prod QA caught a county card claiming speeding
  "caused" a share of crashes SWITRS can't support), and a follow-up
  fixed the gate rejecting its own honest sentences — a crash-outcome
  tally like "52.1% resulted in no injuries" is descriptive, not
  causal.
- **Zero-row loader guards.** 13 reference-table loaders now hard-fail
  on an empty upstream body instead of recording a clean zero-row
  success and resetting the freshness clock; five lagging-publication
  sources (FARS, tract density, DMV vehicles, weather, the CCRS crash
  family) got a period-aware version of the same guard so ordinary
  publishing lag isn't mistaken for an outage.
- **Data-story audit.** All ten Stats-page data stories were checked
  against production; five had the wrong number, three had none. Fixed
  in place — the Two Californias gap is 4.1x, not 3.1x; the DUI peak is
  10 PM, not 2 AM; the environmental-justice correlation is 0.14, not
  0.52.
- **Accessibility, bundle size, highways cache.** An axe + manual WCAG
  2.2 pass across every route found zero remaining serious/critical
  violations; the Ask AI popover's markdown/chart renderers moved out
  of the entry chunk (about 52 KB gzip off it, measured against the
  pre-branch baseline); `/api/stats/highways` picked up the same
  6-hour cache its sibling endpoints already had (median request time
  was ~1.95s before).
- **Mobile map made usable on a phone.** A service-worker update was
  reloading the page mid-gesture; a tap on a hotspot below zoom 14 was
  switching counties instead of zooming; and the heat layer was
  shipping full-detail JSON for a canvas that only ever needed
  lat/lng/weight. Now: server-side heat aggregation (`max_points`)
  bounded to what a phone can reproject in one frame, a slim point
  shape, viewport-scoped dot queries, tap-to-zoom, and a deferred SW
  update. A same-week follow-up fixed a regression where a tapped
  crash dot's popup vanished on the pan that centers it.
- **Dependency bumps** across backend (uvicorn, SQLAlchemy, Alembic,
  boto3, sentry-sdk) and frontend (TanStack Query, react-router-dom,
  autoprefixer) via Dependabot. The 32 stale
  branches left on `origin` by earlier merges were deleted; it now holds
  only `main` and the branches of open PRs.

## Shipped 2026-09-12

- **SWITRS 2001 reloaded** — 211k case IDs overflowed bigint and were dropped;
  now folded, 2001 = 522,562 crashes (was 310,000), statewide 11.60M. The loader
  fetches Zenodo's direct file URL (the `files-archive` ZIP endpoint 400s for
  records > 300 MB).
- **Water page public** + the first-storm bridge: `weather_daily`,
  `first_rain_events`, `/api/first-rain`, the FirstStormTile and
  `/stats?story=first-storm`.
- **1991–2020 baselines** — percent-of-average for reservoirs, snowpack and
  precipitation indices uses the DWR calendar-day normal; CDEC history
  backfilled from 1991. Snowpack now uses DWR's official 110-station lists.
- **LLM roster** — Groq gpt-oss-120b (low reasoning) → Gemini 3.5 Flash-Lite →
  OpenRouter; Cerebras removed.
- **`mv_street_totals`** — coarse default-state matview for intersections,
  corridors and street concentration (10 matviews total).
- **CI gates** — Playwright e2e (hermetic) and Lighthouse accessibility ≥ 0.95
  on `/`, `/water`, `/stats`, `/about`; Dependabot alerts on, grouped
  minor/patch weekly via `.github/dependabot.yml`.

## Key references

| Topic | File |
|---|---|
| Operator env vars + secret rotation | `docs/OPERATOR_SETUP.md` |
| Pre-launch / production checklist | `docs/PRODUCTION_CHECKLIST.md` |
| Definition of done | `docs/DEFINITION_OF_DONE.md` |
| ETL scheduling + #370 detail | `backend/deploy/README.md` |
| Data honesty / known gaps | `backend/DATA_GAPS.md` |
| Methodology | `docs/DATA_METHODOLOGY.md` |
