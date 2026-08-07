# CalSight Database Restore Runbook

**Purpose:** get the production database back after data loss or host failure.

**Status of this document:** the commands below are derived from what
`backend/etl/backup.py` actually does, but **a full restore has never been
performed on this project**. Steps marked `[UNVERIFIED]` could not be proven
without prod access. Run the drill in §5 to turn this from a plan into a
tested procedure.

---

## 1. What you are restoring from

| | |
|---|---|
| Contents | Full `calsight` database, schema + data. **No roles/grants** (`--no-owner --no-acl`), no `pg_dumpall` globals. |
| Format | Custom (`-Fc`), compressed level 6 — supports parallel restore with `pg_restore -j`. |
| Encryption | None. Acceptable: the data is public government records. |
| Local path | `/opt/calsight/backups/calsight_YYYY-MM-DD.dump` on LXC 100 |
| Offsite | Cloudflare R2, bucket `calsight-backups`, key `backups/<filename>` |
| Size | ~822 MB as of 2026-06-23; expect ~1 GB now |
| Postgres version | **17** (server and client) — see `backend/Dockerfile:15` |
| Frequency | Nightly. **RPO ≈ 24 hours.** |

Every dump is verified with `pg_restore --list` before upload; files that fail
are renamed `.corrupt` and never uploaded or counted as a recovery point
(`backend/etl/backup.py`).

**Most data is re-ingestable.** Crashes, weather, demographics and the rest all
come from government sources and can be reloaded by the ETL. The only things
that exist *nowhere else* are `chat_feedback` (user votes on AI answers) and
`etl_runs` history. A total loss is embarrassing, not fatal.

---

## 2. Get a dump

**If LXC 100 is alive:**

```bash
ls -lt /opt/calsight/backups/calsight_*.dump | head
```

**If the box is gone — pull from R2.** Credentials live in the box `.env`; if
that is gone too, mint a new S3 API token in the Cloudflare dashboard
(R2 → Manage R2 API Tokens → Object Read & Write, scoped to the bucket).

```bash
export AWS_ACCESS_KEY_ID=<R2_ACCESS_KEY_ID>
export AWS_SECRET_ACCESS_KEY=<R2_SECRET_ACCESS_KEY>
aws s3 ls s3://calsight-backups/backups/ --endpoint-url https://<account-id>.r2.cloudflarestorage.com
aws s3 cp s3://calsight-backups/backups/calsight_<DATE>.dump . --endpoint-url https://<account-id>.r2.cloudflarestorage.com
```

## 3. Verify before you touch anything

```bash
pg_restore --list calsight_<DATE>.dump > /dev/null && echo TOC-OK
```

If this fails, **stop** and go back for an older dump. Do not drop a live
database to make room for an archive you have not read.

## 4. Restore

### 4a. Existing cluster (DB still there, data bad)

```bash
pg_restore -U calsight -d calsight --clean --if-exists -j 4 calsight_<DATE>.dump
```

### 4b. Fresh cluster (new host)

Roles are **not** in the dump — create them first or the restore emits
thousands of ownership errors.

```bash
psql -U postgres -c "CREATE ROLE calsight LOGIN PASSWORD '<from DATABASE_URL GitHub secret>';"
psql -U postgres -c "CREATE DATABASE calsight OWNER calsight;"
pg_restore -U calsight -d calsight -j 4 calsight_<DATE>.dump
```

`[UNVERIFIED]` No `CREATE EXTENSION` appears to be required — no PostGIS or
other extensions were found in the migrations.

### 4c. MANDATORY — re-apply API grants

Skip this and **every API request fails with a permission error**. The dump
does not contain grants.

```bash
psql -U postgres -d calsight -v ON_ERROR_STOP=1 \
     -v role_password="'<calsight_api_ro password — from box .env, or rotate>'" \
     -f backend/sql/create_readonly_role.sql
```

### 4d. Materialized views

Matviews restore via `REFRESH` entries in the dump. If any come back empty:

```bash
docker compose -f docker-compose.prod.yml exec -T backend python -m etl.refresh_materialized_views
```

### 4e. Sanity check

```bash
psql -d calsight -c "SELECT count(*) FROM crashes;"          # expect ~11.3M
psql -d calsight -c "SELECT matviewname, ispopulated FROM pg_matviews;"
curl http://127.0.0.1:8000/api/health
```

Then load the site and confirm the map renders.

### 4f. `[UNVERIFIED]` Re-create the backup cron

The live crontab line on LXC 100 is **not in version control** — see the
warning in §6. Approximately:

```
0 19 * * * cd /opt/calsight/<path> && . ./.env && python -m etl.backup && curl -fsS $HEARTBEAT_URL
```

Paste the real `crontab -l` output into this document the next time you are on
the box.

---

## 5. The drill: prove the backup works (30 minutes, zero risk to prod)

Run this on any machine with Docker. It restores into a throwaway container
and never touches production.

```bash
docker run -d --name drtest -e POSTGRES_PASSWORD=drtest -p 55432:5432 postgres:17
docker cp calsight_<DATE>.dump drtest:/tmp/
docker exec drtest createdb -U postgres calsight
time docker exec drtest pg_restore -U postgres -d calsight -j 4 /tmp/calsight_<DATE>.dump
docker exec drtest psql -U postgres -d calsight -c \
  "SELECT (SELECT count(*) FROM crashes) AS crashes,
          (SELECT count(*) FROM parties) AS parties,
          (SELECT count(*) FROM victims) AS victims;"
docker exec drtest psql -U postgres -d calsight -c \
  "SELECT matviewname, ispopulated FROM pg_matviews;"
docker rm -f drtest
```

**Pass criteria:** ~11.3M crashes and all matviews `ispopulated = t`.

Write the elapsed `pg_restore` time here — it is your first real RTO number:

> Last drill run: _never_
> Restore time: _unknown_

---

## 6. Known gaps

1. **`[HIGH]` The live backup crontab is not in git.** Schedule, env sourcing
   and heartbeat wiring exist only on LXC 100 — the box you would be
   recovering. One `crontab -l` pasted into §4f closes this.
2. **`[HIGH]` R2 lifecycle rule may delete offsite copies after 3 days.** A
   Cloudflare-side `delete-after-3-days` rule was set 2026-06-23 and
   *overrides* the script's keep-newest-3 guard, which only governs deletions
   the script itself makes. A dump outage longer than 3 days (July's
   crash-loop lasted weeks) would leave **zero** offsite recovery points.
   Fix: remove the rule and let `rotate_r2_backups()` handle retention, or
   extend it to 14+ days.
3. **`[MEDIUM]` Roles and passwords are not backed up.** They live in the box
   `.env` and the `DATABASE_URL` GitHub secret. Losing both means rotating
   passwords during a recovery.
4. **`[MEDIUM]` Single-host SPOF.** LXC 100 holds the DB *and* the local
   backups. What survives a host loss: R2 dumps, the GitHub repo + Actions
   secrets, Cloudflare config, healthchecks.io. The real root of trust is
   **Jeff's Cloudflare and GitHub account access** — protect those above all.
5. **`[LOW]` `docs/OPERATOR_SETUP.md` §3 is stale** — it claims nothing
   uploads to R2. Offsite upload has been live since 2026-06-23.
