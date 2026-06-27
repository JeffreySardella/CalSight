# Design: "Data rebuilding" soft-degraded state

**Date:** 2026-06-26
**Status:** Approved (pending spec review)

## Problem

CalSight auto-deploys from `main`. When a deploy includes a migration that
recreates a materialized view (e.g. `mv_crashes_wide`, recreated `WITH NO DATA`),
the view is empty from the moment the migration runs until the pipeline's
"Refresh materialized views" step finishes populating it. On a large MV this
window can be ~15–20 minutes.

During that window the site stays up (the static frontend and the un-recreated
MVs keep serving), but any query backed by the empty MV — involvement filters,
condition `group_by` — returns zeros with no explanation. A user landing on an
involvement-filtered view mid-deploy sees silently wrong/empty data.

We want a **non-blocking** signal: keep the site fully usable, but show a slim
banner telling the user some data is temporarily being rebuilt and may be
incomplete. It must require no operator action (can't be forgotten) and must
clear itself automatically when the rebuild finishes.

## Non-goals (YAGNI)

- No new env flag or operator toggle — detection is automatic.
- No dismiss button — the bar is unobtrusive and self-resolving.
- No per-chart inline "rebuilding" notes — a single global bar is enough.
- No new DB columns or tables.
- Does not replace or change the existing full-screen maintenance/down gate.

## Approach

Detect the rebuild from Postgres catalog state rather than from ETL bookkeeping.

`pg_class.relispopulated` is `false` for a materialized view created/recreated
`WITH NO DATA` and becomes `true` once it has been populated. A normal nightly
refresh uses `REFRESH MATERIALIZED VIEW CONCURRENTLY`, which keeps the view
populated throughout — so `relispopulated` stays `true` and the banner never
fires for routine refreshes. It flips to `false` **only** during the initial
(non-concurrent) population after a recreate, which is exactly the deploy
scenario we care about.

Alternative considered: query `etl_runs` for an in-progress `matviews` run.
Rejected — it depends on run-tracking perfectly bracketing the populate, adds a
join, and wouldn't catch a refresh that died and left a view unpopulated. The
catalog check is simpler, has no extra state, and tracks true table availability.

## Components

### Backend — `/api/health`

Add a third, non-blocking state. Priority order in the `health()` handler:

1. `settings.maintenance_mode` → `503 {status:"maintenance"}` *(unchanged)*
2. any key MV unpopulated → `200 {status:"rebuilding"}` *(new)*
3. otherwise → `200 {status:"ok"}` *(unchanged response shape)*

Returned with **HTTP 200**, not 503: the service is up and only data is
degraded, so external uptime monitors must stay green. The frontend
distinguishes the state via the response body, not the status code.

Detection helper — its own function so it is unit-testable:

```sql
SELECT bool_and(relispopulated) FROM pg_class
WHERE relname = ANY(:mv_names)
```

`:mv_names` is the same list `etl/refresh_materialized_views.py` refreshes
(`_VIEWS`). If `bool_and` is `false`, at least one MV is unpopulated →
`rebuilding`. The whole call is wrapped in try/except; on any catalog error it
falls back to `ok` so the health endpoint can never break itself. A single
catalog scan is cheap enough for the existing poll cadence; no caching needed.

Reusing the `_VIEWS` list means **any** future MV-recreating migration is
covered automatically, and a refresh that fails and leaves a view unpopulated
keeps the banner up — surfacing a stuck rebuild instead of silently serving
zeros.

### Frontend — non-blocking banner

- `hooks/useApiHealth.ts`: add `"rebuilding"` to the `ApiHealth` union. A `200`
  response whose body is `{status:"rebuilding"}` maps to `"rebuilding"`; the
  existing `ok` / `maintenance` / `down` logic is unchanged. Keep the faster
  10s poll while `rebuilding` so the bar clears promptly once the rebuild ends.
- New `components/RebuildingBanner.tsx`: a slim fixed bar pinned to the top,
  `role="status"` with `aria-live="polite"` (non-urgent), message:
  *"Some data is being rebuilt and may be temporarily incomplete."* Renders only
  when `health === "rebuilding"`, otherwise returns `null` → auto-clears.
- `MaintenanceGate.tsx` is untouched; its full-screen overlay still handles
  `maintenance` and `down`. The two are mutually exclusive states, so the
  blocking overlay and the non-blocking bar never show together.

## Data flow

```
deploy: migration recreates mv_crashes_wide WITH NO DATA
  -> pg_class.relispopulated = false
GET /api/health  (frontend polls every 10s while non-ok, else 45s)
  -> backend: bool_and(relispopulated) = false  -> 200 {status:"rebuilding"}
  -> useApiHealth returns "rebuilding"
  -> RebuildingBanner renders the top bar; rest of app usable
pipeline "Refresh materialized views" finishes populate
  -> relispopulated = true
  -> next poll: 200 {status:"ok"}  -> banner returns null (auto-clear)
```

## Error handling

- Catalog query throws → treat as `ok` (never block or false-alarm on a health
  query failure).
- `maintenance_mode` always takes precedence over `rebuilding`.
- Single dropped health request does not flip state (existing retry logic in
  `useApiHealth` is unchanged).

## Testing

**Backend (integration + unit):**
- Detection helper returns `True` when a MV is unpopulated, `False` when all are
  populated (direct unit test against the catalog).
- `/api/health` returns `200 {status:"rebuilding"}` when a view is recreated
  `WITH NO DATA` in the test; returns `ok` when all populated.
- `maintenance_mode` still returns `503 {status:"maintenance"}` and wins over a
  simultaneously-unpopulated MV.

**Frontend:**
- `useApiHealth` maps a `200 {status:"rebuilding"}` body to `"rebuilding"`.
- `RebuildingBanner` renders the bar for `"rebuilding"` and renders nothing for
  `"ok"`.

## Files touched

- `backend/app/main.py` — health handler branch + detection helper (or a small
  `app/health.py` if cleaner).
- `backend/tests/test_maintenance.py` (or a new test module) — backend tests.
- `frontend/src/hooks/useApiHealth.ts` — new union member + body mapping.
- `frontend/src/components/RebuildingBanner.tsx` — new component.
- `frontend/src/components/RebuildingBanner.test.tsx` — new test.
- `frontend/src/App.tsx` — mount `RebuildingBanner` alongside `MaintenanceGate`.
