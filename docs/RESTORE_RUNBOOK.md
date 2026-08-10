# CalSight Database Restore Runbook

**Purpose:** get the production database back after data loss or host failure.

**Status of this document:** the restore path is **PROVEN**. On 2026-08-09 the
offsite R2 copy was restored end-to-end into a scratch Postgres 17 and
reconciled exactly against live production — see §5 for the measured RTO and
full results. Steps still marked `[UNVERIFIED]` are the ones the drill could
not exercise (they need the real host), and are called out individually.

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

### 4f. Re-create the schedulers

**Captured from the box 2026-08-09** — full detail, including the wrapper
script and rebuild steps, is in **`backend/deploy/lxc100-crontab.md`**.

There are **two** schedulers, and they split the work:

```
# ETL — host cron (root) on LXC 100
0 2 * * * /usr/local/bin/run-etl-with-notify.sh

# BACKUP — the calsight-pipeline-1 container's own APScheduler (0 7 * * *).
# Restored simply by bringing the stack up:
docker compose -f docker-compose.pipeline.yml up -d
```

The earlier guess here (`0 19 * * * … python -m etl.backup && curl $HEARTBEAT_URL`)
was wrong on every count — wrong time, wrong invoker, and the host cron never
touches backups at all.

---

## 5. The drill: prove the backup works (~10 minutes, zero risk to prod)

> ## ✅ PASSED — 2026-08-09
> **Restore time: 3 minutes 18 seconds** (`pg_restore -j 4`, exit 0, **zero errors**).
> Source: `calsight_2026-08-09_190001.dump.gz` pulled **from R2** — deliberately
> the offsite copy, so this also proved the copy that survives losing the box.
>
> | Check | Result |
> |---|---|
> | Archive TOC (`pg_restore --list`) | OK — 418 entries, 32 tables |
> | crashes | **11,344,536** — exact match with live |
> | killed / injured | **92,176 / 6,375,153** — exact match with live |
> | crash_parties / crash_victims | 9,067,452 / 5,464,114 |
> | Materialized views | **9 of 9 populated**, incl. `mv_street_aggregates` |
> | Indexes / FK constraints | 138 / 24 |
> | Analytical query on restored DB | ran correctly (2022: 405,246 crashes, 4,661 killed) |
>
> **The RTO is no longer a guess.** Restoring the data takes ~3.5 minutes on a
> laptop. Add the R2 download (~1 GB) and step 4c's grant re-apply and a
> same-host recovery is realistically well under 30 minutes.

Run this on any machine with Docker. It restores into a throwaway container
and never touches production.

```bash
# Dump from R2 arrives gzipped. NOTE: the .gz saves almost nothing —
# pg_dump custom format is already compressed (948.0MB -> 948.1MB).
gunzip -k calsight_<DATE>.dump.gz

docker run -d --name drtest -e POSTGRES_PASSWORD=drtest -p 55432:5432 postgres:17
docker cp calsight_<DATE>.dump drtest:/tmp/

# Verify the archive BEFORE trusting it.
docker exec drtest pg_restore --list /tmp/calsight_<DATE>.dump > /dev/null && echo TOC-OK

docker exec drtest psql -U postgres -c "CREATE ROLE calsight LOGIN PASSWORD 'drtest';"
docker exec drtest createdb -U postgres -O calsight calsight
time docker exec drtest pg_restore -U postgres -d calsight -j 4 \
  --no-owner --no-acl /tmp/calsight_<DATE>.dump

docker exec drtest psql -U postgres -d calsight -c \
  "SELECT (SELECT count(*) FROM crashes)       AS crashes,
          (SELECT count(*) FROM crash_parties) AS parties,
          (SELECT count(*) FROM crash_victims) AS victims;"
docker exec drtest psql -U postgres -d calsight -c \
  "SELECT matviewname, ispopulated FROM pg_matviews;"

docker rm -f drtest && rm -f calsight_<DATE>.dump*
```

**Pass criteria:** ~11.3M crashes and all matviews `ispopulated = t`.

Gotchas worth knowing before you repeat this:
- On **Git Bash / MSYS**, container paths get rewritten into Windows paths and
  `pg_restore` reports "could not open input file C:/Users/...". Prefix the
  command with `MSYS_NO_PATHCONV=1`.
- The table names are `crash_parties` / `crash_victims`, not `parties` /
  `victims`.
- `--no-owner --no-acl` avoids noisy role errors in a scratch container. On a
  **real** recovery, follow §4b/§4c instead — the roles and grants matter there.

> Last drill run: **2026-08-09 — PASSED**
> Restore time: **3m 18s** (data only; see the table above)

---

## 6. Known gaps

1. ~~**`[HIGH]` The live backup crontab is not in git.**~~ **RESOLVED
   2026-08-09** — captured to `backend/deploy/lxc100-crontab.md`, including the
   `run-etl-with-notify.sh` wrapper and rebuild steps. It also corrected the
   record: there are **two** schedulers — the host cron runs the ETL (02:00
   UTC), and the `calsight-pipeline-1` container runs the **backup** (07:00
   UTC). One residual unknown is documented there: the R2 objects are named
   `calsight_<date>_190001.dump.gz`, which `etl/backup.py` does not produce, so
   the offsite uploader is still unidentified (it works — the drill in §5
   restored one — but it cannot yet be rebuilt from git).
2. ~~**`[HIGH]` R2 lifecycle rule may delete offsite copies after 3 days.**~~
   **RESOLVED 2026-08-09** — the rule was real and biting: the bucket held
   exactly three objects (08-07/08/09), so a four-day dump outage would have
   left **zero** offsite recovery points. Now `delete-after-7-days`, which
   deliberately matches `RETENTION_DAYS = 7` in `etl/backup.py` so the rule and
   the code agree instead of fighting. Kept as a lifecycle rule rather than
   deleted so a storage ceiling remains.

   Sizing, measured 2026-08-09: each dump is ~948 MB and grows ~0.1 MB/day
   (947.88 -> 948.02 -> 948.02 MB on consecutive nights), so 7 copies is
   ~6.6 GB against R2's 10 GB free tier — roughly 3.4 GB of headroom, and it
   stays that way for years at this growth rate. 14 days would have been
   ~13.3 GB, i.e. over the free tier for about 5 cents a month.

3. **`[MEDIUM]` Roles and passwords are not backed up.** They live in the box
   `.env` and the `DATABASE_URL` GitHub secret. Losing both means rotating
   passwords during a recovery.
4. **`[MEDIUM]` Single-host SPOF.** LXC 100 holds the DB *and* the local
   backups. What survives a host loss: R2 dumps, the GitHub repo + Actions
   secrets, Cloudflare config, healthchecks.io. The real root of trust is
   **Jeff's Cloudflare and GitHub account access** — protect those above all.
