# CalSight — Project State & Operator Handoff

*Snapshot: 2026-07-18. Active development is winding down; the platform is left
**live, stable, and self-sustaining**. This doc is the "where things stand and
what's left" reference for anyone (including future-you) picking it back up.*

## What it is

A self-hosted explorer of **11.3M California traffic-crash records** (SWITRS
2001–2015 + CCRS 2016–present) with interactive maps, configurable dashboards,
AI-generated insights, county demographic/economic context, and a
water-conditions module (reservoirs, snowpack, drought, Sierra precipitation
indices). Live at **https://calsight.org**. ~17 government data sources, 25M+ rows.

## It runs unattended

No day-to-day attention required:

- **Auto-deploy** from `main` — GitHub Actions → self-hosted runner (LXC 100) +
  VM 101 (API + Cloudflare tunnel); Cloudflare Pages builds the frontend.
- **Daily ETL** — on the *current* deployment this is scheduled by a **host
  cron on LXC 100** (crashes/parties/victims + derived transforms +
  materialized-view refresh, weekly full refresh, VACUUM + `pg_dump` backup
  nightly). The containerized `etl.pipeline` APScheduler service in the repo is
  the *newer target architecture* and is **not** what's live here yet — see the
  #370 note below before touching any scheduler.
- **Nightly backups** with offsite copy to Cloudflare R2 (min-keep-3 rotation,
  `pg_restore --list` verification, quarantine-on-corruption).
- **Resilience baked in**: transient-failure retries w/ exponential backoff,
  React error boundaries, loud partial-failure handling in loaders,
  stale-source alerts, single-scheduler advisory lock, ETL run tracking.

## Current state (2026-07-18)

- **Live and healthy** — site 200, API ok, **11.3M** crash rows, freshness `fresh`.
- **Zero open PRs.** `main` @ `e53f0a2`.
- **Water module** is fully built and tested but **deliberately hidden** behind
  `WATER_PAGE_PUBLIC = false` (`frontend/src/config.ts`). Reachable at
  https://calsight.org/water for review; kept out of public nav/sitemap by choice.
  Data is loaded and backfilled (reservoirs, snowpack, drought, precip indices).

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

### 2. ~~Retire the legacy host scheduler (#370)~~ — DO NOT DO THIS on the current deployment

**Verified 2026-07-18 at the box: the host cron on LXC 100 IS the live
scheduler — it is not a legacy leftover. Retiring it would kill the nightly
ETL and backups.** #370 (moving scheduling into the containerized
`etl.pipeline` service) only becomes relevant *if and when* the newer
containerized CalSight version is actually deployed here. Until then, **leave
the cron alone.** The `backend/deploy/README.md` retirement steps describe that
future migration, not the current box.

### 3. Repo tidy (GitHub) — cosmetic, zero functional impact

- [ ] Delete merged remote branches (all merged into `main`, safe to remove).
  From a local clone, one command does it all:

  ```bash
  git push origin --delete \
    chore/pre-launch-tidy claude/water-data-explorer feat/calenviroscreen-5 \
    feat/crash-conditions-preset feat/etl-backfill-args feat/nclimgrid-weather \
    feat/precip-indices feat/precip-indices-frontend feat/snowpack-april1 \
    feat/water-module feat/water-v2-integration fix/a11y-pass \
    fix/snow-swe-sanity fix/stale-source-alerts \
    docs/project-state-handoff docs/fix-scheduler-note
  ```

  (Any branch that's already gone just prints a harmless "remote ref does not
  exist" — safe to re-run.)

### 4. Optional / non-blocking

- [ ] **Formal accessibility sweep** (axe + Lighthouse in a browser) — every
  code-level a11y defect is fixed; this is the last WCAG gate if you ever want
  to certify it.
- [ ] **Water page public launch** — left hidden by choice. To ship it: flip
  `WATER_PAGE_PUBLIC = true` and follow the checklist in `frontend/src/config.ts`
  (restore sitemap entry + speculationrules prefetch, recompute the CSP hash in
  `_headers`, drop the `/water` noindex, re-point the Ask AI prompt).
- [ ] **Roadmap** — issues #293 / #256 / #304 are a post-launch feature backlog,
  not unfinished work. The next natural feature was the "first-rain-after-a-dry-
  spell" crash story (needs a daily-weather table on top of the nClimGrid loader).

## Key references

| Topic | File |
|---|---|
| Operator env vars + secret rotation | `docs/OPERATOR_SETUP.md` |
| Pre-launch / production checklist | `docs/PRODUCTION_CHECKLIST.md` |
| Definition of done | `docs/DEFINITION_OF_DONE.md` |
| ETL scheduling + #370 detail | `backend/deploy/README.md` |
| Data honesty / known gaps | `backend/DATA_GAPS.md` |
| Methodology | `docs/DATA_METHODOLOGY.md` |
