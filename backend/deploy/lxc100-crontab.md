# The live schedulers (LXC 100 + VM 101)

Captured 2026-08-09 via the Pipeline Diagnostics workflow, **corrected
2026-09-13** by SSH (`ssh pve` → `pct exec 100`). The earlier capture only saw
the GitHub runner's host and mislabelled it "LXC 100" — see the host map below.

This file exists because these schedules previously lived only on the boxes a
disaster recovery would be rebuilding. See `docs/RESTORE_RUNBOOK.md` §4f.

---

## Host map (this was wrong before 2026-09-13)

| Box | Hostname | IP | Runs |
|---|---|---|---|
| **LXC 100** `calsight-prod-db` | `calsight-prod-db` | 10.27.27.88 | `calsight-db-1` (Postgres 17) + the **R2 offsite backup cron** below |
| **VM 101** `calsight-prod` | `docker-vm` | (Cloudflare tunnel) | GitHub self-hosted runner `calsight-prod`, `calsight-backend-1`, `calsight-pipeline-1`, cloudflared, the 02:00 host ETL cron |

Pipeline Diagnostics (`gh workflow run "Pipeline Diagnostics"`) runs on the
runner, i.e. **VM 101**. It cannot see LXC 100, which is why the R2 uploader
went unidentified for a month. To inspect LXC 100 use `ssh pve` (in
`~/.ssh/config`, key `~/.ssh/homelab`) and `pct exec 100 -- <cmd>`.

## Schedules

| What | Where | When (UTC) | Runs |
|---|---|---|---|
| **Offsite backup → R2** | host cron (root) on **LXC 100** | `0 19 * * *` | `/opt/calsight/backend/etl/backup.py` (the copy in this dir) |
| ETL | host cron (root) on VM 101 | `0 2 * * *` | `run-etl-with-notify.sh` → `etl.run_all` in `calsight-backend-1` |
| Local backup | `calsight-pipeline-1` (APScheduler) on VM 101 | `0 7 * * *` | `pipeline.run_backup()` → `etl.backup` (main's version) |
| ETL (daily) | `calsight-pipeline-1` | `0 11 * * mon-sat` | `pipeline.run_daily_pipeline()` |
| ETL (weekly full) | `calsight-pipeline-1` | `0 9 * * sun` | `pipeline.run_weekly_pipeline()` |
| Vacuum | `calsight-pipeline-1` | `0 15 * * *` | `run_pipeline(only=["vacuum"])` |

The 11:00 container run is the one that actually loads data: CCRS on
data.ca.gov refreshes at ~02:05 UTC, five minutes after the 02:00 host cron.

---

## The R2 uploader (issue #370's last open thread — resolved)

Root crontab on **LXC 100**:

```cron
0 19 * * * cd /opt/calsight/backend && set -a && . ./.env && set +a && /usr/bin/python3 -m etl.backup >> /var/log/calsight-backup.log 2>&1 && curl -fsS https://hc-ping.com/<uuid> >/dev/null 2>&1
```

Facts, verified 2026-09-13:

- `/opt/calsight` on LXC 100 is a git checkout stuck at `c24d2ff` (2026-04-19)
  with `backend/etl/backup.py` **untracked** (`??`) — a 128-line script that is
  **not** the `etl/backup.py` in main. It is saved verbatim as
  **`backend/deploy/lxc100-backup.py`**. It gzips a `pg_dump -Fc` to
  `/var/backups/calsight/calsight_<date>_<HHMMSS>.dump.gz`, uploads it under
  that name to R2, keeps 3 local / 30 in R2 (Cloudflare's 7-day lifecycle rule
  trims R2 first, so `KEEP_R2` never fires), and posts to Discord.
- That is the origin of the `_190001` suffix: cron fires 19:00:00 and the
  timestamp is taken a second later.
- R2 held exactly 7 objects, all `calsight_<date>_1900xx.dump.gz`, sizes
  ~911–935 MB. **The container's 07:00 backup on VM 101 does not reach R2** —
  no `calsight_<date>.dump` objects exist. It is a local-only second copy.
- The healthchecks.io heartbeat (`hc-ping.com/<uuid>`) is the `&& curl` at the
  end of this cron; `HEARTBEAT_URL` on VM 101 is a separate, non-critical ping.
- Env keys the script needs from `/opt/calsight/backend/.env` on LXC 100:
  `DATABASE_URL R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_ENDPOINT_URL
  R2_BUCKET_NAME DISCORD_BACKUP_WEBHOOK` (plus unrelated `CENSUS_API_KEY
  NOAA_API_TOKEN BLS_API_KEY`). Python deps on the host: `boto3`,
  `python-dotenv`; `pg_dump` 17 on PATH.
- `/etc/cron.d` and systemd timers on LXC 100 have nothing CalSight-related.

### LXC 100 compose drift

`/opt/calsight/docker-compose.yml` on LXC 100 is hand-modified (uncommitted).
The DB service diff, needed to rebuild the box identically:

```diff
   db:
-    profiles: ["local-db"]
+    restart: unless-stopped
     image: postgres:17-alpine
     ...
+    shm_size: 8gb
   backend:
+    profiles: ["app"]
+    restart: unless-stopped
+    depends_on:
+      db:
+        condition: service_healthy
   frontend:
+    profiles: ["app"]
+    restart: unless-stopped
```

i.e. LXC 100 runs `docker compose up -d` with only the `db` service active
(backend/frontend gated behind an `app` profile that is never enabled).

---

## VM 101 root crontab

```cron
0 2 * * * /usr/local/bin/run-etl-with-notify.sh
```

`sysadmin` has none; `/etc/cron.d` and `/etc/crontab` contain nothing
CalSight-related; no systemd timers.

## `/usr/local/bin/run-etl-with-notify.sh` (VM 101)

Secrets redacted (`SECRETS_FILE` is an env file that is sourced for
`DISCORD_WEBHOOK_URL`).

```bash
#!/bin/bash
# CalSight ETL – runs pipeline and sends Discord notifications via Python
LOG=/var/log/calsight/etl.log
SECRETS_FILE=<redacted — env file on the box>
NOTIFY=/usr/local/bin/etl-notify.py
[ -f "$SECRETS_FILE" ] && source "$SECRETS_FILE"
WEBHOOK="${DISCORD_WEBHOOK_URL:-}"
START_TIME=$(date '+%Y-%m-%d %H:%M:%S UTC')

notify() {
    [ -n "$WEBHOOK" ] && python3 "$NOTIFY" "$LOG" "$START_TIME" "$1" "$WEBHOOK" "${2:-}" >> "$LOG" 2>&1
}

echo "=== ETL started at $START_TIME ===" >> "$LOG"
notify started

EXIT_CODE=0
docker exec calsight-backend-1 python -m etl.run_all --triggered-by schedule >> "$LOG" 2>&1 || EXIT_CODE=$?

END_TIME=$(date '+%Y-%m-%d %H:%M:%S UTC')
echo "=== ETL finished at $END_TIME (exit: $EXIT_CODE) ===" >> "$LOG"

if [ "$EXIT_CODE" -eq 0 ]; then
    notify completed
else
    notify failed "$EXIT_CODE"
fi

exit $EXIT_CODE
```

Two helper scripts referenced above also live only on VM 101 and are **not**
captured here: `/usr/local/bin/etl-notify.py` (4,266 bytes) and
`/usr/local/bin/etl-report.py` (3,071 bytes). They are Discord formatting only
— losing them costs notifications, not data.

---

## Rebuilding on fresh hosts

**LXC 100 (DB + offsite backup):**

```bash
mkdir -p /var/backups/calsight /opt/calsight
# git clone the repo to /opt/calsight; apply the compose drift above
docker compose up -d db
apt install -y postgresql-client-17 python3-boto3 python3-dotenv
cp backend/deploy/lxc100-backup.py /opt/calsight/backend/etl/backup.py
# create /opt/calsight/backend/.env with the keys listed above
crontab -e -u root   # add the 0 19 * * * line above (new hc-ping UUID if the check was recreated)
```

**VM 101 (runner + app):**

```bash
mkdir -p /var/log/calsight /opt/calsight/backups
# recreate /usr/local/bin/run-etl-with-notify.sh from the block above (chmod 750, root:root)
# recreate the secrets env file it sources, with DISCORD_WEBHOOK_URL
crontab -e -u root      # add:  0 2 * * * /usr/local/bin/run-etl-with-notify.sh
docker compose -f docker-compose.pipeline.yml up -d   # restores the container schedules
# register the GitHub self-hosted runner named calsight-prod (labels: self-hosted,Linux,X64,prod)
```

Neither scheduler is retired: the LXC 100 cron is the only path to R2; the
container is the path that loads data.
