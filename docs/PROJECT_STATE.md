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

- **Auto-deploy** from `main` — GitHub Actions → self-hosted runner (LXC 100) +
  VM 101 (API + Cloudflare tunnel); Cloudflare Pages builds the frontend.
- **Daily ETL** — **two live schedulers** on LXC 100, both to stay. A host
  cron (root, 02:00 UTC) runs `etl.run_all` inside `calsight-backend-1`; the
  `calsight-pipeline-1` container's APScheduler runs the backup (07:00), the
  daily ETL (11:00 Mon–Sat), the weekly full refresh (Sun 09:00) and VACUUM
  (15:00). The 11:00 container run is the one that usually loads data (CCRS
  refreshes upstream at ~02:05, just after the host cron fires). Captured
  verbatim in `backend/deploy/lxc100-crontab.md` — read it before touching
  either scheduler.
- **Nightly backups** with offsite copy to Cloudflare R2 (min-keep-3 rotation,
  `pg_restore --list` verification, quarantine-on-corruption).
- **Resilience baked in**: transient-failure retries w/ exponential backoff,
  React error boundaries, loud partial-failure handling in loaders,
  stale-source alerts, single-scheduler advisory lock, ETL run tracking.

## Current state (2026-09-12)

- **Live and healthy** — site 200, API ok, **11.60M** crash rows (94,804
  killed / 6.51M injured), freshness `fresh` (re-verified 2026-09-12; the
  ETL has run unattended throughout).
- **Zero open PRs.** `main` @ `a735ac9`.
- **Water module** is **public as of 2026-09-12** (`WATER_PAGE_PUBLIC = true` in
  `frontend/src/config.ts`): in the nav, sitemap and prefetch list at
  https://calsight.org/water. Data is loaded and backfilled (reservoirs,
  snowpack, drought, precip indices); the first-storm crash tile at the top
  reads `/api/first-rain` and hides itself until that endpoint is live.

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
  is set on LXC 100 and tested; the nightly backup pings an external monitor
  that emails if it ever stops. This is the important safety net for running
  unattended, and it's live. (The two Sentry items above remain optional — the
  heartbeat already covers the "did it stop running" case; Sentry only adds the
  "what errored" detail.)

### 2. ~~Retire the legacy host scheduler (#370)~~ — answered; do not retire either

**#370 is answered (2026-08-09, corrected 2026-09-12):** there are **two live
schedulers** and they are both wanted. The host cron on LXC 100 (02:00 UTC)
runs the ETL; the `calsight-pipeline-1` container's APScheduler runs the
backup (07:00), the daily ETL (11:00 Mon–Sat), the weekly refresh (Sun 09:00)
and VACUUM (15:00). The container is what produces the nightly dumps — the
host cron never touches backups — and a DR rebuild that only restores the
crontab still gets a working ETL from the container. Retiring either one loses
something. Details, redacted crontab and the diagnostics workflow that captured
them: `backend/deploy/lxc100-crontab.md`.

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
