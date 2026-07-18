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
- **Daily ETL** (`etl.pipeline`, APScheduler in the `pipeline` container):
  crashes/parties/victims + derived transforms + materialized-view refresh at
  11:00 UTC; weekly full refresh (incl. monthly reference sources) Sundays;
  VACUUM + `pg_dump` backup nightly.
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
- [ ] **Heartbeat / dead-man's-switch** — add `HEARTBEAT_URL=<uptime-monitor
  ping URL>` to `/opt/calsight/backend/.env` on **LXC 100** (an *unmanaged*
  key the deploy preserves). Point it at an external cron-monitor so a dead
  pipeline or a dead box actually pages you.

### 2. Retire the legacy host scheduler (#370) — on LXC 100, ORDER MATTERS

The container `pipeline` service is the real scheduler now; an old host-side
systemd/cron runner may still exist. Disabling it *before* confirming the
container scheduler is healthy would stop all ETL (this bit us on 2026-07-13).

```bash
# 1. Verify the compose scheduler is genuinely alive FIRST:
docker ps --filter name=pipeline                     # expect: Up (not Restarting)
docker logs --tail 30 calsight-pipeline-1            # expect "Schedules:" banner, no traceback

# 2. See what (if anything) still fires the old nightly:
systemctl cat calsight-etl-scheduler 2>/dev/null || echo "no such unit"
crontab -l | grep -i -e etl -e calsight

# 3. ONLY after step 1 is healthy AND a container run has landed in etl_runs:
systemctl disable --now calsight-etl-scheduler 2>/dev/null || true
rm -f /etc/systemd/system/calsight-etl-scheduler.service && systemctl daemon-reload
crontab -l | grep -v etl | crontab -                 # drop any leftover ETL cron line
```

### 3. Repo tidy (GitHub)

- [ ] Delete merged remote branches (all merged into `main`, safe to remove):
  `chore/pre-launch-tidy`, `claude/water-data-explorer`, `feat/calenviroscreen-5`,
  `feat/crash-conditions-preset`, `feat/etl-backfill-args`, `feat/nclimgrid-weather`,
  `feat/precip-indices`, `feat/precip-indices-frontend`, `feat/snowpack-april1`,
  `feat/water-module`, `feat/water-v2-integration`, `fix/a11y-pass`,
  `fix/snow-swe-sanity`, `fix/stale-source-alerts`.

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
