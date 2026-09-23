# CalSight deploy notes — ETL scheduling

**Two schedulers are live on VM 101 and both stay** — the full picture,
captured from the box, is in `lxc100-crontab.md`. The `pipeline` compose
service runs `python -m etl.pipeline` (APScheduler inside the container) via:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.pipeline.yml up -d
```

See `docker-compose.pipeline.yml` at the repo root for the service
definition and `backend/etl/pipeline.py` for the cron schedules
(daily crashes, weekly full refresh, maintenance, backup).

## Legacy scheduler files (issue #370)

The *repo copies* of the older schedulers were removed in July 2026:
`calsight-etl-scheduler.service` (systemd unit wrapping the deleted
`etl/scheduler.py`) and `setup-etl-cron.sh`. The **host cron on VM 101
itself remains live** and is wanted: root's `0 2 * * *` runs
`run-etl-with-notify.sh` → `etl.run_all` inside `calsight-backend-1`, while
the `calsight-pipeline-1` container runs the backup (07:00 UTC), the daily
ETL (11:00 Mon–Sat), the weekly refresh (Sun 09:00) and VACUUM (15:00).
#370 is answered by `lxc100-crontab.md`; neither scheduler is to be retired.

The 2026-07-13 incident (pipeline container crash-looping for weeks while
the host cron was the only thing loading data) is why the checks below
exist — **ORDER MATTERS** if anyone ever does revisit this.

```bash
# 1. FIRST verify the compose scheduler is genuinely alive:
docker ps --filter name=pipeline          # expect: Up (not Restarting)
docker inspect calsight-pipeline-1 --format '{{.State.Status}} restarts={{.RestartCount}}'
docker logs --tail 30 calsight-pipeline-1 # expect the "Schedules:" banner, no traceback

# 2. Identify what actually fires the 02:00 UTC nightly (issue #370):
systemctl cat calsight-etl-scheduler 2>/dev/null || echo "no such unit"
crontab -l | grep -i -e etl -e calsight

# 3. !!! DO NOT RUN ON THE CURRENT DEPLOYMENT !!!
#
#    Both schedulers are live and both are wanted (lxc100-crontab.md,
#    2026-08-09, corrected 2026-09-13). The host cron runs the ETL; the
#    container runs the ETL *and* the backups. Running the commands below
#    would silently drop one of the two runs on a system nobody is watching.
#
#    Kept only for the future case where a single scheduler is deliberately
#    chosen. Re-verify with step 2 before believing otherwise.
#
#    ONLY after step 1 shows a stable CONTAINER scheduler AND at least one
#    container-scheduled run has landed in etl_runs (daily fires 11:00 UTC),
#    retire the host runner:
# systemctl disable --now calsight-etl-scheduler 2>/dev/null || true
# rm -f /etc/systemd/system/calsight-etl-scheduler.service && systemctl daemon-reload
# crontab -l | grep -v etl | crontab -    # drop any leftover ETL cron line
```

## Remaining script

- `etl-status.sh` — ad-hoc status check of recent `etl_runs` rows; run it
  on the host with the backend container name as it appears under
  Compose v2 (`docker ps --filter name=backend`).
