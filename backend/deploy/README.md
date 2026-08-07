# CalSight deploy notes — ETL scheduling

**The `pipeline` compose service is the scheduler.** Production runs
`python -m etl.pipeline` (APScheduler inside the container) via:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.pipeline.yml up -d
```

See `docker-compose.pipeline.yml` at the repo root for the service
definition and `backend/etl/pipeline.py` for the cron schedules
(daily crashes, weekly full refresh, maintenance, backup).

## Removed legacy schedulers (issue #370)

These files were deleted in July 2026 because they targeted a
`calsight-backend` container name that does not exist under Compose v2
naming, duplicated the pipeline service's job, and ran a divergent
schedule:

- `calsight-etl-scheduler.service` — systemd unit wrapping the deleted
  `etl/scheduler.py` (also removed).
- `setup-etl-cron.sh` — host crontab entry invoking the removed
  `etl.run_all` path.

**Operator action still required on LXC 100** (cannot be verified from
this repo) — **ORDER MATTERS**. The 2026-07-13 incident showed the compose
pipeline container had been crash-looping for weeks while a host-side
runner (systemd/cron, firing 02:00 UTC) was the ONLY thing actually
loading data. Disabling the host runner before the container is verified
healthy would stop all ETL.

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
#    Verified at the box on 2026-07-18: the HOST CRON IS THE LIVE SCHEDULER.
#    The containerized pipeline scheduler is NOT deployed here. Running the
#    commands below today would kill the nightly ETL *and* the nightly
#    backups, silently, on a system nobody is watching.
#
#    See docs/PROJECT_STATE.md and issue #370. These commands are kept only
#    for the future case where the containerized scheduler is actually
#    deployed and proven. Re-verify with step 2 before believing otherwise.
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
