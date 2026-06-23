# CalSight — Definition of Done

> The "finish line" list. Nine MEGA umbrella issues (#291, #292, #293, #300, #301,
> #303, #304, #256, plus features #279/#280) bury launch-critical work next to
> nice-to-haves. This doc pulls out **only the verified must-dos** in priority order
> so "done" is legible. Each item links to the MEGA that tracks it.
>
> Status legend: 🔴 launch-critical · 🟠 credibility · 🟡 polish/reach · ✅ verified done
>
> Last verified against code: 2026-06-23. CalSight is **already live in production**,
> so reliability/observability gaps are active risk, not future work.

---

## 🔴 Reliability & Observability (live prod — highest priority)

- [ ] **Wire offsite backup into the scheduler.** The scheduled backup (`etl/pipeline.py`
      `run_backup`) is **local-only**; the R2 upload + rotation code in `etl/backup.py`
      is never called by the scheduler. You likely have **no offsite copy** (3-2-1 not
      met). Fix: have the scheduled backup call `backup.upload_to_r2()` +
      `rotate_r2_backups()`, or schedule `etl.backup.main` instead of the local-only
      duplicate. *(uncaptured before 2026-06-23)*
- [ ] **Verify R2 actually has backups + isn't accruing cost.** Cloudflare dashboard →
      R2 → `calsight-backups`: does it exist, have objects, total size? On LXC 100:
      `crontab -l | grep backup` and `R2_*` vars in `backend/.env`.
- [ ] **Add a dead-man's-switch / uptime alert.** Current alerting (`etl/alerts.py`,
      Discord) only fires *while a job runs and catches an error* — if the whole box,
      backend, or Cloudflare tunnel is down, **nothing alerts you**. Add (a) an external
      uptime ping against the public URL (e.g. UptimeRobot / healthchecks.io heartbeat),
      and (b) a "backup did NOT run today" alert, so silence ≠ healthy. *(new — 2026-06-23)*
- [ ] **Error monitoring (Sentry).** Verified: **zero** Sentry in backend or frontend.
      Production has no error visibility. Add backend + frontend SDK. *(in #256 "strategic" — elevate)*
- [ ] **ETL data-integrity bugs** *(in #292 — re-verified 2026-06-23):*
  - [x] ~~**Migration advisory lock provides ZERO protection.**~~ FIXED 2026-06-23
        (`0423aa8`): now holds a single connection across acquire → `alembic upgrade` →
        release, so the session-scoped lock actually protects the migration.
  - [x] ~~**Backup rotation can delete ALL backups** if dumps fail 7+ days.~~ FIXED
        2026-06-23 (`0423aa8`): always keeps the 3 most-recent dumps regardless of age.
  - [ ] No backup verification — add `pg_restore --list` check after dump (`backup.py`)
  - [ ] No cross-job concurrency guard — APScheduler defaults `max_instances=1` *per job id*,
        so same-job overlap is safe, but daily/weekly/manual runs can still contend on the DB.

## 🔴 Maintenance UX (for server migrations / planned downtime)

- [ ] **Maintenance mode + status screen.** No graceful-downtime path exists today.
      When you migrate the server or the DB is down, users hit raw errors. Add a
      maintenance flag (env var or sentinel file) that makes the backend return `503`
      with `Retry-After`, and a friendly frontend screen ("CalSight is down for
      scheduled maintenance — back shortly"). Optionally a lightweight public status
      page. *(new — 2026-06-23)*

## 🟠 Analytical Credibility (public data tool — trust matters)

- [ ] **Lower AI temperature** from 0.7 → 0.3–0.5 for data analysis (verified `llm.py:193,228,327`). *(in #293)*
- [ ] **Causal-claim guardrails** in the system prompt (correlation ≠ causation). *(in #293)*
- [ ] **Methodology footer placeholder text** — replace fake/placeholder copy before more eyes land. *(roadmap note — verify)*
- [ ] **Inline jargon tooltips** — SWITRS, KSI, AADT, CES, ACS, MV explained on hover. *(in #304)*
- [ ] **Neighborhood/percentile context** — "safer than 70% of CA counties" so raw rates mean something. *(in #304)*

## 🟠 Accessibility — WCAG 2.2 AA

> Baseline is decent (79 files use aria/role) but there's no formal audit. Goal is
> WCAG 2.2 AA. Run axe/Lighthouse a11y on every page and close the gaps.

- [ ] Formal WCAG 2.2 AA audit pass (axe DevTools + Lighthouse) across Map / Stats / Ask AI / About. *(new framing — 2026-06-23)*
- [ ] AdminGuard password input — accessible label *(in #291; partly addressed in PR #321)*
- [ ] Leaflet popup `#666` text invisible in dark mode (`OverlayMarkers.tsx:104,133`) *(in #291)*
- [ ] Chat feedback buttons below 44px touch target (`ChatMessage.tsx:83-98`) *(in #291)*
- [ ] SimplePolarArea labels hardcode `#fff` — contrast fail on light slices *(in #291)*
- [ ] Focus trap missing in ChartConfigSheet — keyboard users tab outside modal *(polish backlog)*
- [ ] 2.2-specific: target size (2.5.8), focus-not-obscured (2.4.11), consistent help (3.2.6), redundant entry (3.3.7)

## 🟡 Test Coverage *(in #303)*

- [ ] 58/81 frontend hooks/lib untested — prioritize dashboard hooks (useDashboardConfig/Data, useCorrelationData, stats.ts) and chart components.
- [ ] Error-path / observability tests for ETL partial-failure handling.

## 🟡 Reach & Polish

- [ ] **Spanish (i18n)** — verified no i18n library; 39% of CA residents. ~150–200 strings. *(in #293/#256)*
- [ ] **Privacy-respecting usage analytics** (Plausible/Umami — no cookies/PII). *(in #304)*
- [ ] **Delete dead `etl/scheduler.py`** — superseded by `pipeline.py` (verified still present). *(in #292)*
- [ ] Toast/notification system + confirmation dialogs ("Clear All Filters", "New Chat"). *(in #256/#293)*
- [ ] Copy buttons (AI messages, share link), chart PNG export. *(in #256)*
- [ ] Quick-win backlog: county deep-link auto-zoom, sticky mobile filter bar, data freshness indicator. *(in #256)*

## ✅ Verified done — do NOT re-track

- ✅ `/api/weather` endpoint exists (data-gaps note was stale).
- ✅ ETL no longer marks failed batches "success" — uses `partial_success` + error_message + alert (`load_crashes.py:345-349`). #292's claim is stale.
- ✅ `pg_dump` password no longer on command line — uses `PGPASSWORD` (PR #321).
- ✅ County selection in heatmap (#298 closed, verified live).
- ✅ Dangerous-highways map layer renders (PR #320); only prod `route_number` backfill remains.

---

## Suggested order to the finish line

1. **Verify R2** (5 min, tells you if you have offsite backup at all) → wire offsite backup into scheduler.
2. **Uptime/dead-man's-switch + Sentry** — cheap, huge confidence for a live, self-hosted, autonomous system.
3. **Maintenance mode** — needed before your next server migration.
4. **AI credibility pass** (temperature + guardrails + methodology footer) — fast, protects trust.
5. **WCAG 2.2 AA audit** — batch the #291 items behind one axe/Lighthouse sweep.
6. Test coverage, then reach/polish.
