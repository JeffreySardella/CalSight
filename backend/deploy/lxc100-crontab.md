# The live schedulers on LXC 100

Captured from the box on **2026-08-09** via the read-only Pipeline Diagnostics
workflow (`.github/workflows/pipeline-diag.yml`, "Scheduler visibility" step),
which is repeatable — re-run it any time this drifts.

This file exists because the schedule and its wrapper previously lived *only*
on LXC 100 — the one machine a disaster recovery would be rebuilding. See
`docs/RESTORE_RUNBOOK.md` §4f.

---

## There are TWO schedulers, and they split the work

This is the answer to issue **#370**, and it is **not** what the docs
previously said. Both are live:

| What | Where | When (UTC) | Runs |
|---|---|---|---|
| **ETL** | host cron (root) on LXC 100 | `0 2 * * *` | `etl.run_all` inside `calsight-backend-1` |
| **Backup** | `calsight-pipeline-1` container (APScheduler) | `0 7 * * *` | `pipeline.run_backup()` → `etl.backup` |

Prior belief, now corrected: `docs/PROJECT_STATE.md` and issue #370 stated the
host cron was the live ETL **and backup** scheduler and that the containerized
pipeline scheduler "is not deployed here". The container **is** deployed, **is**
running, and **is** the thing that produces the nightly dumps — the host cron
never touches backups (`backup` is not a job in the ETL registry).

Evidence: `calsight-pipeline-1` reports `Up`, its startup banner lists
`backup cron=0 7 * * *`, and `/opt/calsight/backups/` holds
`calsight_<date>.dump` files written at **07:02** daily — matching that job and
matching `etl/backup.py`'s naming exactly.

**Consequence worth knowing:** the heartbeat/exit-code fix shipped in PR #394
(`pipeline.run_backup` failing on an offsite upload error) is in the **live**
backup path, not a dormant one as that PR assumed.

---

## Root crontab

```cron
0 2 * * * /usr/local/bin/run-etl-with-notify.sh
```

That is the **only** crontab on the box — `sysadmin` has none, `/etc/cron.d`
and `/etc/crontab` contain nothing CalSight-related, and there are no systemd
timers for it.

## `/usr/local/bin/run-etl-with-notify.sh`

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

Two helper scripts referenced above also live only on the box and are **not**
captured here: `/usr/local/bin/etl-notify.py` (4,266 bytes) and
`/usr/local/bin/etl-report.py` (3,071 bytes). They are Discord formatting only
— losing them costs notifications, not data.

## Rebuilding this on a fresh host

```bash
mkdir -p /var/log/calsight /opt/calsight/backups
# recreate /usr/local/bin/run-etl-with-notify.sh from the block above (chmod 750, root:root)
# recreate the secrets env file it sources, with DISCORD_WEBHOOK_URL
crontab -e -u root      # add:  0 2 * * * /usr/local/bin/run-etl-with-notify.sh
# bring up the compose stack — the pipeline container restores the BACKUP schedule
docker compose -f docker-compose.pipeline.yml up -d
```

---

## Open thread (not resolved)

Local dumps are `calsight_<date>.dump` written at 07:02 UTC, which matches the
container's backup job. But the **R2 objects are named**
`calsight_<date>_190001.dump.gz` — with a time suffix and gzipped — which
`etl/backup.py` does not produce (`upload_to_r2` uploads under the local
filename unchanged).

So something not yet identified is producing the offsite copies. It is
**working** — the 2026-08-09 R2 object was downloaded and restored
successfully, reconciling exactly against live production (see
`RESTORE_RUNBOOK.md` §5) — but the mechanism is unaccounted for, and until it
is found it cannot be rebuilt from git. Worth one look at the R2 API-token
usage or any process outside cron.
