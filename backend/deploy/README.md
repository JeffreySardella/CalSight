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
this repo): confirm the old unit is inert and remove it —

```bash
systemctl status calsight-etl-scheduler   # expect: not-found / inactive
systemctl disable --now calsight-etl-scheduler 2>/dev/null || true
rm -f /etc/systemd/system/calsight-etl-scheduler.service && systemctl daemon-reload
crontab -l | grep -v etl | crontab -      # drop any leftover ETL cron line
```

## Remaining script

- `etl-status.sh` — ad-hoc status check of recent `etl_runs` rows; run it
  on the host with the backend container name as it appears under
  Compose v2 (`docker ps --filter name=backend`).
