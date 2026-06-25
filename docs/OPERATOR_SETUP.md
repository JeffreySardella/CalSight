# CalSight — Operator Setup (server-side tasks)

> Things **you** do on the infrastructure that the code can't do for itself:
> provision external services and set env vars. Everything here is gated so the
> app runs fine with these unset — turning each on activates the feature.
>
> Architecture recap:
> - **LXC 100** (`10.27.27.88`) — prod DB + self-hosted runner + ETL pipeline
>   (APScheduler, daily ~11:00 UTC). This is where backups + heartbeat run.
> - **VM 101** (`10.27.27.120`) — API backend (uvicorn/gunicorn) + cloudflared tunnel.
> - **Frontend** — static, on Cloudflare Pages (stays up even when the API is down).

---

## 1. Sentry — error monitoring  *(code done, needs DSNs)*

1. Create a Sentry org, then **two projects**: one **Python** (backend), one **React** (frontend).
2. Copy each project's DSN.
3. Set env vars:
   - **Backend (VM 101 `.env`):** `SENTRY_DSN=<python-dsn>`, `SENTRY_ENVIRONMENT=production`
   - **Frontend (Cloudflare Pages → Settings → Environment variables):** `VITE_SENTRY_DSN=<react-dsn>` — then **redeploy** the Pages project (Vite bakes env vars in at build time).
4. *(Optional, for readable stack traces)* add source-map upload: `npm i -D @sentry/vite-plugin`, add `sentryVitePlugin` to `vite.config.ts`, and set `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` in the Pages build env.

## 2. Dead-man's-switch heartbeat  *(code done, needs a check)*

1. Create a free [healthchecks.io](https://healthchecks.io) check. Schedule: **daily**, grace period **2h** (the backup runs ~once/day).
2. Copy the ping URL.
3. Set on the **ETL host (LXC 100)** env: `HEARTBEAT_URL=https://hc-ping.com/<uuid>`
4. After the next backup, the check should go green. If the box dies or the backup stops, healthchecks emails/pings you. Add a notification channel (email/Discord) in healthchecks.

## 3. Cloudflare R2 — offsite backup  *(verify first; code wiring pending)*

**First, the cost check you wanted:**
- Cloudflare dashboard → **R2** → is there a `calsight-backups` bucket? Does it have objects + what's the total size? (R2 free tier = 10 GB; you're almost certainly not being charged, because nothing is uploading yet — see the gap below.)

**The gap:** the scheduled backup (`etl/pipeline.py` `run_backup`) writes **local only**. The R2 upload code in `etl/backup.py` is never called by the scheduler, so there is likely **no offsite copy** today.

**To enable offsite backups:**
1. R2 → Create bucket `calsight-backups`.
2. R2 → Manage API Tokens → Create (Object Read & Write, scoped to that bucket).
3. Set on the **ETL host (LXC 100)** env:
   ```
   R2_ACCESS_KEY_ID=...
   R2_SECRET_ACCESS_KEY=...
   R2_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com
   R2_BUCKET_NAME=calsight-backups
   ```
4. Test: `python -m etl.backup --upload-only`
5. **(Code task — I'll do this)** wire `upload_to_r2()` + `rotate_r2_backups()` into the scheduled `run_backup` so daily backups go offsite automatically.

## 4. Public-URL uptime monitor  *(API/tunnel down detection)*

The heartbeat covers the ETL box. Add a separate monitor for the **public site/API** so you're alerted if the tunnel or backend drops:
- healthchecks.io won't poll; use [UptimeRobot](https://uptimerobot.com) (free) or a healthchecks.io "API check" against `https://<your-domain>/api/health`. Expect HTTP 200 `{"status":"ok"}`; alert on non-200 or timeout.

## 5. Maintenance mode  *(backend code done; see below)*

For a planned server/DB migration, take the app offline gracefully:
- Set `MAINTENANCE_MODE=true` on the **backend (VM 101)** env and restart the API. All `/api/*` calls return `503 + Retry-After`; `/api/health` reports `{"status":"maintenance"}`.
- The frontend (static, still up) will show a maintenance screen *(frontend piece pending — next code task)*.
- Unset / `MAINTENANCE_MODE=false` and restart when done.

## 6. Backup scheduling sanity check

Confirm how backups actually run on LXC 100:
- The APScheduler pipeline (`python -m etl.pipeline`) schedules `run_backup` internally — **if that long-running process is up**, backups happen.
- The older `docs/PRODUCTION_CHECKLIST.md:203` note expects an **external cron** running `python -m etl.backup`. Run `crontab -l` to see which path is actually live, and make sure exactly one of them runs (so you don't double-dump or, worse, neither).

---

## Quick env-var reference by host

| Host | Vars |
|------|------|
| **Backend API (VM 101)** | `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `MAINTENANCE_MODE` |
| **ETL (LXC 100)** | `HEARTBEAT_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT_URL`, `R2_BUCKET_NAME`, `ALERT_WEBHOOK_URL` |
| **Frontend (Cloudflare Pages)** | `VITE_SENTRY_DSN`, `VITE_API_BASE_URL` (+ optional `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT`) |
