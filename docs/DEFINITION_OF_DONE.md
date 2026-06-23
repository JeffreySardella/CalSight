# CalSight — Definition of Done

> The "finish line" list. Nine MEGA umbrella issues (#291, #292, #293, #300, #301,
> #303, #304, #256, plus features #279/#280) bury launch-critical work next to
> nice-to-haves. This doc pulls out **only the verified must-dos** in priority order
> so "done" is legible. Each item links to the MEGA that tracks it.
>
> Status legend: 🔴 launch-critical · 🟠 credibility · 🟡 polish/reach · ✅ verified done
> · `[~]` code complete but prod activation unverified (config-gated)
>
> Last verified against code: 2026-06-23. CalSight is **already live in production**,
> so reliability/observability gaps are active risk, not future work.

---

## 🔴 Reliability & Observability (live prod — highest priority)

- [x] ~~**Wire offsite backup into the scheduler.**~~ DONE 2026-06-23: the LXC 100 cron
      already runs `etl.backup` (which uploads to R2), but it was scheduled **weekly**
      (`0 19 * * 6`) and used `source .env`, which silently fails under cron's `/bin/sh`
      — so it had effectively never produced an offsite backup. Fixed to **daily**
      (`0 19 * * *`) + POSIX `. ./.env`. Verified end-to-end: Discord "Backup OK",
      822 MB dump uploaded to `r2://calsight-backups`.
- [x] ~~**Verify R2 actually has backups + isn't accruing cost.**~~ DONE 2026-06-23:
      bucket verified, **$0 billable** (well under the 10 GB free tier). Retention is now
      enforced by a Cloudflare **`delete-after-3-days` lifecycle rule** (server-side),
      not the in-script `rotate_r2_backups()` — so old dumps auto-expire and can't stack
      up. Stale May test files were deleted.
- [~] **Dead-man's-switch / uptime alert — CODE DONE (`4ca0398`), PROD ACTIVATION UNVERIFIED.**
      `send_heartbeat()` is wired into the ETL scheduler daemon (`pipeline.py:193,252,257,261`)
      but is a **no-op unless `HEARTBEAT_URL` is set**, and only fires if the
      `calsight-etl-scheduler` systemd service is actually running and an external monitor
      (healthchecks.io) is configured to alert on silence. The deployed *backup* cron
      (`etl.backup`) does NOT heartbeat. **Verify in prod before trusting this:**
      `grep HEARTBEAT_URL /opt/calsight/backend/.env` + `systemctl status calsight-etl-scheduler`
      + confirm the external monitor pings you on silence.
- [~] **Error monitoring (Sentry) — CODE DONE (`f59d5bc`), PROD ACTIVATION UNVERIFIED.**
      backend + frontend SDKs wired, `send_default_pii=False`, but **no-op unless
      `SENTRY_DSN` (backend) and `VITE_SENTRY_DSN` (frontend, at build time) are set.**
      Verify: `grep SENTRY_DSN /opt/calsight/backend/.env` and check the frontend build env.
- [ ] **ETL data-integrity bugs** *(in #292 — re-verified 2026-06-23):*
  - [x] ~~**Migration advisory lock provides ZERO protection.**~~ FIXED 2026-06-23
        (`0423aa8`): now holds a single connection across acquire → `alembic upgrade` →
        release, so the session-scoped lock actually protects the migration.
  - [x] ~~**Backup rotation can delete ALL backups** if dumps fail 7+ days.~~ FIXED
        2026-06-23: `pipeline.py` run_backup (`0423aa8`) AND the deployed `etl.backup`
        path (`6963d5e`) now both keep the 3 most-recent dumps regardless of age. (The
        prod cron runs `etl.backup`, so the second fix is the one that actually protects
        prod.) Offsite R2 also keeps 3 days via lifecycle rule.
  - [ ] No backup verification — add `pg_restore --list` check after dump (`backup.py`)
  - [ ] No cross-job concurrency guard — APScheduler defaults `max_instances=1` *per job id*,
        so same-job overlap is safe, but daily/weekly/manual runs can still contend on the DB.

## 🔴 Maintenance UX (for server migrations / planned downtime)

- [x] **Maintenance mode — backend DONE** 2026-06-23 (`3d3d743`): `MAINTENANCE_MODE`
      flag + middleware returns `503 + Retry-After` on `/api/*` (health exempt, reports
      `{status: maintenance}`). Middleware sits inside CORS so the 503 is browser-readable.
- [x] **Maintenance mode — frontend screen DONE** 2026-06-23 (`5a0ded7`): `useApiHealth`
      polls `/api/health`; `MaintenanceGate` shows a full-screen auto-retrying overlay on
      `503 maintenance` or sustained unreachable (covers a full box-down migration).

## 🟠 Analytical Credibility (public data tool — trust matters)

- [x] ~~**Lower AI temperature** from 0.7 → 0.3–0.5.~~ DONE 2026-06-23 (`90773cc`):
      default 0.4 via `DEFAULT_TEMPERATURE`, tunable with `LLM_TEMPERATURE`.
- [x] ~~**Causal-claim guardrails** in the system prompt (correlation ≠ causation).~~ DONE
      2026-06-23 (`90773cc`): live-tested — model now hedges + names confounders.
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
- ✅ Dangerous-highways map layer renders (PR #320); `route_number` backfill now auto-runs as a daily ETL job (`etl.extract_route_number` registered in `jobs.py`) — no manual step, populates on deploy. *(2026-06-23)*

---

## Suggested order to the finish line

The 🔴 Reliability tier is code-complete. **Two items (heartbeat, Sentry) are config-gated
and unverified in prod** — run the two grep/`systemctl` checks above to confirm they're
actually active, or they're paper tigers. Everything else in the tier is verified. What's
left beyond that is credibility + a11y + polish; none of it is "breaks on its own."

1. ~~**Verify R2** → wire offsite backup into scheduler.~~ ✅ DONE 2026-06-23 (daily R2 + lifecycle rotation, verified).
2. ~~**Uptime/dead-man's-switch + Sentry.**~~ ✅ DONE.
3. ~~**Maintenance mode.**~~ ✅ DONE.
4. **AI credibility pass** — temperature + guardrails ✅ done; **remaining:** methodology-footer copy + jargon tooltips + percentile context.
5. **WCAG 2.2 AA audit** — batch the #291 items behind one axe/Lighthouse sweep.
6. Test coverage, then reach/polish.

### Small 🔴 leftovers (not blocking, low effort)
- `pg_restore --list` verification after each dump.
- Cross-job DB concurrency guard (daily/weekly/manual contention).
