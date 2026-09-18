# KSI Series Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or superpowers:executing-plans to carry out this plan. Steps are checkboxes (`- [ ]`); tick each one as it is done, and do not skip the "run it, watch it fail" steps.

**Goal:** Add a per-crash count of seriously injured people (`crashes.number_severe_injured`), fill it for SWITRS 2001–2015 and CCRS 2016+, expose `total_severe_injured` through `/api/stats`, and turn the Stats hero tile back into a true KSI rate (killed + seriously injured people per 100K). The dashboard year chart also gets a `ksi` measure with a definition footnote.

**Architecture:** One migration adds the column (metadata-only, in an autocommit block) and swaps rebuilt copies of `mv_crashes_by_year`, `mv_crashes_by_cause` and `mv_crashes_wide` into place, so there is no empty-view window. `mv_crash_rates` is recreated with its definition unchanged.

CCRS values are derived nightly in `etl/backfill_derived.py` from `crash_victims` (`SuspectSerious` + `SevereInactive`). SWITRS values come from a one-off job, `etl/backfill_switrs_ksi.py`, that reads `collisions.severe_injury_count` from the Zenodo archive and matches rows on the loader's folded IDs.

The API change is additive: a new field on the year, county, cause, severity and grand-total rows. The frontend reads `total_killed + total_severe_injured`, excludes the partial current year, and fills population for years without census data from the nearest census year (`fillDemographicYears` plus `/api/demographics?nearest=true`, the map's approach).

**Tech Stack:**
- Backend: PostgreSQL 17, Alembic, SQLAlchemy 2.0 (`psycopg2`), FastAPI, pytest.
- Frontend: React + TypeScript, TanStack Query, Vitest, Playwright.
- Deploy: GitHub Actions (`deploy.yml`, `Run ETL Job`).

**Spec:** `docs/superpowers/specs/2026-09-18-ksi-series-design.md`. Where they differ, the owner decisions override the spec:
- footnote only, naming both boundaries;
- nearest-census denominator plus an "estimated" note;
- no KSI on `mv_crash_rates`;
- the partial year is excluded everywhere.

## Global Constraints

- NO `Co-Authored-By`, "Generated with", or any AI attribution in commit messages or PR descriptions. This is an explicit owner rule and it overrides any tool default.
- Backend `.py` files (and most repo text files) are CRLF in the working tree (`core.autocrlf=true`). Preserve CRLF when editing, and write new files with CRLF. Check with `file <path>`, which should report "with CRLF line terminators".
- After adding the migration, run `./.venv/Scripts/python.exe -m pytest tests/test_migration_graph.py -q`. Revision-ID collisions have bitten this project three times, and Alembic misreports them as cycles. Generate the revision ID with `alembic revision`; never invent one.
- Every push to `main` deploys and recreates the containers. Batch edits: each rollout step is exactly one PR, squash-merged.
- Backend tests are run from `backend/`:
  - Unit tests: `./.venv/Scripts/python.exe -m pytest -m "not integration" -q`.
  - Integration tests need local Postgres. From the repo root, run `docker compose --profile local-db up -d db` (port 5433). Then, from `backend/`, run with the test DB forced for BOTH URLs, because `migrations/env.py` migrates `settings.effective_etl_database_url` and `backend/.env` may set `ETL_DATABASE_URL`: `DATABASE_URL=postgresql://calsight:calsight_dev@localhost:5433/calsight_test ETL_DATABASE_URL=postgresql://calsight:calsight_dev@localhost:5433/calsight_test DATABASE_URL_AZURE= ETL_DATABASE_URL_AZURE= ./.venv/Scripts/python.exe -m pytest -m integration -q`. The rest of this plan calls that env prefix `TESTDB`. CI runs the integration suite too.
- Lint the backend with `./.venv/Scripts/python.exe -m ruff check .`.
- Frontend checks are run from `frontend/`: `npx tsc -b`, `npx eslint <files>`, `npx vitest run`.
- The Material icon font is subset, so any new icon must already be in the `index.html` `icon_names` list (checked by `iconSubset.test.ts`). This plan adds no icons.
- Do a real-browser pass before merging any UI change.
- Manual ETL runs use `gh workflow run "Run ETL Job" -f job=<module without etl.> -f args="..." -f refresh_matviews=true|false`. The workflow's concurrency group allows only one pending run, so dispatch the next run only after the previous one has finished.
- After ETL changes, verify API numbers with a cache-buster query parameter (`&_cb=$(date +%s)`), because Cloudflare caches API GETs for about 1h.
- Prod access is read-only diagnostics only (`ssh pve` then `pct exec 100 -- ...`). Never change roles, ACLs or other access controls by hand.
- Site copy describes associations, not causes, and makes no causal claims.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `backend/app/models.py` | Modify | `Crash.number_severe_injured` column; fix the stale `CrashVictim.injury_severity` comment (line 280) |
| `backend/migrations/versions/<rev>_add_ksi_severe_injured.py` | Create | Column add (autocommit + lock_timeout) and the build/swap of the three stats matviews; recreate `mv_crash_rates`; guarded grants; real `downgrade()` |
| `backend/etl/backfill_derived.py` | Modify | `SERIOUS_INJURY_CODES`, `backfill_severe_injured(db, since_year)`, wired into `run()` |
| `backend/etl/jobs.py` | Modify | `backfill` job waits for `victims` |
| `backend/etl/backfill_switrs_ksi.py` | Create | One-off SWITRS 2001–2015 backfill from the Zenodo archive |
| `backend/etl/validation.py` | Modify | `check_severe_injured_coverage`, added to `run_crash_validations` |
| `backend/app/schemas/stats.py` | Modify | `total_severe_injured: int = 0` on `GrandTotal`, `CountyRow`, `YearRow`, `CauseRow`, `SeverityRow` |
| `backend/app/routers/stats.py` | Modify | Column on `mv_year`/`mv_cause`/`mv_wide`; selected on the grand-total, county, year, cause and severity paths (MV and wide) |
| `backend/tests/test_models.py` | Modify | Column exists and is not in `_UPSERT_COLUMNS` |
| `backend/tests/test_backfill_derived.py` | Modify | SQL shape and scoping of `backfill_severe_injured` |
| `backend/tests/api/test_backfill_severe_injured.py` | Create | Real-Postgres behaviour of the CCRS derivation |
| `backend/tests/test_orchestrator.py` | Modify | `victims` runs before `backfill` |
| `backend/tests/test_backfill_switrs_ksi.py` | Create | SQLite reading, ID folding, clamping, failure rule |
| `backend/tests/api/test_backfill_switrs_ksi_db.py` | Create | Real-Postgres UPDATE targets the folded ID, SWITRS only, idempotent |
| `backend/tests/test_validation_severe.py` | Create | Coverage check |
| `backend/tests/api/test_stats_ksi.py` | Create | `total_severe_injured` summed on `mv_year`, `mv_cause`, `mv_wide` and batch |
| `backend/DATA_DICTIONARY.md` | Modify | New column; real `injury_severity` values (line 142); matview columns |
| `docs/DATA_METHODOLOGY.md` | Modify | §5.6 KSI definition (the asterisk text); §7.2 bullet |
| `frontend/src/lib/ksi.ts` | Create | `KSI_DEFINITION` (the one shared asterisk text) and `ksiDefinitionNote(labels)` |
| `frontend/src/lib/ksi.test.ts` | Create | Footnote boundary rules |
| `frontend/src/components/ui/JargonTerm.tsx` | Modify | KSI glossary entry becomes `KSI_DEFINITION` (it counts people, not crashes) |
| `frontend/src/types/api.ts` | Modify | `StatsMeasures.total_severe_injured` |
| `frontend/src/lib/dashboard/types.ts` | Modify | `"ksi"` in `MEASURES` and `MEASURE_LABELS` |
| `frontend/src/lib/dashboard/anomaly.ts` | Modify | `MEASURE_NOUNS.ksi` |
| `frontend/src/hooks/useDashboardData.ts` | Modify | `pickValue` for `ksi` |
| `frontend/src/hooks/useDashboardData.test.tsx` | Modify | `year:ksi` values |
| `frontend/src/components/stats/ChartConfigPanel.tsx` | Modify | Offer `ksi` only on the `year` dimension |
| `frontend/src/components/stats/ChartConfigPanel.test.tsx` | Create | Year-only option |
| `frontend/src/lib/dashboard/nlqParser.ts` | Modify | KSI synonyms; `resolveNlq` falls back to `killed` off the year axis |
| `frontend/src/lib/dashboard/nlqParser.test.ts` | Modify | Synonym tests |
| `frontend/src/components/stats/ChartCard.tsx` | Modify | KSI definition footnote next to `partialYearNote` |
| `frontend/src/components/stats/ChartCard.partialYear.test.tsx` | Modify | Footnote appears only on KSI year charts that cross a boundary |
| `frontend/src/hooks/useStats.ts` | Modify | True KSI hero rate, partial year excluded, nearest-census denominator, `ksiPopEstimatedFrom` |
| `frontend/src/hooks/useStats.test.tsx` | Modify | Hero tests for the new rules |
| `frontend/src/pages/StatsPage.tsx` | Modify | KSI tile label, tooltip, sparkline, estimate note |
| `frontend/src/components/seo/JsonLd.tsx` | Modify | Line 98 variable name |
| `frontend/tests/dashboard-full.spec.ts` | Modify | Hero tile locator |

---

# Rollout step 1: PR A (backend only), branch `feat/ksi-backend`

- [ ] **Pre-step:** from the repo root, run `git checkout main && git pull && git checkout -b feat/ksi-backend`.

## Task A1: `Crash.number_severe_injured` model column

**Files:**
- Modify: `backend/app/models.py:97-98` (after `number_injured`), `backend/app/models.py:280` (the `injury_severity` comment)
- Test: `backend/tests/test_models.py`

**Interfaces:**
- Produces: `Crash.number_severe_injured: Column(SmallInteger, nullable=False, default=0, server_default="0")`. Deliberately NOT in `etl.load_crashes._UPSERT_COLUMNS`.

- [ ] **Step 1: Write the failing test.** Append to `backend/tests/test_models.py`:

```python
class TestCrashSevereInjured:
    def test_column_exists_and_defaults_to_zero(self):
        from app.models import Crash

        col = Crash.__table__.columns["number_severe_injured"]
        assert col.nullable is False
        assert str(col.server_default.arg) == "0"

    def test_loader_upsert_never_overwrites_it(self):
        # Backfills own this column; a daily CCRS re-upsert must not reset it to 0.
        from etl.load_crashes import _UPSERT_COLUMNS

        assert "number_severe_injured" not in _UPSERT_COLUMNS
```

- [ ] **Step 2: Run the test.** `./.venv/Scripts/python.exe -m pytest tests/test_models.py -q -k SevereInjured`. Expected: FAIL with `KeyError: 'number_severe_injured'`.

- [ ] **Step 3: Implement.** In `backend/app/models.py`, replace

```python
    number_killed = Column(SmallInteger, default=0)
    number_injured = Column(SmallInteger, default=0)
```

with

```python
    number_killed = Column(SmallInteger, default=0)
    number_injured = Column(SmallInteger, default=0)
    # People seriously injured (the "SI" in KSI). SWITRS 2001-2015: the
    # archive's severe_injury_count, via the one-off etl/backfill_switrs_ksi.py.
    # CCRS 2016+: victims coded SuspectSerious or SevereInactive, via
    # etl/backfill_derived.backfill_severe_injured (nightly). Kept out of
    # load_crashes._UPSERT_COLUMNS on purpose so a reload never resets it.
    number_severe_injured = Column(SmallInteger, nullable=False, default=0, server_default="0")
```

Then replace

```python
    injury_severity = Column(String(50))   # Fatal, Severe, Possible, etc.
```

with

```python
    injury_severity = Column(String(50))   # Fatal, SuspectSerious, SevereInactive, SuspectMinor, PossibleInjury, OtherVisibleInactive, ComplaintOfPainInactive, or NULL
```

- [ ] **Step 4: Run the tests.** `./.venv/Scripts/python.exe -m pytest tests/test_models.py -q`. Expected: all pass.

- [ ] **Step 5: Commit.**

```bash
git add backend/app/models.py backend/tests/test_models.py
git commit -m "feat(ksi): add Crash.number_severe_injured model column"
```

## Task A2: Migration (column + matview swap)

**Files:**
- Create: `backend/migrations/versions/<rev>_add_ksi_severe_injured.py`. `<rev>` is the ID that `alembic revision` prints. It is the one value in this plan that cannot be written down in advance, so keep exactly what Alembic generates.
- Test: `backend/tests/test_migration_graph.py` (existing) and `backend/scripts/check_migration_expand_contract.py` (existing).

**Interfaces:**
- Consumes: `down_revision = "77b8d6739669"` (the current single head, `add_mv_street_totals`).
- Produces:
  - `crashes.number_severe_injured smallint NOT NULL DEFAULT 0`.
  - `mv_crashes_by_year.total_severe_injured integer`.
  - `mv_crashes_by_cause.total_severe_injured integer`.
  - `mv_crashes_wide.total_severe_injured bigint` (matching the wide view's un-cast sums).
  - Index names identical to prod: `ix_mv_crashes_by_year_pk`, `ix_mv_crashes_by_year_county`, `ix_mv_crashes_by_cause_pk`, `ix_mv_crashes_by_cause_county_year`, `ix_mv_crashes_wide_pk`, `ix_mv_crash_rates_pk`, `ix_mv_crash_rates_year_severity`.

- [ ] **Step 1: Generate the revision file.** From `backend/`, run `./.venv/Scripts/python.exe -m alembic revision -m "add ksi severe injured"`. Expected output: `Generating ...\migrations\versions\<rev>_add_ksi_severe_injured.py ... done`. This command does not touch any database. Note the `<rev>` it printed.

- [ ] **Step 2: Watch the test fail first.** Point the new file's `down_revision` at a nonexistent ID: temporarily edit `down_revision` to `"doesnotexist"`, then run `./.venv/Scripts/python.exe -m pytest tests/test_migration_graph.py -q`. Expected: FAIL in `test_every_down_revision_exists`, naming `('<rev>_add_ksi_severe_injured.py', 'doesnotexist')`. This proves the graph test sees the new file.

- [ ] **Step 3: Implement.** Replace the whole file with the content below. Keep the generated `revision` value and `Create Date` line. Replace only the two `<rev>` / `<generated>` tokens with what Alembic wrote.

```python
"""add crashes.number_severe_injured and total_severe_injured on the stats matviews

KSI = people killed or seriously injured. This adds the per-crash seriously
injured count and carries it into the three matviews /api/stats reads for
year, county, cause, severity and grand totals.

1. crashes.number_severe_injured SMALLINT NOT NULL DEFAULT 0. A constant
   default is metadata-only on PG11+, so no row is rewritten, and the
   backfills (backfill_derived for CCRS, backfill_switrs_ksi for SWITRS) write
   only the ~3% of crashes that have a seriously injured person.
   It runs in an autocommit block because env.py wraps the whole upgrade in
   one transaction: otherwise ADD COLUMN's ACCESS EXCLUSIVE lock on crashes
   would be held through the matview builds below (minutes), blocking the
   map, /api/crashes and the nightly ETL. lock_timeout 5s stops it queuing
   behind a long read; if it times out the deploy fails cleanly and a re-run
   is safe (ADD COLUMN IF NOT EXISTS).

2. mv_crashes_by_year / mv_crashes_by_cause / mv_crashes_wide gain
   total_severe_injured. Each is built as <name>_new WITH DATA (plus its
   indexes) while the old view keeps serving, then the old one is dropped and
   the new one renamed in, all inside the migration transaction, so /api/stats
   never sees an empty view. Reads block (not fail) for a few seconds at the
   swap. Definitions are pg_get_viewdef output from prod (2026-09-18) with one
   column added. The older migrations have drifted from prod; do not copy them.

3. mv_crash_rates selects from mv_crashes_by_year, so it is dropped first and
   recreated with its live definition unchanged (no KSI there, by decision).

Grants: pg_default_acl already gives calsight_team read on objects calsight
creates. The guarded GRANTs cover a different migration role and
calsight_api_ro, which exists in neither prod nor CI (hence the guard).

Revision ID: <rev>
Revises: 77b8d6739669
Create Date: <generated>
"""
# migration-safety: matview swap. Each old stats view is dropped only after its
#   _new replacement is built, and the replacement is renamed into place with
#   the same columns plus total_severe_injured; crashes only gains a column.
from typing import Callable, Sequence, Union

from alembic import op


revision: str = "<rev>"
down_revision: Union[str, None] = "77b8d6739669"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _by_year(name: str, severe: bool) -> str:
    severe_col = (
        ",\n    COALESCE(sum(number_severe_injured), 0::bigint)::integer AS total_severe_injured"
        if severe else ""
    )
    return f"""
CREATE MATERIALIZED VIEW {name} AS
 SELECT county_code,
    crash_year,
    COALESCE(severity, 'Unknown'::character varying) AS severity,
    count(*)::integer AS crash_count,
    COALESCE(sum(number_killed), 0::bigint)::integer AS total_killed,
    COALESCE(sum(number_injured), 0::bigint)::integer AS total_injured{severe_col}
   FROM crashes
  WHERE crash_year IS NOT NULL
  GROUP BY county_code, crash_year, severity
WITH DATA
"""


def _by_cause(name: str, severe: bool) -> str:
    severe_col = (
        ",\n    COALESCE(sum(number_severe_injured), 0::bigint)::integer AS total_severe_injured"
        if severe else ""
    )
    return f"""
CREATE MATERIALIZED VIEW {name} AS
 SELECT county_code,
    crash_year,
    COALESCE(severity, 'Unknown'::character varying) AS severity,
    COALESCE(canonical_cause, 'uncategorized'::character varying) AS canonical_cause,
    count(*)::integer AS crash_count,
    COALESCE(sum(number_killed), 0::bigint)::integer AS total_killed,
    COALESCE(sum(number_injured), 0::bigint)::integer AS total_injured{severe_col}
   FROM crashes
  WHERE crash_year IS NOT NULL
  GROUP BY county_code, crash_year, severity, canonical_cause
WITH DATA
"""


def _wide(name: str, severe: bool) -> str:
    # The wide view's sums are bigint (no ::integer) on prod; keep that style.
    severe_col = (
        ",\n    COALESCE(sum(number_severe_injured), 0::bigint) AS total_severe_injured"
        if severe else ""
    )
    return f"""
CREATE MATERIALIZED VIEW {name} AS
 SELECT county_code,
    crash_year,
    severity,
    COALESCE(canonical_cause, 'uncategorized'::character varying) AS canonical_cause,
    COALESCE(canonical_weather, 'unknown'::character varying) AS canonical_weather,
    COALESCE(canonical_lighting, 'unknown'::character varying) AS canonical_lighting,
    COALESCE(canonical_collision_type, 'unknown'::character varying) AS canonical_collision_type,
        CASE
            WHEN is_highway IS NULL THEN '-1'::integer
            WHEN is_highway THEN 1
            ELSE 0
        END AS is_highway,
        CASE
            WHEN is_alcohol_involved IS NULL THEN '-1'::integer
            WHEN is_alcohol_involved THEN 1
            ELSE 0
        END AS f_alcohol,
        CASE
            WHEN is_distraction_involved IS NULL THEN '-1'::integer
            WHEN is_distraction_involved THEN 1
            ELSE 0
        END AS f_distracted,
        CASE
            WHEN pedestrian_involved IS NULL THEN '-1'::integer
            WHEN pedestrian_involved THEN 1
            ELSE 0
        END AS f_pedestrian,
        CASE
            WHEN cyclist_involved IS NULL THEN '-1'::integer
            WHEN cyclist_involved THEN 1
            ELSE 0
        END AS f_cyclist,
        CASE
            WHEN is_drug_involved IS NULL THEN '-1'::integer
            WHEN is_drug_involved THEN 1
            ELSE 0
        END AS f_drug,
        CASE
            WHEN hit_run IS NOT NULL THEN 1
            ELSE 0
        END AS f_hit_run,
        CASE
            WHEN at_fault_driver_age >= 16 AND at_fault_driver_age <= 21 THEN 1
            WHEN at_fault_driver_age >= 22 AND at_fault_driver_age <= 34 THEN 2
            WHEN at_fault_driver_age >= 35 AND at_fault_driver_age <= 49 THEN 3
            WHEN at_fault_driver_age >= 50 AND at_fault_driver_age <= 64 THEN 4
            WHEN at_fault_driver_age >= 65 THEN 5
            ELSE 0
        END AS age_bracket,
    day_of_week_num,
    crash_month,
    crash_hour,
    count(*) AS crash_count,
    COALESCE(sum(number_killed), 0::bigint) AS total_killed,
    COALESCE(sum(number_injured), 0::bigint) AS total_injured{severe_col}
   FROM crashes
  WHERE crash_year IS NOT NULL
  GROUP BY county_code, crash_year, severity, canonical_cause, canonical_weather, canonical_lighting, canonical_collision_type, is_highway, (
        CASE
            WHEN is_alcohol_involved IS NULL THEN '-1'::integer
            WHEN is_alcohol_involved THEN 1
            ELSE 0
        END), (
        CASE
            WHEN is_distraction_involved IS NULL THEN '-1'::integer
            WHEN is_distraction_involved THEN 1
            ELSE 0
        END), (
        CASE
            WHEN pedestrian_involved IS NULL THEN '-1'::integer
            WHEN pedestrian_involved THEN 1
            ELSE 0
        END), (
        CASE
            WHEN cyclist_involved IS NULL THEN '-1'::integer
            WHEN cyclist_involved THEN 1
            ELSE 0
        END), (
        CASE
            WHEN is_drug_involved IS NULL THEN '-1'::integer
            WHEN is_drug_involved THEN 1
            ELSE 0
        END), (
        CASE
            WHEN hit_run IS NOT NULL THEN 1
            ELSE 0
        END), (
        CASE
            WHEN at_fault_driver_age >= 16 AND at_fault_driver_age <= 21 THEN 1
            WHEN at_fault_driver_age >= 22 AND at_fault_driver_age <= 34 THEN 2
            WHEN at_fault_driver_age >= 35 AND at_fault_driver_age <= 49 THEN 3
            WHEN at_fault_driver_age >= 50 AND at_fault_driver_age <= 64 THEN 4
            WHEN at_fault_driver_age >= 65 THEN 5
            ELSE 0
        END), day_of_week_num, crash_month, crash_hour
WITH DATA
"""


_VIEWS: dict[str, Callable[[str, bool], str]] = {
    "mv_crashes_by_year": _by_year,
    "mv_crashes_by_cause": _by_cause,
    "mv_crashes_wide": _wide,
}

# (index name, "UNIQUE " or "", columns). Names match prod pg_indexes
# (2026-09-18). The unique ones are what REFRESH ... CONCURRENTLY needs.
_INDEXES: dict[str, list[tuple[str, str, str]]] = {
    "mv_crashes_by_year": [
        ("ix_mv_crashes_by_year_pk", "UNIQUE ", "(county_code, crash_year, severity)"),
        ("ix_mv_crashes_by_year_county", "", "(county_code)"),
    ],
    "mv_crashes_by_cause": [
        ("ix_mv_crashes_by_cause_pk", "UNIQUE ", "(county_code, crash_year, severity, canonical_cause)"),
        ("ix_mv_crashes_by_cause_county_year", "", "(county_code, crash_year)"),
    ],
    "mv_crashes_wide": [
        (
            "ix_mv_crashes_wide_pk",
            "UNIQUE ",
            "(county_code, crash_year, severity, canonical_cause, canonical_weather, "
            "canonical_lighting, canonical_collision_type, is_highway, f_alcohol, "
            "f_distracted, f_pedestrian, f_cyclist, f_drug, f_hit_run, age_bracket, "
            "day_of_week_num, crash_month, crash_hour)",
        ),
    ],
    "mv_crash_rates": [
        ("ix_mv_crash_rates_pk", "UNIQUE ", "(county_code, crash_year, severity)"),
        ("ix_mv_crash_rates_year_severity", "", "(crash_year, severity)"),
    ],
}

# Live definition, unchanged. Recreated only because it depends on mv_crashes_by_year.
_CRASH_RATES = """
CREATE MATERIALIZED VIEW mv_crash_rates AS
 SELECT y.county_code,
    y.crash_year,
    y.severity,
    y.crash_count AS total_crashes,
    y.total_killed,
    y.total_injured,
    round(y.crash_count::numeric * 100000.0 / NULLIF(d.population, 0)::numeric, 2) AS per_100k_population,
    round(y.crash_count::numeric * 10000.0 / NULLIF(ld.driver_count, 0)::numeric, 2) AS per_10k_licensed_drivers,
    round(((y.crash_count::numeric * 100.0)::double precision / NULLIF(rm.total_miles, 0::double precision))::numeric, 2) AS per_100_road_miles,
    round(y.crash_count::numeric * 100000.0 / NULLIF(tv.total_aadt, 0)::numeric, 2) AS per_100k_aadt,
    round(y.crash_count::numeric * 10000.0 / NULLIF(vr.total_vehicles, 0)::numeric, 2) AS per_10k_vehicles
   FROM mv_crashes_by_year y
     LEFT JOIN demographics d ON d.county_code = y.county_code AND d.year = y.crash_year
     LEFT JOIN licensed_drivers ld ON ld.county_code = y.county_code AND ld.year = y.crash_year
     LEFT JOIN ( SELECT road_miles.county_code,
            sum(road_miles.total_miles) AS total_miles
           FROM road_miles
          GROUP BY road_miles.county_code) rm ON rm.county_code = y.county_code
     LEFT JOIN traffic_volumes tv ON tv.county_code = y.county_code
     LEFT JOIN vehicle_registrations vr ON vr.county_code = y.county_code AND vr.year = y.crash_year
WITH DATA
"""

_GRANTS = """
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'calsight_team') THEN
        GRANT SELECT ON mv_crashes_by_year, mv_crashes_by_cause, mv_crashes_wide, mv_crash_rates TO calsight_team;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'calsight_api_ro') THEN
        GRANT SELECT ON mv_crashes_by_year, mv_crashes_by_cause, mv_crashes_wide, mv_crash_rates TO calsight_api_ro;
    END IF;
END
$$;
"""


def _rebuild_views(severe: bool) -> None:
    """Build <view>_new beside each live view, then swap them in."""
    for view, build in _VIEWS.items():
        op.execute(build(f"{view}_new", severe))
        for ix, unique, cols in _INDEXES[view]:
            op.execute(f"CREATE {unique}INDEX {ix}_new ON {view}_new {cols}")

    # From the first DROP to commit, the old views are ACCESS EXCLUSIVE locked.
    # 60s covers waiting out an in-flight REFRESH ... CONCURRENTLY; past that
    # the deploy fails cleanly and can be re-run.
    op.execute("SET LOCAL lock_timeout = '60s'")
    op.execute("DROP MATERIALIZED VIEW mv_crash_rates")  # the only dependent of mv_crashes_by_year
    for view in _VIEWS:
        # No CASCADE: an unexpected dependent must fail the migration, not vanish.
        op.execute(f"DROP MATERIALIZED VIEW {view}")
        op.execute(f"ALTER MATERIALIZED VIEW {view}_new RENAME TO {view}")
        for ix, _unique, _cols in _INDEXES[view]:
            op.execute(f"ALTER INDEX {ix}_new RENAME TO {ix}")

    op.execute(_CRASH_RATES)
    for ix, unique, cols in _INDEXES["mv_crash_rates"]:
        op.execute(f"CREATE {unique}INDEX {ix} ON mv_crash_rates {cols}")

    # Planner stats now (not at the next nightly VACUUM ANALYZE); also what
    # /api/pipeline-health reads as the matview age.
    for view in (*_VIEWS, "mv_crash_rates"):
        op.execute(f"ANALYZE {view}")
    op.execute(_GRANTS)


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("SET lock_timeout = '5s'")
        op.execute(
            "ALTER TABLE crashes ADD COLUMN IF NOT EXISTS "
            "number_severe_injured smallint NOT NULL DEFAULT 0"
        )
        # Session-level SET would otherwise leak into the swap transaction.
        op.execute("RESET lock_timeout")
    _rebuild_views(severe=True)


def downgrade() -> None:
    # Views first (they reference the column), then drop the column.
    _rebuild_views(severe=False)
    with op.get_context().autocommit_block():
        op.execute("SET lock_timeout = '5s'")
        op.execute("ALTER TABLE crashes DROP COLUMN IF EXISTS number_severe_injured")
        op.execute("RESET lock_timeout")
```

- [ ] **Step 4: Fix line endings.** Convert the file to CRLF with `./.venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" migrations/versions/<rev>_add_ksi_severe_injured.py`, then confirm with `file migrations/versions/<rev>_add_ksi_severe_injured.py`, which should report CRLF.

- [ ] **Step 5: Run the graph test and the guard.** Run:

```bash
./.venv/Scripts/python.exe -m pytest tests/test_migration_graph.py -q
./.venv/Scripts/python.exe -m scripts.check_migration_expand_contract migrations/versions/<rev>_add_ksi_severe_injured.py
./.venv/Scripts/python.exe -m alembic heads
```

Expected:
- the graph test passes;
- the guard prints `Checked 1 migration file(s): all expand-only or acknowledged.`;
- `alembic heads` prints exactly one head, `<rev> (head)`.

- [ ] **Step 6: Local up/down/up round trip** (needs the local Postgres; see Global Constraints). From the repo root, run `docker compose --profile local-db up -d db`. Then, from `backend/`:

```bash
TESTDB="DATABASE_URL=postgresql://calsight:calsight_dev@localhost:5433/calsight_test ETL_DATABASE_URL=postgresql://calsight:calsight_dev@localhost:5433/calsight_test DATABASE_URL_AZURE= ETL_DATABASE_URL_AZURE="
env $TESTDB ./.venv/Scripts/python.exe -m pytest -m integration tests/api/test_stats.py -q   # creates calsight_test at head, incl. this migration
env $TESTDB ./.venv/Scripts/python.exe -m alembic downgrade -1
env $TESTDB ./.venv/Scripts/python.exe -m alembic upgrade head
```

Expected:
- `test_stats.py` passes;
- the downgrade and the upgrade each exit 0.

Then run `docker compose exec db psql -U calsight -d calsight_test -c "\d mv_crashes_wide"` from the repo root. It should list `total_severe_injured | bigint`.

- [ ] **Step 7: Commit.**

```bash
git add backend/migrations/versions/<rev>_add_ksi_severe_injured.py
git commit -m "feat(ksi): migration adding number_severe_injured and swapping stats matviews"
```

## Task A3: CCRS derivation in `backfill_derived.py`

**Files:**
- Modify: `backend/etl/backfill_derived.py`. Add the new function before `repair_drifted_derived` (currently line 905). Wire it into `run()` (line 966) after `repair_drifted_derived(db, since_year=since_year)` and before `backfill_pedestrian_flags(...)`.
- Test: `backend/tests/test_backfill_derived.py` (append) and `backend/tests/api/test_backfill_severe_injured.py` (create).

**Interfaces:**
- Consumes: `_ccrs_year_range(db) -> range` and `text`, both already in the module.
- Produces:
  - `SERIOUS_INJURY_CODES: tuple[str, str] = ("SuspectSerious", "SevereInactive")`.
  - `backfill_severe_injured(db, since_year: int | None = None) -> tuple[int, int]`, which returns `(rows_set, rows_reset)`.

- [ ] **Step 1: Write the failing unit tests.** Append to `backend/tests/test_backfill_derived.py` (reusing its `_ScopeFakeDB`):

```python
class TestSevereInjuredResync:
    def _years(self, db, marker):
        return sorted(
            int(str(p["start"])[:4])
            for s, p in db.updates()
            if marker in s.lower() and "start" in p
        )

    def test_counts_both_serious_codes_and_only_ccrs(self):
        db = _ScopeFakeDB(max_year=2016)
        backfill_mod.backfill_severe_injured(db)
        sets = [(s.lower(), p) for s, p in db.updates() if "set number_severe_injured = s.n" in s.lower()]
        assert sets
        for sql, params in sets:
            assert params["codes"] == ["SuspectSerious", "SevereInactive"]
            assert "injury_severity = any(:codes)" in sql
            assert "c.data_source = 'ccrs'" in sql
            assert "number_severe_injured is distinct from s.n" in sql

    def test_reset_pass_zeroes_crashes_with_no_qualifying_victim(self):
        db = _ScopeFakeDB(max_year=2016)
        backfill_mod.backfill_severe_injured(db)
        resets = [s.lower() for s, _ in db.updates() if "set number_severe_injured = 0" in s.lower()]
        assert resets
        for sql in resets:
            assert "number_severe_injured > 0" in sql
            assert "not exists" in sql
            assert "crash_victims" in sql

    def test_scoped_run_only_touches_recent_years(self):
        scoped = _ScopeFakeDB(max_year=2025)
        backfill_mod.backfill_severe_injured(scoped, since_year=2024)
        assert self._years(scoped, "set number_severe_injured = s.n") == [2024, 2025]
        assert self._years(scoped, "set number_severe_injured = 0") == [2024, 2025]

        full = _ScopeFakeDB(max_year=2025)
        backfill_mod.backfill_severe_injured(full)
        assert self._years(full, "set number_severe_injured = s.n") == list(range(2016, 2026))

    def test_returns_set_and_reset_counts(self):
        # One CCRS year; the fake reports rowcount=1 per UPDATE.
        assert backfill_mod.backfill_severe_injured(_ScopeFakeDB(max_year=2016)) == (1, 1)
```

- [ ] **Step 2: Run the tests.** `./.venv/Scripts/python.exe -m pytest tests/test_backfill_derived.py -q -k SevereInjured`. Expected: FAIL with `AttributeError: module 'etl.backfill_derived' has no attribute 'backfill_severe_injured'`.

- [ ] **Step 3: Write the failing integration test.** Create `backend/tests/api/test_backfill_severe_injured.py`:

```python
"""backfill_severe_injured against real Postgres (CCRS KSI derivation)."""

from datetime import datetime

import pytest
from sqlalchemy import text

from app.models import Crash, CrashVictim
from etl.backfill_derived import backfill_severe_injured

pytestmark = pytest.mark.integration

CID = 999_000_222


@pytest.fixture(autouse=True)
def _cleanup(db_session):
    """The backfill commits per year, so remove the test rows explicitly."""
    yield
    db_session.execute(text("DELETE FROM crash_victims WHERE collision_id = :c"), {"c": CID})
    db_session.execute(text("DELETE FROM crashes WHERE collision_id = :c"), {"c": CID})
    db_session.commit()


def _seed(db_session):
    db_session.execute(text(
        "SELECT setval('crashes_id_seq', (SELECT COALESCE(MAX(id), 1) FROM crashes))"
    ))
    db_session.add(Crash(
        collision_id=CID, data_source="ccrs",
        crash_datetime=datetime(2019, 5, 1, 12, 0), crash_year=2019,
        county_code=19, number_killed=1, number_injured=3, severity="Fatal",
    ))
    for victim_id, sev in [
        (3001, "SuspectSerious"),
        (3002, "SevereInactive"),
        (3003, "SuspectMinor"),
        (3004, "Fatal"),
    ]:
        db_session.add(CrashVictim(
            victim_id=victim_id, collision_id=CID, data_source="ccrs", injury_severity=sev,
        ))
    db_session.flush()


def _stored(db_session) -> int:
    return db_session.execute(text(
        "SELECT number_severe_injured FROM crashes WHERE collision_id = :c AND data_source = 'ccrs'"
    ), {"c": CID}).scalar()


def test_counts_suspect_serious_and_severe_inactive_only(db_session):
    _seed(db_session)
    backfill_severe_injured(db_session)
    assert _stored(db_session) == 2  # SuspectMinor and Fatal excluded


def test_second_run_writes_nothing(db_session):
    _seed(db_session)
    first = backfill_severe_injured(db_session)
    assert first[0] >= 1
    assert backfill_severe_injured(db_session) == (0, 0)


def test_victim_downgraded_from_serious_resets_to_zero(db_session):
    _seed(db_session)
    backfill_severe_injured(db_session)
    db_session.execute(text(
        "UPDATE crash_victims SET injury_severity = 'SuspectMinor' "
        "WHERE collision_id = :c AND injury_severity IN ('SuspectSerious', 'SevereInactive')"
    ), {"c": CID})
    assert backfill_severe_injured(db_session) == (0, 1)
    assert _stored(db_session) == 0


def test_since_year_skips_older_years(db_session):
    _seed(db_session)
    backfill_severe_injured(db_session, since_year=2020)
    assert _stored(db_session) == 0
```

- [ ] **Step 4: Run it.** `env $TESTDB ./.venv/Scripts/python.exe -m pytest -m integration tests/api/test_backfill_severe_injured.py -q`. Expected: FAIL with `ImportError: cannot import name 'backfill_severe_injured'`.

- [ ] **Step 5: Implement.** In `backend/etl/backfill_derived.py`, insert directly above `def repair_drifted_derived(`:

```python
# Victim codes that count as "seriously injured" for KSI. Both are needed:
# SevereInactive is the retired pre-KABCO code and SuspectSerious is KABCO "A".
# Measured on prod 2026-09-18, SevereInactive is still 99.9% of serious
# victims in 2016, 37% in 2018 and 6% in 2025. Counting either code alone
# manufactures a trend.
SERIOUS_INJURY_CODES = ("SuspectSerious", "SevereInactive")


def backfill_severe_injured(db, since_year: int | None = None):
    """Ground-truth re-sync of crashes.number_severe_injured for CCRS crashes.

    Same shape as _resync_party_flag: year by year over the CCRS range,
    commit per year, and IS DISTINCT FROM guards so a no-change run writes
    nothing. Pass 1 sets the count of qualifying victims; pass 2 zeroes
    crashes that no longer have one (victim amendments). SWITRS rows are
    never touched; etl/backfill_switrs_ksi.py fills those once.

    ``since_year`` bounds the years examined (the nightly scoped run);
    None re-derives every CCRS year.

    Returns (rows_set, rows_reset).
    """
    codes = list(SERIOUS_INJURY_CODES)
    total_set = 0
    total_reset = 0
    for year in _ccrs_year_range(db):
        if since_year is not None and year < since_year:
            continue
        params = {"codes": codes, "start": f"{year}-01-01", "end": f"{year + 1}-01-01"}
        r = db.execute(text("""
            UPDATE crashes c
            SET number_severe_injured = s.n
            FROM (
                SELECT v.collision_id, count(*) AS n
                FROM crash_victims v
                JOIN crashes c2 ON c2.collision_id = v.collision_id
                    AND c2.data_source = 'ccrs'
                WHERE v.data_source = 'ccrs'
                  AND v.injury_severity = ANY(:codes)
                  AND c2.crash_datetime >= :start AND c2.crash_datetime < :end
                GROUP BY v.collision_id
            ) s
            WHERE c.collision_id = s.collision_id
              AND c.data_source = 'ccrs'
              AND c.number_severe_injured IS DISTINCT FROM s.n
        """), params)
        total_set += r.rowcount
        r = db.execute(text("""
            UPDATE crashes c
            SET number_severe_injured = 0
            WHERE c.data_source = 'ccrs'
              AND c.crash_datetime >= :start AND c.crash_datetime < :end
              AND c.number_severe_injured > 0
              AND NOT EXISTS (
                  SELECT 1 FROM crash_victims v
                  WHERE v.collision_id = c.collision_id
                    AND v.data_source = 'ccrs'
                    AND v.injury_severity = ANY(:codes)
              )
        """), params)
        total_reset += r.rowcount
        db.commit()
    logger.info("Severe-injured resync: %d set, %d reset to 0", total_set, total_reset)
    return total_set, total_reset
```

In `run()`, replace

```python
        repair_drifted_derived(db, since_year=since_year)
        backfill_pedestrian_flags(db, since_year=since_year)
```

with

```python
        repair_drifted_derived(db, since_year=since_year)
        backfill_severe_injured(db, since_year=since_year)
        backfill_pedestrian_flags(db, since_year=since_year)
```

Finally, create the integration test file above with CRLF endings (use the Step 4 converter from Task A2).

- [ ] **Step 6: Run the tests.** Run:

```bash
./.venv/Scripts/python.exe -m pytest tests/test_backfill_derived.py -q
env $TESTDB ./.venv/Scripts/python.exe -m pytest -m integration tests/api/test_backfill_severe_injured.py -q
```

Expected: all pass.

- [ ] **Step 7: Commit.**

```bash
git add backend/etl/backfill_derived.py backend/tests/test_backfill_derived.py backend/tests/api/test_backfill_severe_injured.py
git commit -m "feat(ksi): derive CCRS number_severe_injured from crash_victims in backfill_derived"
```

## Task A4: `backfill` waits for `victims`

**Files:**
- Modify: `backend/etl/jobs.py:193`
- Test: `backend/tests/test_orchestrator.py` (`test_default_registry_resolves_without_error`, line 79)

**Interfaces:**
- Produces: the `Job(name="backfill", depends_on=["crashes_ccrs", "parties", "victims"])` registration.

- [ ] **Step 1: Write the failing test.** In `backend/tests/test_orchestrator.py`, inside `test_default_registry_resolves_without_error`, directly after `assert names.index("parties") < names.index("backfill")`, add:

```python
    # backfill_severe_injured reads crash_victims, so today's victims must be loaded first.
    assert "victims" in build_default_registry().get("backfill").depends_on
    assert names.index("victims") < names.index("backfill")
```

- [ ] **Step 2: Run the test.** `./.venv/Scripts/python.exe -m pytest tests/test_orchestrator.py -q -k resolves`. Expected: FAIL on `assert "victims" in [...]`.

- [ ] **Step 3: Implement.** In `backend/etl/jobs.py`, replace

```python
        name="backfill",
        module="etl.backfill_derived",
        depends_on=["crashes_ccrs", "parties"],
```

with

```python
        name="backfill",
        module="etl.backfill_derived",
        # "victims": backfill_severe_injured derives KSI from crash_victims;
        # without the dep it would read yesterday's victims.
        depends_on=["crashes_ccrs", "parties", "victims"],
```

- [ ] **Step 4: Run the tests.** `./.venv/Scripts/python.exe -m pytest tests/test_orchestrator.py -q`. Expected: all pass.

- [ ] **Step 5: Commit.**

```bash
git add backend/etl/jobs.py backend/tests/test_orchestrator.py
git commit -m "fix(etl): backfill job waits for victims (KSI derivation reads crash_victims)"
```

## Task A5: SWITRS one-off backfill module

**Files:**
- Create: `backend/etl/backfill_switrs_ksi.py`
- Test: `backend/tests/test_backfill_switrs_ksi.py` (create) and `backend/tests/api/test_backfill_switrs_ksi_db.py` (create)

**Interfaces:**
- Consumes, from `etl.switrs_api`:
  - `download_switrs_archive(dest_dir: str) -> str`
  - `_fold_case_id(case_id: int | None) -> int | None`
  - `_safe_int(value) -> int | None`
  - `_safe_count(value) -> int | None` (clamps to >= 0)
- Consumes: `app.database.EtlSessionLocal`.
- Produces:
  - `assert_severe_column(conn: sqlite3.Connection) -> None`, which raises `RuntimeError` if the column is missing.
  - `read_severe_counts(conn: sqlite3.Connection, year: int) -> dict[int, int]`, keyed by folded collision_id.
  - `apply_year(db, counts: dict[int, int]) -> tuple[int, int, int]`, returning `(rows_written, rows_matched, severe_sum_on_matched_crashes)`.
  - `year_failure(year: int, counts: dict[int, int], matched: int) -> str | None`.
  - `run(start_year: int = 2001, end_year: int = 2015, sqlite_path: str | None = None) -> int`.
  - `main(argv: list[str] | None = None) -> None`.
- Deliberately NOT `@track_etl_run`. See Self-Review note 2.

- [ ] **Step 1: Write the failing unit tests.** Create `backend/tests/test_backfill_switrs_ksi.py`:

```python
"""Unit tests for the one-off SWITRS KSI backfill (no database)."""

import sqlite3

import pytest

from etl.backfill_switrs_ksi import (
    assert_severe_column,
    read_severe_counts,
    year_failure,
)

BIG = 9_234_567_890_123_456_789  # > 2**63-1, like 211,120 of 2001's case ids


def _archive(rows, with_column=True):
    conn = sqlite3.connect(":memory:")
    if with_column:
        conn.execute("CREATE TABLE collisions (case_id TEXT, collision_date TEXT, severe_injury_count INTEGER)")
        conn.executemany("INSERT INTO collisions VALUES (?, ?, ?)", rows)
    else:
        conn.execute("CREATE TABLE collisions (case_id TEXT, collision_date TEXT)")
    return conn


def test_reads_one_year_and_folds_oversized_ids():
    conn = _archive([
        (str(BIG), "2001-12-31", 2),
        ("100", "2001-01-01", 1),
        ("200", "2002-01-01", 5),
    ])
    assert read_severe_counts(conn, 2001) == {BIG % 10**18: 2, 100: 1}


def test_zero_negative_and_null_counts_are_skipped():
    conn = _archive([
        ("1", "2001-02-02", 0),
        ("2", "2001-02-02", -3),
        ("3", "2001-02-02", None),
        ("4", "2001-02-02", 1),
    ])
    assert read_severe_counts(conn, 2001) == {4: 1}


def test_duplicate_case_id_last_wins_like_the_loader():
    conn = _archive([("5", "2001-03-03", 1), ("5", "2001-03-04", 2)])
    assert read_severe_counts(conn, 2001) == {5: 2}


def test_missing_column_fails_loudly():
    with pytest.raises(RuntimeError, match="severe_injury_count"):
        assert_severe_column(_archive([], with_column=False))


def test_year_failure_rules():
    assert year_failure(2001, {}, 0) == "2001: no seriously injured people in the archive"
    assert year_failure(2001, {i: 1 for i in range(100)}, 99) is None
    reason = year_failure(2001, {i: 1 for i in range(100)}, 98)
    assert reason is not None and "98.0%" in reason
```

- [ ] **Step 2: Run the tests.** `./.venv/Scripts/python.exe -m pytest tests/test_backfill_switrs_ksi.py -q`. Expected: FAIL with `ModuleNotFoundError: No module named 'etl.backfill_switrs_ksi'`.

- [ ] **Step 3: Write the failing integration test.** Create `backend/tests/api/test_backfill_switrs_ksi_db.py`:

```python
"""apply_year against real Postgres: folded ids, SWITRS only, idempotent."""

import sqlite3
from datetime import datetime

import pytest
from sqlalchemy import text

from app.models import Crash
from etl.backfill_switrs_ksi import apply_year, read_severe_counts

pytestmark = pytest.mark.integration

BIG = 9_234_567_890_123_456_789
FOLDED = BIG % 10**18


@pytest.fixture(autouse=True)
def _cleanup(db_session):
    """apply_year commits per batch, so restore the shared test DB explicitly."""
    yield
    db_session.execute(text("DELETE FROM crashes WHERE collision_id = :c"), {"c": FOLDED})
    db_session.execute(text(
        "UPDATE crashes SET number_severe_injured = 0 WHERE collision_id = 100"
    ))
    db_session.commit()


def test_update_targets_folded_id_switrs_only_and_is_idempotent(db_session):
    db_session.execute(text(
        "SELECT setval('crashes_id_seq', (SELECT COALESCE(MAX(id), 1) FROM crashes))"
    ))
    db_session.add(Crash(
        collision_id=FOLDED, data_source="switrs",
        crash_datetime=datetime(2001, 12, 31, 8, 0), crash_year=2001,
        county_code=19, number_killed=0, number_injured=2, severity="Injury",
    ))
    db_session.flush()

    archive = sqlite3.connect(":memory:")
    archive.execute("CREATE TABLE collisions (case_id TEXT, collision_date TEXT, severe_injury_count INTEGER)")
    archive.executemany("INSERT INTO collisions VALUES (?, ?, ?)", [
        (str(BIG), "2001-12-31", 2),
        ("424242", "2001-06-01", 1),  # no such crash: unmatched
    ])
    counts = read_severe_counts(archive, 2001)
    # Seeded collision_id 100 exists as BOTH switrs (2015) and ccrs (2022).
    counts[100] = 3

    written, matched, severe_sum = apply_year(db_session, counts)
    assert (written, matched, severe_sum) == (2, 2, 5)

    stored = dict(db_session.execute(text(
        "SELECT data_source, number_severe_injured FROM crashes WHERE collision_id = 100"
    )).all())
    assert stored == {"switrs": 3, "ccrs": 0}

    assert apply_year(db_session, counts) == (0, 2, 5)  # re-run writes nothing
```

- [ ] **Step 4: Run it.** `env $TESTDB ./.venv/Scripts/python.exe -m pytest -m integration tests/api/test_backfill_switrs_ksi_db.py -q`. Expected: FAIL with `ModuleNotFoundError: No module named 'etl.backfill_switrs_ksi'`.

- [ ] **Step 5: Implement.** Create `backend/etl/backfill_switrs_ksi.py`:

```python
"""One-off: copy SWITRS seriously-injured counts onto crashes (KSI, 2001-2015).

The SWITRS archive's collisions.severe_injury_count (raw COUNT_SEVERE_INJ) was
never loaded, so crashes.number_severe_injured is 0 on every SWITRS row after
its migration. This reads only the non-zero counts, one year at a time, and
writes just those rows. The column's DEFAULT 0 already covers the rest.

Rows are matched on the loader's folded ids (switrs_api._fold_case_id). 211,120
of 2001's case ids overflow bigint and are stored folded, so unfolded they
would silently match nothing.

Idempotent: the UPDATE skips rows already holding the value, so a re-run
writes 0 rows. Exits non-zero when a year has no seriously injured people or
fewer than 99% of its source rows matched a crash (unmatched rows are expected
only where the loader skipped a null datetime).

Not registered in etl/jobs.py because the archive is static. Deliberately not
@track_etl_run either: an etl_runs row for a one-off source would sit in
/api/freshness and read stale a week later. The workflow run log is the record.

Usage:
    gh workflow run "Run ETL Job" -f job=backfill_switrs_ksi -f refresh_matviews=true
    python -m etl.backfill_switrs_ksi --sqlite /path/to/switrs.sqlite   # local, archive already downloaded
"""

from __future__ import annotations

import argparse
import logging
import shutil
import sqlite3
import tempfile
from contextlib import closing

from sqlalchemy import text

from app.database import EtlSessionLocal as SessionLocal  # write/DDL role
from etl.switrs_api import _fold_case_id, _safe_count, _safe_int, download_switrs_archive

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

START_YEAR = 2001
END_YEAR = 2015
BATCH_SIZE = 5000
MIN_MATCH_RATE = 0.99

# uq_crashes_collision_source makes this an index lookup per id.
_UPDATE = text("""
    UPDATE crashes c
    SET number_severe_injured = v.n
    FROM unnest(CAST(:ids AS BIGINT[]), CAST(:ns AS SMALLINT[])) AS v(id, n)
    WHERE c.collision_id = v.id
      AND c.data_source = 'switrs'
      AND c.number_severe_injured IS DISTINCT FROM v.n
""")

_MATCHED = text("""
    SELECT count(*), COALESCE(sum(number_severe_injured), 0)
    FROM crashes
    WHERE collision_id = ANY(CAST(:ids AS BIGINT[]))
      AND data_source = 'switrs'
""")


def assert_severe_column(conn: sqlite3.Connection) -> None:
    """Fail loudly if the archive lacks the column this job depends on."""
    cols = {row[1] for row in conn.execute("PRAGMA table_info(collisions)")}
    if "severe_injury_count" not in cols:
        raise RuntimeError(
            "SWITRS archive has no collisions.severe_injury_count column; "
            f"columns found: {sorted(cols)}"
        )


def read_severe_counts(conn: sqlite3.Connection, year: int) -> dict[int, int]:
    """{folded collision_id: seriously injured people} for one year, non-zero only."""
    cursor = conn.execute(
        "SELECT case_id, severe_injury_count FROM collisions "
        "WHERE collision_date LIKE ? AND severe_injury_count > 0",
        (f"{year}-%",),
    )
    counts: dict[int, int] = {}
    for case_id, raw in cursor:
        collision_id = _fold_case_id(_safe_int(case_id))
        n = _safe_count(raw)
        if collision_id is None or not n:
            continue
        counts[collision_id] = n  # duplicate case_id: last wins, like the loader's upsert
    return counts


def apply_year(db, counts: dict[int, int]) -> tuple[int, int, int]:
    """Write one year's counts in batches, committing each batch.

    Returns (rows written, source rows that matched a SWITRS crash, the summed
    number_severe_injured on those matched crashes).
    """
    items = list(counts.items())
    written = matched = severe_sum = 0
    for i in range(0, len(items), BATCH_SIZE):
        chunk = items[i:i + BATCH_SIZE]
        ids = [cid for cid, _ in chunk]
        r = db.execute(_UPDATE, {"ids": ids, "ns": [n for _, n in chunk]})
        found, total = db.execute(_MATCHED, {"ids": ids}).one()
        db.commit()
        written += r.rowcount
        matched += found
        severe_sum += total
    return written, matched, int(severe_sum)


def year_failure(year: int, counts: dict[int, int], matched: int) -> str | None:
    """Why this year fails verification, or None when it passes."""
    if not counts:
        return f"{year}: no seriously injured people in the archive"
    rate = matched / len(counts)
    if rate < MIN_MATCH_RATE:
        return f"{year}: only {rate:.1%} of {len(counts):,} source rows matched a crash"
    return None


def run(start_year: int = START_YEAR, end_year: int = END_YEAR, sqlite_path: str | None = None) -> int:
    tmp_dir = None
    db = SessionLocal()
    try:
        if sqlite_path is None:
            tmp_dir = tempfile.mkdtemp(prefix="switrs_ksi_")
            logger.info("Downloading SWITRS archive to %s", tmp_dir)
            sqlite_path = download_switrs_archive(tmp_dir)

        failures: list[str] = []
        total_written = 0
        with closing(sqlite3.connect(sqlite_path)) as conn:
            assert_severe_column(conn)
            for year in range(start_year, end_year + 1):
                counts = read_severe_counts(conn, year)
                written, matched, severe_sum = apply_year(db, counts)
                total_written += written
                logger.info(
                    "%d: source %d crashes / %d people; matched %d crashes holding %d people; wrote %d rows",
                    year, len(counts), sum(counts.values()), matched, severe_sum, written,
                )
                reason = year_failure(year, counts, matched)
                if reason:
                    failures.append(reason)

        if failures:
            raise RuntimeError("SWITRS KSI backfill verification failed: " + "; ".join(failures))
        logger.info("SWITRS KSI backfill done: %d rows written", total_written)
        return total_written
    finally:
        db.close()
        if tmp_dir is not None:
            shutil.rmtree(tmp_dir, ignore_errors=True)
            logger.info("Cleaned up temp dir: %s", tmp_dir)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="One-off SWITRS seriously-injured backfill (KSI)")
    parser.add_argument("--start", type=int, default=START_YEAR)
    parser.add_argument("--end", type=int, default=END_YEAR)
    parser.add_argument("--sqlite", default=None, help="Use an already-extracted switrs.sqlite instead of downloading")
    args = parser.parse_args(argv)
    run(start_year=args.start, end_year=args.end, sqlite_path=args.sqlite)


if __name__ == "__main__":
    main()
```

Convert all three new files to CRLF (use the converter from Task A2, Step 4).

- [ ] **Step 6: Run the tests.** Run:

```bash
./.venv/Scripts/python.exe -m pytest tests/test_backfill_switrs_ksi.py -q
env $TESTDB ./.venv/Scripts/python.exe -m pytest -m integration tests/api/test_backfill_switrs_ksi_db.py -q
./.venv/Scripts/python.exe -m ruff check etl/backfill_switrs_ksi.py tests/test_backfill_switrs_ksi.py tests/api/test_backfill_switrs_ksi_db.py
```

Expected: all pass, and ruff is clean.

- [ ] **Step 7: Commit.**

```bash
git add backend/etl/backfill_switrs_ksi.py backend/tests/test_backfill_switrs_ksi.py backend/tests/api/test_backfill_switrs_ksi_db.py
git commit -m "feat(ksi): one-off SWITRS severe-injury backfill from the Zenodo archive"
```

## Task A6: `/api/stats` returns `total_severe_injured`

**Files:**
- Modify: `backend/app/schemas/stats.py:18-55`
- Modify: `backend/app/routers/stats.py`:
  - Tables at lines 57-76 and 145-168.
  - Wide paths at lines 340-405.
  - MV paths at lines 489-577 and 639-661.
- Test: `backend/tests/api/test_stats_ksi.py` (create)

**Interfaces:**
- Produces a response field `total_severe_injured: int` on:
  - `GET /api/stats` for `group_by` ∈ {none, `county`, `year`, `cause`, `severity`}, on both the MV path and the `mv_crashes_wide` path;
  - the same groups of `POST /api/stats/batch`.
- Not added: `month` (the MV path reads `mv_crashes_by_month`, which has no column), and `hour`, `day_of_week`, `weather`, `lighting`, `collision_type`, `rate` and the demographic groups.

- [ ] **Step 1: Write the failing test.** Create `backend/tests/api/test_stats_ksi.py`:

```python
"""total_severe_injured through /api/stats: mv_year, mv_cause, mv_wide, batch."""

import pytest
from sqlalchemy import text

pytestmark = pytest.mark.integration


@pytest.fixture()
def severe(db_session):
    """Seed crash 4 (2023 Orange, ccrs, Injury, lane_change, distracted) with 2
    and crash 2 (2014 LA, switrs, Injury, speeding) with 1. The REFRESH runs
    inside the test transaction, so the rollback restores the views."""
    db_session.execute(text("UPDATE crashes SET number_severe_injured = 2 WHERE id = 4"))
    db_session.execute(text("UPDATE crashes SET number_severe_injured = 1 WHERE id = 2"))
    for mv in ("mv_crashes_by_year", "mv_crashes_by_cause", "mv_crashes_wide"):
        db_session.execute(text(f"REFRESH MATERIALIZED VIEW {mv}"))


def _by(rows, key):
    return {r[key]: r["total_severe_injured"] for r in rows}


def test_grand_total(client, severe):
    assert client.get("/api/stats").json()["total_severe_injured"] == 3


def test_year_mv_path(client, severe):
    by_year = _by(client.get("/api/stats?group_by=year").json(), "year")
    assert by_year[2014] == 1
    assert by_year[2023] == 2
    assert by_year[2022] == 0


def test_county_and_severity_mv_path(client, severe):
    assert _by(client.get("/api/stats?group_by=county").json(), "county_code")[30] == 2
    assert _by(client.get("/api/stats?group_by=severity").json(), "severity")["Injury"] == 3


def test_cause_filter_uses_cause_view(client, severe):
    rows = client.get("/api/stats?group_by=year&cause=lane_change").json()
    assert _by(rows, "year") == {2023: 2}
    causes = _by(client.get("/api/stats?group_by=cause").json(), "canonical_cause")
    assert causes["lane_change"] == 2
    assert causes["speeding"] == 1


def test_involvement_filter_uses_wide_view(client, severe):
    rows = client.get("/api/stats?group_by=year&distracted=true").json()
    assert _by(rows, "year")[2023] == 2
    total = client.get("/api/stats?distracted=true").json()
    assert total["total_severe_injured"] == 2


def test_batch_carries_the_field(client, severe):
    body = client.post("/api/stats/batch", json={"groups": ["year", "county"]}).json()
    assert _by(body["year"], "year")[2023] == 2
    assert _by(body["county"], "county_code")[19] == 1
```

- [ ] **Step 2: Run it.** `env $TESTDB ./.venv/Scripts/python.exe -m pytest -m integration tests/api/test_stats_ksi.py -q`. Expected: FAIL with `KeyError: 'total_severe_injured'`.

- [ ] **Step 3: Implement the schemas.** In `backend/app/schemas/stats.py`, add `total_severe_injured: int = 0` as the last field of five classes. The additive default keeps old consumers valid.

```python
class GrandTotal(BaseModel):
    total_crashes: int
    total_killed: int
    total_injured: int
    total_severe_injured: int = 0


class CountyRow(BaseModel):
    county_code: int
    county_name: str | None = None
    crash_count: int
    total_killed: int
    total_injured: int
    total_severe_injured: int = 0


class YearRow(BaseModel):
    year: int
    crash_count: int
    total_killed: int
    total_injured: int
    total_severe_injured: int = 0


class CauseRow(BaseModel):
    canonical_cause: str
    crash_count: int
    total_killed: int
    total_injured: int
    total_severe_injured: int = 0
```

and

```python
class SeverityRow(BaseModel):
    severity: str
    crash_count: int
    total_killed: int
    total_injured: int
    total_severe_injured: int = 0
```

- [ ] **Step 4: Implement the router tables** (`backend/app/routers/stats.py`). Add `Column("total_severe_injured", Integer),` after `Column("total_injured", Integer),` in exactly three tables: `mv_year`, `mv_cause` and `mv_wide`. The result:

```python
mv_year = Table(
    "mv_crashes_by_year", _metadata,
    Column("county_code", SmallInteger),
    Column("crash_year", SmallInteger),
    Column("severity", String),
    Column("crash_count", Integer),
    Column("total_killed", Integer),
    Column("total_injured", Integer),
    Column("total_severe_injured", Integer),
)

mv_cause = Table(
    "mv_crashes_by_cause", _metadata,
    Column("county_code", SmallInteger),
    Column("crash_year", SmallInteger),
    Column("severity", String),
    Column("canonical_cause", String),
    Column("crash_count", Integer),
    Column("total_killed", Integer),
    Column("total_injured", Integer),
    Column("total_severe_injured", Integer),
)
```

In `mv_wide`, the tail becomes:

```python
    Column("crash_count", Integer),
    Column("total_killed", Integer),
    Column("total_injured", Integer),
    Column("total_severe_injured", Integer),
)
```

(`mv_month` and `mv_rates` are unchanged.)

- [ ] **Step 5: Implement the wide paths** (inside `if has_involvement or has_condition_group:`). Replace the five branches as follows. The `month` branch is unchanged.

```python
        if group_by is None:
            stmt = _wide_query(select(
                func.coalesce(cc, 0).label("total_crashes"),
                func.coalesce(func.sum(w.c.total_killed), 0).label("total_killed"),
                func.coalesce(func.sum(w.c.total_injured), 0).label("total_injured"),
                func.coalesce(func.sum(w.c.total_severe_injured), 0).label("total_severe_injured"),
            ))
            row = db.execute(stmt).one()
            return GrandTotal(total_crashes=row.total_crashes, total_killed=row.total_killed, total_injured=row.total_injured, total_severe_injured=row.total_severe_injured).model_dump()

        if group_by == "county":
            stmt = _wide_query(
                select(
                    w.c.county_code,
                    County.name.label("county_name"),
                    func.coalesce(cc, 0).label("crash_count"),
                    func.coalesce(func.sum(w.c.total_killed), 0).label("total_killed"),
                    func.coalesce(func.sum(w.c.total_injured), 0).label("total_injured"),
                    func.coalesce(func.sum(w.c.total_severe_injured), 0).label("total_severe_injured"),
                )
                .join(County, County.code == w.c.county_code)
                .group_by(w.c.county_code, County.name)
                .order_by(cc.desc())
            )
            rows = db.execute(stmt).all()
            return [CountyRow(county_code=r.county_code, county_name=r.county_name, crash_count=r.crash_count, total_killed=r.total_killed, total_injured=r.total_injured, total_severe_injured=r.total_severe_injured).model_dump() for r in rows]

        if group_by == "year":
            stmt = _wide_query(
                select(
                    w.c.crash_year.label("year"),
                    func.coalesce(cc, 0).label("crash_count"),
                    func.coalesce(func.sum(w.c.total_killed), 0).label("total_killed"),
                    func.coalesce(func.sum(w.c.total_injured), 0).label("total_injured"),
                    func.coalesce(func.sum(w.c.total_severe_injured), 0).label("total_severe_injured"),
                )
                .group_by(w.c.crash_year)
                .order_by(w.c.crash_year)
            )
            rows = db.execute(stmt).all()
            return [YearRow(year=r.year, crash_count=r.crash_count, total_killed=r.total_killed, total_injured=r.total_injured, total_severe_injured=r.total_severe_injured).model_dump() for r in rows]

        if group_by == "cause":
            stmt = _wide_query(
                select(
                    w.c.canonical_cause,
                    func.coalesce(cc, 0).label("crash_count"),
                    func.coalesce(func.sum(w.c.total_killed), 0).label("total_killed"),
                    func.coalesce(func.sum(w.c.total_injured), 0).label("total_injured"),
                    func.coalesce(func.sum(w.c.total_severe_injured), 0).label("total_severe_injured"),
                )
                .group_by(w.c.canonical_cause)
                .order_by(cc.desc())
            )
            rows = db.execute(stmt).all()
            return [CauseRow(canonical_cause=r.canonical_cause, crash_count=r.crash_count, total_killed=r.total_killed, total_injured=r.total_injured, total_severe_injured=r.total_severe_injured).model_dump() for r in rows]

        if group_by == "severity":
            stmt = _wide_query(
                select(
                    w.c.severity,
                    func.coalesce(cc, 0).label("crash_count"),
                    func.coalesce(func.sum(w.c.total_killed), 0).label("total_killed"),
                    func.coalesce(func.sum(w.c.total_injured), 0).label("total_injured"),
                    func.coalesce(func.sum(w.c.total_severe_injured), 0).label("total_severe_injured"),
                )
                .group_by(w.c.severity)
                .order_by(cc.desc())
            )
            rows = db.execute(stmt).all()
            return [SeverityRow(severity=r.severity, crash_count=r.crash_count, total_killed=r.total_killed, total_injured=r.total_injured, total_severe_injured=r.total_severe_injured).model_dump() for r in rows]
```

- [ ] **Step 6: Implement the standard MV paths.** Replace the grand-total, county, year and cause blocks. `view` is `mv_year` or `mv_cause` on every one of these paths, and both have the column.

```python
    # --- grand total (no group_by) ---
    if group_by is None:
        stmt = select(
            func.coalesce(func.sum(view.c.crash_count), 0).label("total_crashes"),
            func.coalesce(func.sum(view.c.total_killed), 0).label("total_killed"),
            func.coalesce(func.sum(view.c.total_injured), 0).label("total_injured"),
            func.coalesce(func.sum(view.c.total_severe_injured), 0).label("total_severe_injured"),
        )
        stmt = _apply_filters(stmt, view, years, county_codes, severities, causes)
        row = db.execute(stmt).one()
        return GrandTotal(
            total_crashes=row.total_crashes,
            total_killed=row.total_killed,
            total_injured=row.total_injured,
            total_severe_injured=row.total_severe_injured,
        ).model_dump()

    # --- group_by=county ---
    if group_by == "county":
        stmt = (
            select(
                view.c.county_code,
                County.name.label("county_name"),
                func.sum(view.c.crash_count).label("crash_count"),
                func.sum(view.c.total_killed).label("total_killed"),
                func.sum(view.c.total_injured).label("total_injured"),
                func.sum(view.c.total_severe_injured).label("total_severe_injured"),
            )
            .select_from(view.join(County, County.code == view.c.county_code))
            .group_by(view.c.county_code, County.name)
            .order_by(func.sum(view.c.crash_count).desc())
        )
        stmt = _apply_filters(stmt, view, years, county_codes, severities, causes)
        rows = db.execute(stmt).all()
        return [
            CountyRow(
                county_code=r.county_code,
                county_name=r.county_name,
                crash_count=r.crash_count,
                total_killed=r.total_killed,
                total_injured=r.total_injured,
                total_severe_injured=r.total_severe_injured,
            ).model_dump()
            for r in rows
        ]

    # --- group_by=year ---
    if group_by == "year":
        stmt = (
            select(
                view.c.crash_year.label("year"),
                func.sum(view.c.crash_count).label("crash_count"),
                func.sum(view.c.total_killed).label("total_killed"),
                func.sum(view.c.total_injured).label("total_injured"),
                func.sum(view.c.total_severe_injured).label("total_severe_injured"),
            )
            .group_by(view.c.crash_year)
            .order_by(view.c.crash_year)
        )
        stmt = _apply_filters(stmt, view, years, county_codes, severities, causes)
        rows = db.execute(stmt).all()
        return [
            YearRow(
                year=r.year,
                crash_count=r.crash_count,
                total_killed=r.total_killed,
                total_injured=r.total_injured,
                total_severe_injured=r.total_severe_injured,
            ).model_dump()
            for r in rows
        ]

    # --- group_by=cause ---
    if group_by == "cause":
        stmt = (
            select(
                view.c.canonical_cause,
                func.sum(view.c.crash_count).label("crash_count"),
                func.sum(view.c.total_killed).label("total_killed"),
                func.sum(view.c.total_injured).label("total_injured"),
                func.sum(view.c.total_severe_injured).label("total_severe_injured"),
            )
            .group_by(view.c.canonical_cause)
            .order_by(func.sum(view.c.crash_count).desc())
        )
        stmt = _apply_filters(stmt, view, years, county_codes, severities, causes)
        rows = db.execute(stmt).all()
        return [
            CauseRow(
                canonical_cause=r.canonical_cause,
                crash_count=r.crash_count,
                total_killed=r.total_killed,
                total_injured=r.total_injured,
                total_severe_injured=r.total_severe_injured,
            ).model_dump()
            for r in rows
        ]
```

Then the severity block:

```python
    # --- group_by=severity ---
    if group_by == "severity":
        stmt = (
            select(
                view.c.severity,
                func.sum(view.c.crash_count).label("crash_count"),
                func.sum(view.c.total_killed).label("total_killed"),
                func.sum(view.c.total_injured).label("total_injured"),
                func.sum(view.c.total_severe_injured).label("total_severe_injured"),
            )
            .group_by(view.c.severity)
            .order_by(func.sum(view.c.crash_count).desc())
        )
        stmt = _apply_filters(stmt, view, years, county_codes, severities, causes)
        rows = db.execute(stmt).all()
        return [
            SeverityRow(
                severity=r.severity,
                crash_count=r.crash_count,
                total_killed=r.total_killed,
                total_injured=r.total_injured,
                total_severe_injured=r.total_severe_injured,
            ).model_dump()
            for r in rows
        ]
```

Leave the hour, month, day_of_week and rate blocks untouched.

- [ ] **Step 7: Run the tests.** Run:

```bash
env $TESTDB ./.venv/Scripts/python.exe -m pytest -m integration tests/api/test_stats_ksi.py tests/api/test_stats.py tests/api/test_stats_batch.py -q
```

Expected: all pass.

- [ ] **Step 8: Commit.**

```bash
git add backend/app/schemas/stats.py backend/app/routers/stats.py backend/tests/api/test_stats_ksi.py
git commit -m "feat(ksi): return total_severe_injured from /api/stats year/county/cause/severity/total"
```

## Task A7: Coverage validation (a complete year summing to 0)

**Files:**
- Modify: `backend/etl/validation.py`. Add the new function above `run_crash_validations` (line 306), and append it to that function's check list.
- Test: `backend/tests/test_validation_severe.py` (create)

**Interfaces:**
- Produces: `check_severe_injured_coverage(db: Session) -> ValidationCheck` (name `crashes_severe_injured_coverage`, severity `warning`). It reads `mv_crashes_by_year`, which has about 4.4K rows, never `crashes`.

- [ ] **Step 1: Write the failing test.** Create `backend/tests/test_validation_severe.py`:

```python
"""KSI guard: a complete year whose seriously-injured total is 0 means a backfill didn't run."""

from etl.validation import check_severe_injured_coverage


class _Result:
    def __init__(self, years):
        self._years = years

    def scalars(self):
        return self

    def all(self):
        return self._years


class _DB:
    def __init__(self, years):
        self.years = years
        self.sql = None

    def execute(self, clause, params=None):
        self.sql = " ".join(str(clause).split()).lower()
        return _Result(self.years)


def test_flags_years_with_zero_seriously_injured():
    db = _DB([2001, 2002])
    check = check_severe_injured_coverage(db)
    assert check.passed is False
    assert check.severity == "warning"
    assert "2001" in check.message and "2002" in check.message
    assert "from mv_crashes_by_year" in db.sql
    assert "having sum(total_severe_injured) = 0" in db.sql


def test_passes_when_every_complete_year_has_some():
    check = check_severe_injured_coverage(_DB([]))
    assert check.passed is True
```

- [ ] **Step 2: Run the test.** `./.venv/Scripts/python.exe -m pytest tests/test_validation_severe.py -q`. Expected: FAIL with `ImportError: cannot import name 'check_severe_injured_coverage'`.

- [ ] **Step 3: Implement.** In `backend/etl/validation.py`, insert above `def run_crash_validations`:

```python
def check_severe_injured_coverage(db: Session) -> ValidationCheck:
    """KSI guard: every complete year should have some seriously injured people.

    crashes.number_severe_injured defaults to 0, so "never backfilled" looks
    exactly like "none". A complete year summing to 0 means the SWITRS one-off
    or the CCRS derivation hasn't run for it. Reads the small matview, not
    the 11.6M-row table; the in-progress year is excluded.
    """
    missing = db.execute(text("""
        SELECT crash_year FROM mv_crashes_by_year
        WHERE crash_year < EXTRACT(YEAR FROM now())
        GROUP BY crash_year
        HAVING SUM(total_severe_injured) = 0
        ORDER BY crash_year
    """)).scalars().all()
    if missing:
        return ValidationCheck(
            name="crashes_severe_injured_coverage",
            passed=False,
            message=f"No seriously injured people recorded for complete years: {list(missing)}",
            severity="warning",
            metric_value=len(missing),
        )
    return ValidationCheck(
        name="crashes_severe_injured_coverage",
        passed=True,
        message="Every complete year has seriously injured people",
    )
```

In `run_crash_validations`, after `report.checks.append(check_coordinate_bounds(db, "crashes"))`, add:

```python
    report.checks.append(check_severe_injured_coverage(db))
```

Convert the new test file to CRLF.

- [ ] **Step 4: Run the tests.** `./.venv/Scripts/python.exe -m pytest tests/test_validation_severe.py tests/test_orchestrator.py -q`. Expected: all pass.

- [ ] **Step 5: Commit.**

```bash
git add backend/etl/validation.py backend/tests/test_validation_severe.py
git commit -m "feat(ksi): warn when a complete year has zero seriously injured people"
```

## Task A8: Docs

**Files:**
- Modify: `backend/DATA_DICTIONARY.md`:
  - crashes table, after line 62;
  - line 142;
  - `mv_crashes_by_cause` (lines 552-560) and `mv_crashes_by_year` (lines 562-574).
- Modify: `docs/DATA_METHODOLOGY.md`: add §5.6 after §5.5 (before the `---` that precedes `## 6.`), and add a bullet to §7.2.

**Interfaces:**
- Produces: the methodology asterisk text. It is identical to `frontend/src/lib/ksi.ts` `KSI_DEFINITION` (Task B1); keep the two in step.

- [ ] **Step 1: Watch the check fail first.** `grep -n "number_severe_injured\|SuspectSerious" backend/DATA_DICTIONARY.md docs/DATA_METHODOLOGY.md`. Expected: no output (exit 1).

- [ ] **Step 2: Implement `backend/DATA_DICTIONARY.md`.** After the row `` | `number_injured` | SmallInteger | Y | Injured persons (default 0) | ``, add:

```markdown
| `number_severe_injured` | SmallInteger | N | People seriously injured (the "SI" in KSI), default 0. SWITRS 2001–2015: archive `severe_injury_count` (one-off `etl.backfill_switrs_ksi`). CCRS 2016+: victims coded `SuspectSerious` or `SevereInactive` (`etl.backfill_derived`, nightly). Not overwritten by crash reloads |
```

Replace line 142 with:

```markdown
| `injury_severity` | String(50) | Y | "Fatal", "SuspectSerious", "SevereInactive", "SuspectMinor", "PossibleInjury", "OtherVisibleInactive", "ComplaintOfPainInactive", or null. `SuspectSerious` + `SevereInactive` = seriously injured (KSI). Indexed |
```

In both the `mv_crashes_by_cause` and `mv_crashes_by_year` tables, add a last row:

```markdown
| `total_severe_injured` | Integer | N | Sum of `number_severe_injured` (people seriously injured) |
```

- [ ] **Step 3: Implement `docs/DATA_METHODOLOGY.md`.** Directly after the §5.5 code block (the one ending `vehicles_per_capita = total_vehicles / population`), insert:

````markdown

### 5.6 KSI (Killed or Seriously Injured)

People, not crashes:

```
ksi = number_killed + number_severe_injured      (summed over crashes)
ksi_per_100k = ksi / population * 100,000        (Stats hero tile; complete years only)
```

"Seriously injured" is SWITRS `severe_injury_count` for 2001–2015 and CCRS victims coded `SuspectSerious` or `SevereInactive` for 2016+. Years without census population use the nearest census year, and the tile says so. The in-progress year is excluded.

\* KSI = people killed or seriously injured. Before 2016 "seriously injured" is SWITRS's "severe injury". From 2016 it is CCRS's "suspected serious injury" plus the older "severe" code that agencies phased out through about 2025. The definitions are close but not identical, so compare years across 2015→2016 (and 2017→2018, when most agencies switched) with care.
````

In §7.2, after the `**Time series analysis**` bullet, add:

```markdown
- **KSI** changes definition twice: at 2015→2016 (SWITRS "severe" to CCRS codes) and at 2017→2018, when most agencies moved from the old "severe" code to KABCO "suspected serious". Serious injuries rose 14% in 2018 while deaths fell, which is consistent with a scoring change rather than a real rise. See §5.6.
```

- [ ] **Step 4: Check.** Re-run the Step 1 grep. It should now print matches in both files. Then run `file backend/DATA_DICTIONARY.md docs/DATA_METHODOLOGY.md`, which should still report CRLF.

- [ ] **Step 5: Commit.**

```bash
git add backend/DATA_DICTIONARY.md docs/DATA_METHODOLOGY.md
git commit -m "docs(ksi): document number_severe_injured, real injury_severity codes, KSI definition"
```

## Task A9: Full check, pre-flight, PR A, deploy and verify

- [ ] **Step 1: Run the full backend suite.** From `backend/`:

```bash
./.venv/Scripts/python.exe -m ruff check .
./.venv/Scripts/python.exe -m pytest -m "not integration" -q
env $TESTDB ./.venv/Scripts/python.exe -m pytest -m integration -q
./.venv/Scripts/python.exe -m pytest tests/test_migration_graph.py -q
```

Expected: ruff is clean and every suite passes.

- [ ] **Step 2: Pre-flight backup check** (read-only). Run `ssh pve "pct exec 100 -- sh -c 'ls -lt /var/backups/calsight | head -3'"`. Expected: a `calsight_*.dump.gz` from last night (LXC 100's 19:00 cron). Also check that the healthchecks.io backup check reads "up". If either is missing, stop and resolve that first.

- [ ] **Step 3: Push and open the PR** (no AI attribution in the body):

```bash
git push -u origin feat/ksi-backend
gh pr create --base main --head feat/ksi-backend --title "KSI backend: number_severe_injured, matview swap, SWITRS/CCRS backfills" --body "$(cat <<'EOF'
Adds crashes.number_severe_injured (people seriously injured) and total_severe_injured on mv_crashes_by_year / _by_cause / _wide, exposed through /api/stats (year, county, cause, severity, grand total). Additive; no UI reads it yet.

- Migration: ADD COLUMN in an autocommit block (lock_timeout 5s); the three views are built as *_new WITH DATA and renamed in, so /api/stats never sees an empty view. mv_crash_rates recreated unchanged.
- CCRS: backfill_derived.backfill_severe_injured (SuspectSerious + SevereInactive), nightly; the backfill job now waits for victims.
- SWITRS: one-off etl.backfill_switrs_ksi (folded case ids, idempotent, fails on <99% match). Run manually after deploy.
- Validation warns if any complete year sums to 0.

After merge: run backfill_derived --full, then backfill_switrs_ksi (see plan).
EOF
)"
```

- [ ] **Step 4: Merge after CI is green.** Run `gh pr checks --watch`. The owner merges (outside the scheduler windows, all UTC: 02:00 host ETL, 07:00 local backup, 09:00 Sunday weekly, 11:00 Mon-Sat daily ETL, 15:00 vacuum, 19:00 R2 backup): `gh pr merge <n> --merge --admin --delete-branch`. That merge is the deploy. Watch it with `gh run watch "$(gh run list --workflow deploy.yml --limit 1 --json databaseId -q '.[0].databaseId')"`. Expected: every step is green, including "Run database migrations", "Backfill derived fields" and "Refresh materialized views".

- [ ] **Step 5: Verify the swap on prod** (read-only). Put this in a local file `verify_ksi_views.sql`:

```sql
SELECT matviewname, ispopulated FROM pg_matviews
 WHERE matviewname IN ('mv_crashes_by_year','mv_crashes_by_cause','mv_crashes_wide','mv_crash_rates') ORDER BY 1;
SELECT indexname FROM pg_indexes
 WHERE tablename IN ('mv_crashes_by_year','mv_crashes_by_cause','mv_crashes_wide','mv_crash_rates') ORDER BY 1;
SELECT relname, relacl FROM pg_class
 WHERE relname IN ('mv_crashes_by_year','mv_crashes_by_cause','mv_crashes_wide','mv_crash_rates') ORDER BY 1;
SELECT count(*) FROM pg_class WHERE relname LIKE 'mv_crashes_%_new';
```

Then run `ssh pve "pct exec 100 -- su postgres -c 'psql -d calsight -At'" < verify_ksi_views.sql`. Expected:
- all four views populated (`t`);
- exactly the 7 index names from `view_indexes.txt`;
- every `relacl` containing `calsight_team=r/calsight`;
- a final count of `0` (no leftover `_new` views).

Then check the API with `curl -s "https://api.calsight.org/api/stats?_cb=$(date +%s)"`. Expected: the JSON includes `"total_severe_injured"`. Also check `https://api.calsight.org/api/health`, which should return ok.

---

# Rollout step 2: manual backfills and verification (no code, no PR)

## Task R1: Full CCRS derivation (all years)

The deploy's "Backfill derived fields" step runs `python -m etl.backfill_derived` with no arguments. `main()` maps that to `run(daily=True)`, which is scoped to the previous data year, so it filled only 2025 and later. The other CCRS years need an explicit `--full` run.

- [ ] **Step 1: Dispatch and watch.** Run:

```bash
gh workflow run "Run ETL Job" -f job=backfill_derived -f args="--full" -f refresh_matviews=true
gh run watch "$(gh run list --workflow run-etl.yml --limit 1 --json databaseId -q '.[0].databaseId')"
```

Expected: success in about 25–30 min (the backfill took 14m05s last time, the matviews 10m52s). The log should show `Severe-injured resync: N set, M reset to 0`, with N ≈ 170k and M = 0.

- [ ] **Step 2: Verify against the spec's measured numbers (§3, "Serious total").** Run:

```bash
curl -s "https://api.calsight.org/api/stats?group_by=year&_cb=$(date +%s)" \
  | ./backend/.venv/Scripts/python.exe -c "import json,sys; [print(r['year'], r['total_severe_injured']) for r in json.load(sys.stdin) if r['year'] >= 2016]"
```

Expected values. 2016–2024 must match exactly: victims reload only the current and previous year, so those years are frozen.

| Year | Expected |
|---|---|
| 2016 | 13,539 |
| 2017 | 14,491 |
| 2018 | 16,560 |
| 2019 | 16,835 |
| 2020 | 15,857 |
| 2021 | 18,678 |
| 2022 | 18,398 |
| 2023 | 16,132 |
| 2024 | 17,182 |
| 2025 | about 17,036 (may drift a little from amendments) |
| 2026 | 10,074 or more (partial year, still growing) |

`number_killed` is unchanged. For reference, spec KSI (Fatal victims) for 2022 is 23,057, while API `total_killed + total_severe_injured` for 2022 should be 4,661 + 18,398 = 23,059. That ±2 gap is the known `number_killed` vs Fatal-victim difference.

If any 2016–2024 year is off, stop: do not run R2 or PR B. Investigate by comparing against a direct victim count on LXC 100.

## Task R2: SWITRS backfill

- [ ] **Step 1: Dispatch and watch** (only after R1 has finished; one pending run per concurrency group). Run:

```bash
gh workflow run "Run ETL Job" -f job=backfill_switrs_ksi -f refresh_matviews=true
gh run watch "$(gh run list --workflow run-etl.yml --limit 1 --json databaseId -q '.[0].databaseId')"
```

Expected:
- success in about 10–20 min plus about 11 min of matview refresh;
- one log line per year, `2001: source ... crashes / ... people; matched ... crashes holding ... people; wrote ... rows`;
- no `verification failed` error.

If `assert_severe_column` raises, the archive schema differs from upstream `row_types.py`. Nothing will have been written. Stop and report.

- [ ] **Step 2: Plausibility checks.** Run:

```bash
curl -s "https://api.calsight.org/api/stats?group_by=year&_cb=$(date +%s)" \
  | ./backend/.venv/Scripts/python.exe -c "import json,sys; [print(r['year'], r['total_killed'], r['total_severe_injured']) for r in json.load(sys.stdin)]"
```

Expected:
- every year from 2001 to 2015 is non-zero;
- each is roughly in the 9,000–18,000 band;
- 2015 is within about ±25% of CCRS 2016 (13,539);
- there is no single-year jump over about 30% inside 2001–2015;
- 2001 is not visibly low next to 2002 (a low 2001 would mean the ID fold failed).

In the job log, the match rate should be ≥ 99% in every year. Record the per-year numbers in the PR A conversation for the record.

- [ ] **Step 3: Check the monitoring state.** Confirm `/api/freshness` shows no new source and nothing stale. This job writes no `etl_runs` row. The next nightly pipeline's `crashes_ccrs` validation should show `crashes_severe_injured_coverage: PASS`.

---

# Rollout step 3: PR B (frontend), branch `feat/ksi-frontend`

- [ ] **Pre-step:** from the repo root, run `git checkout main && git pull && git checkout -b feat/ksi-frontend`. All commands below run from `frontend/`.

## Task B1: Shared KSI text, footnote rule, glossary, types

**Files:**
- Create: `frontend/src/lib/ksi.ts`, `frontend/src/lib/ksi.test.ts`
- Modify:
  - `frontend/src/components/ui/JargonTerm.tsx:14-15`
  - `frontend/src/types/api.ts:13-23`
  - `frontend/src/lib/dashboard/types.ts:9-13, 68-78`
  - `frontend/src/lib/dashboard/anomaly.ts:20-23`

**Interfaces:**
- Produces:
  - `KSI_DEFINITION: string`
  - `ksiDefinitionNote(labels: Iterable<string | number>): string | null`
  - `StatsMeasures.total_severe_injured?: number | null`
  - `Measure` gains `"ksi"`, and `MEASURE_LABELS.ksi = "Killed or Seriously Injured*"`

- [ ] **Step 1: Write the failing test.** Create `frontend/src/lib/ksi.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { KSI_DEFINITION, ksiDefinitionNote } from "./ksi";

describe("ksiDefinitionNote", () => {
  it("annotates ranges that cross 2015→2016", () => {
    expect(ksiDefinitionNote(["2014", "2015", "2016"])).toBe(`* ${KSI_DEFINITION}`);
    expect(ksiDefinitionNote([2010, 2020])).toBe(`* ${KSI_DEFINITION}`);
  });

  it("annotates ranges that cross 2017→2018 only", () => {
    expect(ksiDefinitionNote(["2017", "2018", "2019"])).toBe(`* ${KSI_DEFINITION}`);
  });

  it("stays quiet when no boundary is crossed", () => {
    expect(ksiDefinitionNote(["2019", "2020", "2025"])).toBeNull();
    expect(ksiDefinitionNote(["2001", "2014"])).toBeNull();
    expect(ksiDefinitionNote(["2016", "2017"])).toBeNull();
  });

  it("ignores empty and non-year labels", () => {
    expect(ksiDefinitionNote([])).toBeNull();
    expect(ksiDefinitionNote(["Fresno", "Kern"])).toBeNull();
  });

  it("names both boundaries in the shared text", () => {
    expect(KSI_DEFINITION).toContain("2015→2016");
    expect(KSI_DEFINITION).toContain("2017→2018");
  });
});
```

- [ ] **Step 2: Run the test.** `npx vitest run src/lib/ksi.test.ts`. Expected: FAIL with `Failed to resolve import "./ksi"`.

- [ ] **Step 3: Implement.** Create `frontend/src/lib/ksi.ts`:

```ts
/**
 * KSI (killed or seriously injured) wording. One string, used by the year
 * chart footnote (ChartCard) and the Stats hero tile tooltip (JargonTerm's
 * KSI entry), and copied verbatim into docs/DATA_METHODOLOGY.md §5.6.
 * Change all three together.
 */
export const KSI_DEFINITION = `KSI = people killed or seriously injured. Before 2016 "seriously injured" is SWITRS's "severe injury". From 2016 it is CCRS's "suspected serious injury" plus the older "severe" code that agencies phased out through about 2025. The definitions are close but not identical, so compare years across 2015→2016 (and 2017→2018, when most agencies switched) with care.`;

/** Where the definition shifts: SWITRS→CCRS, then most agencies' KABCO switch. */
const BOUNDARIES: ReadonlyArray<readonly [number, number]> = [[2015, 2016], [2017, 2018]];

/** The asterisk footnote when the charted years span a definition change, else null. */
export function ksiDefinitionNote(labels: Iterable<string | number>): string | null {
  const years = [...labels]
    .map((l) => (typeof l === "number" ? l : Number.parseInt(l, 10)))
    .filter(Number.isInteger);
  if (years.length === 0) return null;
  const first = Math.min(...years);
  const last = Math.max(...years);
  return BOUNDARIES.some(([before, after]) => first <= before && last >= after)
    ? `* ${KSI_DEFINITION}`
    : null;
}
```

In `frontend/src/components/ui/JargonTerm.tsx`, add `import { KSI_DEFINITION } from "../../lib/ksi";` below the React import. Then replace

```ts
  KSI:
    "Killed or Seriously Injured — a standard traffic-safety measure counting crashes that result in a fatality or a severe injury.",
```

with

```ts
  // People, not crashes — and the definition shifts at 2015/16 and 2017/18.
  KSI: KSI_DEFINITION,
```

In `frontend/src/types/api.ts`, inside `StatsMeasures`, after `total_injured?: number | null;`, add:

```ts
  /** People seriously injured (KSI's "SI"); year/county/cause/severity/total groups only. */
  total_severe_injured?: number | null;
```

In `frontend/src/lib/dashboard/types.ts`, replace the `MEASURES` array with:

```ts
export const MEASURES = [
  "count", "killed", "injured", "ksi", "percentage",
  "fatality_rate", "yoy_change",
  "per_100k_population", "per_10k_licensed_drivers", "per_100_road_miles",
] as const;
```

Then add `ksi: "Killed or Seriously Injured*",` to `MEASURE_LABELS` after `injured: "Injuries",`.

In `frontend/src/lib/dashboard/anomaly.ts`, replace the `MEASURE_NOUNS` literal with:

```ts
const MEASURE_NOUNS: Record<string, string> = {
  count: "crashes", killed: "fatalities", injured: "injuries",
  ksi: "people killed or seriously injured",
  percentage: "%", fatality_rate: "deaths per 1,000 crashes", yoy_change: "YoY change",
};
```

Convert the two new files to CRLF, as in Task A2 Step 4, running the converter from `backend/`.

- [ ] **Step 4: Run the tests.** Run:

```bash
npx vitest run src/lib/ksi.test.ts src/components/ui/JargonTerm.test.tsx
npx tsc -b
```

Expected: tests pass and tsc is clean. (tsc passes because `MEASURE_LABELS` is the only `Record<Measure, …>`.)

- [ ] **Step 5: Commit.**

```bash
git add frontend/src/lib/ksi.ts frontend/src/lib/ksi.test.ts frontend/src/components/ui/JargonTerm.tsx frontend/src/types/api.ts frontend/src/lib/dashboard/types.ts frontend/src/lib/dashboard/anomaly.ts
git commit -m "feat(ksi): shared KSI definition text, footnote rule, ksi measure type"
```

## Task B2: `pickValue` for `ksi`

**Files:**
- Modify: `frontend/src/hooks/useDashboardData.ts:38-54`
- Test: `frontend/src/hooks/useDashboardData.test.tsx`

**Interfaces:**
- Consumes: `DimensionRow.total_killed` and `DimensionRow.total_severe_injured`.
- Produces: `dataBySlot["year:ksi"]`, where each value is `total_killed + total_severe_injured`.

- [ ] **Step 1: Write the failing test.** In `useDashboardData.test.tsx`, add `total_severe_injured` to both `YEAR_ROWS` entries:

```ts
const YEAR_ROWS = [
  { year: 2022, crash_count: 400, total_killed: 40, total_injured: 120, total_severe_injured: 60 },
  { year: 2023, crash_count: 500, total_killed: 25, total_injured: 125, total_severe_injured: 50 },
];
```

Then add inside `describe("useDashboardData", ...)`:

```ts
  it("ksi = killed + seriously injured, not all injuries", async () => {
    mockFetch();
    const charts: ChartSlot[] = [
      { id: "k", dimension: "year", measure: "ksi", chartType: "area", order: 0 },
    ];
    const { result } = renderHook(() => useDashboardData(charts, FILTERS), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.dataBySlot["year:ksi"].map((d) => d.value)).toEqual([100, 75]);
  });
```

- [ ] **Step 2: Run the test.** `npx vitest run src/hooks/useDashboardData.test.tsx`. Expected: FAIL with `expected [ 400, 500 ] to deeply equal [ 100, 75 ]`, because the value falls through to `crash_count`.

- [ ] **Step 3: Implement.** In `pickValue`, directly after the `if (measure === "injured") { ... }` block, add:

```ts
  if (measure === "ksi") {
    return (r.total_killed ?? 0) + (r.total_severe_injured ?? 0);
  }
```

- [ ] **Step 4: Run the tests.** `npx vitest run src/hooks/useDashboardData.test.tsx`. Expected: all pass.

- [ ] **Step 5: Commit.**

```bash
git add frontend/src/hooks/useDashboardData.ts frontend/src/hooks/useDashboardData.test.tsx
git commit -m "feat(ksi): dashboard ksi measure value"
```

## Task B3: Offer `ksi` only on the year axis

**Files:**
- Modify: `frontend/src/components/stats/ChartConfigPanel.tsx`: `SUPPORTED_MEASURES` (lines 42-49), `handleDimensionChange` (lines 73-78), the two `SUPPORTED_MEASURES` usages (lines 115 and 131)
- Test: `frontend/src/components/stats/ChartConfigPanel.test.tsx` (create)

**Interfaces:**
- Produces: `measureOptions(dim: Dimension): { value: Measure; label: string }[]` (module-private).

- [ ] **Step 1: Write the failing test.** Create `frontend/src/components/stats/ChartConfigPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChartConfigPanel from "./ChartConfigPanel";
import { MEASURE_LABELS } from "../../lib/dashboard/types";

function renderPanel() {
  render(<ChartConfigPanel onConfirm={vi.fn()} onCancel={vi.fn()} />);
  return screen.getByLabelText("Dimension (X Axis)");
}

describe("ChartConfigPanel KSI option", () => {
  it("offers KSI on the year axis", () => {
    fireEvent.change(renderPanel(), { target: { value: "year" } });
    expect(screen.getAllByRole("option", { name: MEASURE_LABELS.ksi }).length).toBeGreaterThan(0);
  });

  it("does not offer KSI elsewhere and drops it when leaving year", () => {
    const dim = renderPanel();
    fireEvent.change(dim, { target: { value: "year" } });
    fireEvent.change(screen.getByLabelText("Measure (Y Axis)"), { target: { value: "ksi" } });
    fireEvent.change(dim, { target: { value: "county" } });
    expect(screen.queryByRole("option", { name: MEASURE_LABELS.ksi })).toBeNull();
    expect((screen.getByLabelText("Measure (Y Axis)") as HTMLSelectElement).value).toBe("count");
  });
});
```

- [ ] **Step 2: Run the test.** `npx vitest run src/components/stats/ChartConfigPanel.test.tsx`. Expected: FAIL. `getAllByRole` finds no option named "Killed or Seriously Injured*".

- [ ] **Step 3: Implement.** In `ChartConfigPanel.tsx`, directly after the `SUPPORTED_MEASURES` array, add:

```ts
// KSI is offered on the year axis only: that is the chart its definition
// footnote is written for (the API also returns it for county/cause/severity).
function measureOptions(dim: Dimension): { value: Measure; label: string }[] {
  return dim === "year"
    ? [...SUPPORTED_MEASURES, { value: "ksi", label: MEASURE_LABELS.ksi }]
    : SUPPORTED_MEASURES;
}
```

Replace `handleDimensionChange` with:

```ts
  function handleDimensionChange(dim: Dimension) {
    setDimension(dim);
    setChartType(defaultChartType(dim));
    setSecondaryMeasure(undefined);
    setOptions({});
    if (dim !== "year" && measure === "ksi") setMeasure("count");
  }
```

In the primary measure `<select>`, replace `{SUPPORTED_MEASURES.map((m) => (` with `{measureOptions(dimension).map((m) => (`. In the secondary `<select>`, replace `{SUPPORTED_MEASURES.filter((m) => m.value !== measure).map((m) => (` with `{measureOptions(dimension).filter((m) => m.value !== measure).map((m) => (`.

Convert the new test to CRLF.

- [ ] **Step 4: Run the tests.** Run:

```bash
npx vitest run src/components/stats/ChartConfigPanel.test.tsx
npx eslint src/components/stats/ChartConfigPanel.tsx src/components/stats/ChartConfigPanel.test.tsx
```

Expected: pass, and eslint is clean.

- [ ] **Step 5: Commit.**

```bash
git add frontend/src/components/stats/ChartConfigPanel.tsx frontend/src/components/stats/ChartConfigPanel.test.tsx
git commit -m "feat(ksi): offer the KSI measure on year charts"
```

## Task B4: NLQ synonyms

**Files:**
- Modify: `frontend/src/lib/dashboard/nlqParser.ts:19-29` (`MEASURE_SYNONYMS`) and `:99-104` (`resolveNlq`)
- Test: `frontend/src/lib/dashboard/nlqParser.test.ts`

**Interfaces:**
- Produces: `parseNlq(...).measure === "ksi"` for "ksi", "serious injuries", "seriously injured" and "killed or seriously injured". `resolveNlq` maps `ksi` on a non-year dimension to `killed`.

- [ ] **Step 1: Write the failing test.** Append inside the top-level `describe("nlqParser", ...)` of `nlqParser.test.ts`:

```ts
  describe("KSI", () => {
    it("recognises KSI phrasings before the plain killed/injured words", () => {
      expect(parseNlq("serious injuries by year").measure).toBe("ksi");
      expect(parseNlq("killed or seriously injured over time").measure).toBe("ksi");
      expect(parseNlq("ksi yearly").measure).toBe("ksi");
      expect(parseNlq("injuries by year").measure).toBe("injured");
    });

    it("keeps KSI on the year axis only", () => {
      expect(resolveNlq(parseNlq("ksi by year"))?.measure).toBe("ksi");
      expect(resolveNlq(parseNlq("ksi by county"))?.measure).toBe("killed");
    });
  });
```

- [ ] **Step 2: Run the test.** `npx vitest run src/lib/dashboard/nlqParser.test.ts`. Expected: FAIL. "serious injuries by year" resolves to `injured`, not `ksi`.

- [ ] **Step 3: Implement.** Make these the first line of `MEASURE_SYNONYMS`. They must precede the `killed`/`injuries` entries because `matchFirst` takes the first substring hit.

```ts
  ["killed or seriously injured", "ksi"], ["seriously injured", "ksi"], ["serious injuries", "ksi"], ["ksi", "ksi"],
```

Replace `resolveNlq` with:

```ts
export function resolveNlq(result: NlqResult): { dimension: Dimension; measure: Measure; chartType: ChartType; options: ChartOptions } | null {
  const dimension = result.dimension ?? "year";
  // KSI is year-only (see ChartConfigPanel); elsewhere show deaths instead.
  const measure = result.measure === "ksi" && dimension !== "year" ? "killed" : result.measure ?? "count";
  const chartType = result.chartType ?? defaultChartType(dimension);
  if (result.confidence === "low") return null;
  return { dimension, measure, chartType, options: result.options };
}
```

- [ ] **Step 4: Run the tests.** `npx vitest run src/lib/dashboard/nlqParser.test.ts`. Expected: all pass.

- [ ] **Step 5: Commit.**

```bash
git add frontend/src/lib/dashboard/nlqParser.ts frontend/src/lib/dashboard/nlqParser.test.ts
git commit -m "feat(ksi): natural-language chart requests understand KSI"
```

## Task B5: Year-chart definition footnote

**Files:**
- Modify: `frontend/src/components/stats/ChartCard.tsx`: import at line 26, `partialNote` at lines 344-348, render at lines 566-568
- Test: `frontend/src/components/stats/ChartCard.partialYear.test.tsx`

**Interfaces:**
- Consumes: `ksiDefinitionNote` from `../../lib/ksi`, and `slot.measure` / `slot.secondaryMeasure`.

- [ ] **Step 1: Write the failing test.** Append to `ChartCard.partialYear.test.tsx`:

```tsx
describe("ChartCard KSI definition footnote", () => {
  const ksiSlot: ChartSlot = { ...yearSlot, measure: "ksi" };
  const years = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => ({ label: String(from + i), value: 100 + i }));

  it("shows the footnote on a KSI year chart crossing 2015→2016", () => {
    renderCard(ksiSlot, years(2012, 2019));
    expect(screen.getByText(/^\* KSI = people killed or seriously injured/)).toBeInTheDocument();
  });

  it("hides it when the range crosses neither boundary", () => {
    renderCard(ksiSlot, years(2019, 2024));
    expect(screen.queryByText(/KSI = people killed/)).toBeNull();
  });

  it("hides it for non-KSI measures", () => {
    renderCard(yearSlot, years(2012, 2019));
    expect(screen.queryByText(/KSI = people killed/)).toBeNull();
  });

  it("shows it when KSI is the secondary measure", () => {
    renderCard({ ...yearSlot, chartType: "line", secondaryMeasure: "ksi" }, years(2012, 2019));
    expect(screen.getByText(/^\* KSI = people killed or seriously injured/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test.** `npx vitest run src/components/stats/ChartCard.partialYear.test.tsx`. Expected: FAIL. The first test cannot find the footnote text.

- [ ] **Step 3: Implement.** Below `import { partialYearNote } from "../../lib/partialYear";`, add:

```ts
import { ksiDefinitionNote } from "../../lib/ksi";
```

Directly after the `partialNote` declaration, add:

```ts
  // KSI's definition changes at 2015→2016 and 2017→2018; say so on any KSI
  // year chart whose range crosses either.
  const ksiNote = slot.dimension === "year" && (slot.measure === "ksi" || slot.secondaryMeasure === "ksi")
    ? ksiDefinitionNote(data.map((d) => d.label))
    : null;
```

Directly after the existing `partialNote` paragraph block, add:

```tsx
      {!loading && hasData && ksiNote && (
        <p className="text-[10px] italic text-on-surface-variant mt-1.5">{ksiNote}</p>
      )}
```

- [ ] **Step 4: Run the tests.** Run:

```bash
npx vitest run src/components/stats/ChartCard.partialYear.test.tsx src/components/stats/ChartCard.test.tsx
```

Expected: all pass. The secondary-measure case needs no `secondaryData`, because `hasData` (`ChartCard.tsx:290`) derives from `data` alone.

- [ ] **Step 5: Commit.**

```bash
git add frontend/src/components/stats/ChartCard.tsx frontend/src/components/stats/ChartCard.partialYear.test.tsx
git commit -m "feat(ksi): definition footnote on KSI year charts that cross 2015/16 or 2017/18"
```

## Task B6: Hero metric becomes true KSI

**Files:**
- Modify: `frontend/src/hooks/useStats.ts`, at these places:
  - imports (lines 1-5);
  - `YearlyDataPoint` (line 26);
  - `HeroMetrics` (lines 34-39);
  - `YearRow` (line 69);
  - `buildDemoUrl` (lines 146-155);
  - `CURRENT_YEAR` and `computeHeroMetrics` (lines 165-192);
  - the `yearlyData` map (lines 283-285);
  - the hero call (lines 324-332).
- Test: `frontend/src/hooks/useStats.test.tsx`

**Interfaces:**
- Consumes: `fillDemographicYears<T extends CountyYearDemo>(rows: T[], years: Set<number>): { rows: T[]; estimated: Map<number, number> }` from `./useChoroplethData`, and `excludePartialYear` from `../lib/partialYear`. Also `/api/demographics?nearest=true`.
- Produces:
  - `computeHeroMetrics(yearRows: YearRow[], demoRows: DemoRow[] | null): HeroMetrics`. The signature changes from `popByYear: Map<number, number> | null`; the only caller is `useStats` and the tests.
  - `HeroMetrics.ksiPopEstimatedFrom?: number[]`.
  - `YearlyDataPoint.severeInjured: number`.

- [ ] **Step 1: Write the failing tests.** In `useStats.test.tsx`:

(a) Replace `YEAR_ROWS` with:

```ts
const YEAR_ROWS = [
  { year: 2022, crash_count: 400_000, total_killed: 3800, total_injured: 120_000, total_severe_injured: 14_000 },
  { year: 2023, crash_count: 420_000, total_killed: 3600, total_injured: 125_000, total_severe_injured: 15_000 },
];
```

(b) In "fires batch POST + demographics GET", before the closing `});`, add:

```ts
    const demoCall = spy.mock.calls.find(c => String(c[0]).includes("/api/demographics"));
    expect(String(demoCall![0])).toContain("nearest=true");
```

(c) In "maps API responses to chart data shapes", replace the `yearlyData[0]` expectation with:

```ts
    expect(data.yearlyData[0]).toEqual({ year: 2022, count: 400_000, killed: 3800, injured: 120_000, severeInjured: 14_000 });
```

(d) In "computes hero metrics from year data", replace the last two lines with:

```ts
    // KSI = (7,400 killed + 29,000 seriously injured) / 3,250,000 pop * 100k = 1120.0
    expect(hero.ksiRatePer100k).toBeCloseTo(1120.0, 1);
    expect(hero.ksiPopEstimatedFrom).toBeUndefined();
```

(e) Replace the whole `describe("computeHeroMetrics killed + injured rate", ...)` block with:

```ts
describe("computeHeroMetrics KSI rate", () => {
  const CUR = new Date().getFullYear();
  const row = (year: number, killed: number, severe: number, injured = 5_000) =>
    ({ year, crash_count: 1, total_killed: killed, total_injured: injured, total_severe_injured: severe });
  const demo = (year: number, population: number | null) => ({ county_code: 19, year, population });

  it("counts killed + seriously injured people, never all injuries", () => {
    const hero = computeHeroMetrics([row(2022, 10, 90, 50_000)], [demo(2022, 100_000)]);
    expect(hero.ksiRatePer100k).toBe(100); // (10 + 90) / 100,000 * 100k
  });

  it("excludes the partial current year from the rate", () => {
    const hero = computeHeroMetrics(
      [row(CUR - 1, 100, 900), row(CUR, 5_000, 5_000)],
      [demo(CUR - 1, 1_000_000), demo(CUR, 1_000_000)],
    );
    expect(hero.ksiRatePer100k).toBe(100);
  });

  it("fills years without census population from the nearest census year and says so", () => {
    const hero = computeHeroMetrics([row(2021, 100, 900), row(2022, 100, 900)], [demo(2021, 1_000_000)]);
    // 2022 borrows 2021's 1,000,000 → 2,000 people / 2,000,000 = 100 per 100K
    expect(hero.ksiRatePer100k).toBe(100);
    expect(hero.ksiPopEstimatedFrom).toEqual([2021]);
  });

  it("leaves the rate unset without population", () => {
    expect(computeHeroMetrics([row(2022, 1, 1)], null).ksiRatePer100k).toBeUndefined();
    expect(computeHeroMetrics([row(2022, 1, 1)], []).ksiRatePer100k).toBeUndefined();
    expect(computeHeroMetrics([row(2022, 1, 1)], [demo(2022, null)]).ksiRatePer100k).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests.** `npx vitest run src/hooks/useStats.test.tsx`. Expected: FAIL. `nearest=true` is missing, the `severeInjured` key is missing, `ksiRatePer100k` is 7766.2 instead of 1120, and the new `describe` fails its type/value assertions.

- [ ] **Step 3: Implement** in `frontend/src/hooks/useStats.ts`.

Add these imports below the existing ones:

```ts
import { excludePartialYear } from "../lib/partialYear";
import { fillDemographicYears } from "./useChoroplethData";
```

Replace `YearlyDataPoint` and `HeroMetrics` with:

```ts
export interface YearlyDataPoint { year: number; count: number; killed: number; injured: number; severeInjured: number }
```

```ts
export interface HeroMetrics {
  totalIncidents?: number;
  incidentYoYPct?: number;
  ksiRatePer100k?: number;
  /** Census years whose population stood in for years without one (nearest year). */
  ksiPopEstimatedFrom?: number[];
  yoyFatalityChangePct?: number;
}
```

Replace the `YearRow` type with:

```ts
type YearRow = { year: number; crash_count: number; total_killed: number; total_injured: number; total_severe_injured?: number };
```

Replace `buildDemoUrl` with:

```ts
function buildDemoUrl(filters: StatsFilters): string {
  const p = new URLSearchParams();
  if (filters.dateRange) {
    if (filters.dateRange.start) p.set("start", formatYearMonth(filters.dateRange.start));
    if (filters.dateRange.end) p.set("end", formatYearMonth(filters.dateRange.end));
    // Years past the latest ACS release come back as the nearest census year,
    // same as the map (useChoroplethData.buildDemoUrl).
    p.set("nearest", "true");
  }
  if (filters.counties.length) p.set("county", filters.counties.join(","));
  const qs = p.toString();
  return `${API_BASE}/api/demographics${qs ? `?${qs}` : ""}`;
}
```

Delete `const CURRENT_YEAR = new Date().getFullYear();`. Replace the doc comment and `computeHeroMetrics` with:

```ts
/** Hero numbers. KSI = people killed or seriously injured, per 100K residents
 *  a year, over complete years only (the in-progress year is excluded; deaths
 *  lag months). Crash years without census population borrow the nearest
 *  census year, as the map does, and ksiPopEstimatedFrom names those years so
 *  the tile can say so. */
export function computeHeroMetrics(yearRows: YearRow[], demoRows: DemoRow[] | null): HeroMetrics {
  if (!yearRows.length) return {};
  const totalIncidents = yearRows.reduce((s, r) => s + r.crash_count, 0);
  const complete = excludePartialYear(yearRows).sort((a, b) => a.year - b.year);
  const hero: HeroMetrics = { totalIncidents };

  if (demoRows && demoRows.length > 0 && complete.length > 0) {
    const { rows, estimated } = fillDemographicYears(demoRows, new Set(complete.map((r) => r.year)));
    const popByYear = new Map<number, number>();
    for (const r of rows) {
      if (r.population) popByYear.set(r.year, (popByYear.get(r.year) ?? 0) + r.population);
    }
    const matched = complete.filter((r) => popByYear.has(r.year));
    const pop = matched.reduce((s, r) => s + popByYear.get(r.year)!, 0);
    if (pop > 0) {
      const ksi = matched.reduce((s, r) => s + r.total_killed + (r.total_severe_injured ?? 0), 0);
      hero.ksiRatePer100k = Math.round((ksi / pop) * 100_000 * 10) / 10;
      const sources = [...new Set(
        [...estimated].filter(([year]) => popByYear.has(year)).map(([, source]) => source),
      )].sort((a, b) => a - b);
      if (sources.length > 0) hero.ksiPopEstimatedFrom = sources;
    }
  }

  if (complete.length >= 2) {
    const prev = complete[complete.length - 2];
    const curr = complete[complete.length - 1];
    if (prev.crash_count > 0) {
      hero.incidentYoYPct = Math.round(((curr.crash_count - prev.crash_count) / prev.crash_count) * 1000) / 10;
    }
    if (prev.total_killed > 0) {
      hero.yoyFatalityChangePct = Math.round(((curr.total_killed - prev.total_killed) / prev.total_killed) * 1000) / 10;
    }
  }
  return hero;
}
```

Replace the `yearlyData` mapping with:

```ts
    const yearlyData: YearlyDataPoint[] = rows<YearRow>(b.year).map((r) => ({
      year: r.year, count: r.crash_count, killed: r.total_killed, injured: r.total_injured,
      severeInjured: r.total_severe_injured ?? 0,
    }));
```

Replace the whole `let popByYear ... computeHeroMetrics(rows<YearRow>(b.year), popByYear);` block with:

```ts
    const heroMetrics = computeHeroMetrics(rows<YearRow>(b.year), demoQuery.data ?? null);
```

- [ ] **Step 4: Run the tests.** Run:

```bash
npx vitest run src/hooks/useStats.test.tsx src/hooks/useChoroplethData.fill.test.ts
npx tsc -b
```

Expected: tests pass and tsc is clean.

- [ ] **Step 5: Commit.**

```bash
git add frontend/src/hooks/useStats.ts frontend/src/hooks/useStats.test.tsx
git commit -m "feat(ksi): hero rate is killed + seriously injured, complete years, nearest-census denominator"
```

## Task B7: Stats hero tile, JSON-LD, e2e

**Files:**
- Modify: `frontend/src/pages/StatsPage.tsx`: line 352 (destructure), line 368 (`sparkKsi`), lines 531-552 (tile)
- Modify: `frontend/src/components/seo/JsonLd.tsx:98`
- Test: `frontend/tests/dashboard-full.spec.ts:12`

**Interfaces:**
- Consumes: `HeroMetrics.ksiRatePer100k`, `HeroMetrics.ksiPopEstimatedFrom` and `YearlyDataPoint.severeInjured`. `JargonTerm` (already imported at line 57).
- Produces: a hero group with aria-label `"Killed or seriously injured per 100K population"`.

- [ ] **Step 1: Write the failing e2e check.** In `frontend/tests/dashboard-full.spec.ts`, replace

```ts
    await expect(page.locator("text=Killed + Injured / 100K Pop.")).toBeVisible();
```

with

```ts
    await expect(page.getByRole("group", { name: "Killed or seriously injured per 100K population" })).toBeVisible();
```

- [ ] **Step 2: Run it.** `npx playwright test tests/dashboard-full.spec.ts -g "hero metrics visible" --reporter=line`. Expected: FAIL, because the old group label is "Killed and injured per 100K population".

- [ ] **Step 3: Implement.** In `StatsPage.tsx`, replace

```ts
  const { totalIncidents, incidentYoYPct, ksiRatePer100k, yoyFatalityChangePct } = heroMetrics;
```

with

```ts
  const { totalIncidents, incidentYoYPct, ksiRatePer100k, ksiPopEstimatedFrom, yoyFatalityChangePct } = heroMetrics;
```

Then replace

```ts
  const sparkKsi = useMemo(() => completeYearly.map((d) => d.killed + d.injured), [completeYearly]);
```

with

```ts
  const sparkKsi = useMemo(() => completeYearly.map((d) => d.killed + d.severeInjured), [completeYearly]);
```

Replace the entire tile (from the comment `{/* Killed + injured rate. Not true KSI: ...` through its closing `</div>` before `{/* YoY Fatality Change */}`) with:

```tsx
        {/* KSI: people killed or seriously injured per 100K residents a year,
            complete years only (computeHeroMetrics). The KSI term's tooltip
            carries the definition footnote. */}
        <div className="bg-surface-container-lowest rounded-xl p-4 sm:p-6 ambient-shadow" role="group" aria-label="Killed or seriously injured per 100K population">
          <div className="flex items-start justify-between mb-3 sm:mb-4">
            <p className="text-on-surface-variant text-xs font-semibold uppercase tracking-widest leading-tight">
              <JargonTerm term="KSI" /> / 100K Pop.*
            </p>
            {!loading && sparkKsi.length >= 2 && (
              <Sparkline data={sparkKsi} label="Killed or seriously injured trend, last 10 years" />
            )}
          </div>
          {loading ? (
            <Skeleton className="h-10 w-24" />
          ) : (
            <p className="text-3xl sm:text-4xl font-headline font-bold text-on-surface tracking-tight hero-value" role="img" aria-label={`Killed or seriously injured rate: ${ksiRatePer100k != null ? ksiRatePer100k.toFixed(1) : "unavailable"} per 100K`}>
              {ksiRatePer100k != null ? ksiRatePer100k.toFixed(1) : "—"}
            </p>
          )}
          <p className="text-on-surface-variant text-[11px] mt-2 italic">
            People killed or seriously injured, per 100K residents a year
          </p>
          {!loading && ksiPopEstimatedFrom && (
            <p className="text-on-surface-variant text-[10px] mt-1">
              Population for some years estimated from {ksiPopEstimatedFrom.join(", ")} census
            </p>
          )}
        </div>
```

In `JsonLd.tsx`, replace

```ts
      { "@type": "PropertyValue", name: "Killed and Injured per 100K Population", unitCode: "P1" },
```

with

```ts
      { "@type": "PropertyValue", name: "Killed or Seriously Injured per 100K Population", unitCode: "P1" },
```

- [ ] **Step 4: Run the tests.** Run:

```bash
npx playwright test tests/dashboard-full.spec.ts -g "hero metrics visible" --reporter=line
npx tsc -b
npx eslint src/pages/StatsPage.tsx src/components/seo/JsonLd.tsx tests/dashboard-full.spec.ts
```

Expected: the e2e test passes (it is hermetic and needs no backend), tsc is clean and eslint is clean.

- [ ] **Step 5: Commit.**

```bash
git add frontend/src/pages/StatsPage.tsx frontend/src/components/seo/JsonLd.tsx frontend/tests/dashboard-full.spec.ts
git commit -m "feat(ksi): Stats hero tile shows true KSI per 100K with definition tooltip"
```

## Task B8: Full check, browser pass, PR B, verify

- [ ] **Step 1: Run the full frontend suite.** From `frontend/`:

```bash
npx eslint .
npx tsc -b
npx vitest run
npm run build
npx playwright test --reporter=line
```

Expected: everything is green, including `iconSubset.test.ts` (no new icons).

- [ ] **Step 2: Real-browser pass.** Run the dev server (`npm run dev`, with the API proxy pointed at prod as usual) and open `/stats`. Check each of the following:
  1. The unfiltered tile reads "KSI / 100K POP.*" with a value that should be roughly 45–60, since CCRS runs about 20k people a year over about 39M residents.
  2. Hovering or focusing "KSI" shows the full asterisk text, and the tooltip stays inside the viewport at 375px width.
  3. The note "Population for some years estimated from 2005, 2023 census" appears when unfiltered, because 2001–2004 borrow 2005 and 2024–2025 borrow 2023.
  4. With a 2019–2022 date range, the note disappears.
  5. The KSI sparkline has no plunge at the end, because the partial year is excluded.
  6. Add a chart (Year × "Killed or Seriously Injured*"). It shows the `* KSI = ...` footnote over the full range, and no footnote with a 2019–2025 range.
  7. With a county dimension selected, the measure list has no KSI.
  8. Typing "serious injuries by year" in the NLQ box makes a KSI year chart.
  9. Dark mode and mobile width both render cleanly.

Trust the DOM over screenshots: use `read_page`/`find` to confirm the label text.

- [ ] **Step 3: Push, open the PR and merge** (no AI attribution):

```bash
git push -u origin feat/ksi-frontend
gh pr create --base main --head feat/ksi-frontend --title "KSI frontend: true KSI hero tile, ksi year measure, definition footnote" --body "$(cat <<'EOF'
Turns the Stats hero tile into true KSI (people killed or seriously injured per 100K residents a year) now that /api/stats returns total_severe_injured for every year 2001+.

- Hero: complete years only; crash years without census population use the nearest census year (same as the map) and the tile says which.
- Dashboard: new "Killed or Seriously Injured*" measure on year charts, with the definition footnote whenever the range crosses 2015/16 or 2017/18.
- One shared definition string (lib/ksi.ts) for the footnote and the KSI tooltip; the methodology doc carries the same text.
- NLQ understands "ksi" / "serious injuries".

Browser pass done (desktop + 375px, light + dark).
EOF
)"
gh pr checks --watch
gh pr merge <n> --merge --admin --delete-branch
```

- [ ] **Step 4: Prod check after the deploy.** Open https://calsight.org/stats and repeat checks 1, 2 and 6 from Step 2. Then run the monitoring check: site 200, `/api/health` ok, `/api/freshness` not stale, and zero failed workflow runs.

---

## Self-Review

**Spec coverage.** Every spec section maps to a task.

| Spec § | Requirement | Task |
|---|---|---|
| 2 | Wording and asterisk text | B1 (`KSI_DEFINITION`), A8 (§5.6) |
| 2 | Column-existence assert on first run | A5 `assert_severe_column` |
| 3 | Measured numbers as checks | R1 Step 2 (exact table), R2 Step 2 (plausibility) |
| 4 | Column, DEFAULT 0 NOT NULL, not in `_UPSERT_COLUMNS` | A1 (test asserts the exclusion), A2 |
| 4 | Autocommit + lock_timeout; `_new` WITH DATA swap; index renames; `mv_crash_rates`; marker; downgrade | A2 |
| 4 | Validation check when a complete year sums to 0 | A7 |
| 5 | SWITRS module: stream per year, fold, dedupe, batches of 5,000, `IS DISTINCT FROM`, verify / fail < 99% or 0 | A5; run in R2 |
| 6 | `backfill_severe_injured`, `SERIOUS_INJURY_CODES`, two passes, commit per year, `since_year` | A3 |
| 6 | `jobs.py` dependency | A4 |
| 6 | Docs (`DATA_DICTIONARY.md:142`, `models.py:280`) | A1, A8 |
| 7 | Router columns and selects; row fields | A6 (month skipped; see note 3) |
| 7 | Hero tile | B6, B7. Owner decisions replace the spec's "restrict to 2005–2023 + show span" with the nearest-census fill plus note, and add partial-year exclusion |
| 7 | Year chart `ksi` measure, `pickValue`, config panel year-only, `DimensionRow` field, NLQ, footnote | B1–B5 |
| 7 | Shading band | Not built (owner decision 1) |
| 8 | Tests | Every listed test exists: A3 (both codes, excluded codes, reset, second run 0, `since_year`), A5 (> 2**63 folded, second run 0, negatives), A2 (graph + guard), A6 (stats paths), B6/B2/B1+B5 (frontend) |
| 9 | Rollout, R2 pre-flight | A9 (pre-flight, PR A), R1–R2 (manual runs), PR B (B8) |
| 9 | Rollback | See note 7 |

**Placeholder scan.** The only literal placeholder is `<rev>` / `<generated>` in Task A2. It is unavoidable: the constraint requires `alembic revision` to mint the ID, and Step 1 says exactly where it comes from. No "TBD", "similar to", or "add error handling" steps remain.

**Type and name consistency** (checked against the code as it stands on main @ c5d481f):
- `SERIOUS_INJURY_CODES` and `backfill_severe_injured(db, since_year=None) -> (int, int)` are used identically in A3's code and both A3 test files.
- `apply_year` returns a 3-tuple in both the module and the tests.
- `read_severe_counts` returns `dict[int, int]`.
- `total_severe_injured` is spelled the same in the migration SQL, the router `Column`s, the schemas, the test JSON keys, `StatsMeasures`, and `YearRow` in `useStats`.
- `computeHeroMetrics(yearRows, demoRows)` has exactly one caller (useStats) plus the tests, and both are updated.
- `DemoRow` (`{county_code, year, population: number | null}`) satisfies `fillDemographicYears<T extends CountyYearDemo>`.
- `Measure` gains `"ksi"`; `MEASURE_LABELS` is the only `Record<Measure, …>`; `MEASURE_NOUNS` and `measureAlternatives` are `Record<string, …>` and fall back safely.
- `useChoroplethData.ts` does not import `useStats`, so the new import creates no cycle.

**Deliberate deviations and facts that contradict the spec** (fixed inline above):
1. **The deploy does NOT run a full `backfill_derived`.** `deploy.yml:344` runs `python -m etl.backfill_derived` with no args. `main()` maps that to `run(daily=True)`, scoped to `MAX(crash_year) - 1`, so only 2025+ would be filled on deploy. Task R1 adds an explicit `--full` run before the SWITRS job.
2. **No `@track_etl_run("switrs_ksi")`.** Any `etl_runs` source appears in `/api/freshness`, where unknown sources get the 168h default threshold (`app/freshness_logic.py:26`). It would read stale a week later, breaking the "freshness not stale" check-in, and `prune_legacy_sources` treats it as a zombie. The Actions log is the record instead.
3. **Month is not in the router changes.** The spec lists "month-on-wide", but `MonthRow` is not among its schema changes, and the standard month path reads `mv_crashes_by_month`, which gets no column. Adding it on the wide path only would make month KSI appear or disappear depending on filters. Nothing reads it (YAGNI).
4. **No CASCADE on DROP.** `mv_crash_rates` is dropped explicitly first, and the old views are dropped without CASCADE, so an unexpected dependent fails the migration instead of vanishing.
5. **lock_timeout scope.** A plain `SET lock_timeout` inside the autocommit block is session-level and would leak into the swap transaction. The migration RESETs it and uses `SET LOCAL lock_timeout = '60s'` for the swap. ADD COLUMN is raw `IF NOT EXISTS` so a re-run after a timeout works (`op.add_column` would fail, since the column is already committed).
6. **`jobs.py` does add a failure mode.** The spec says "no new failure mode". But if `victims` fails, `backfill` is now skipped, and with it `backfill_conditions` and `data_quality`, not just `matviews` as today.
7. **Rollback** follows the spec §9 unchanged: PR B is a plain revert; for PR A, revert the code and leave the column (additive). `downgrade()` exists and was round-tripped locally (A2 Step 6).
8. **JargonTerm's KSI glossary said "counting crashes".** It is corrected to the people-based definition (B1).
9. **Known limitation, not fixed.** Per `DATA_METHODOLOGY.md` §7.3, 2005–2009 ACS 1-year covers only counties over 65k. `fillDemographicYears` fills whole missing years, not missing counties within a year, so the statewide denominator for 2005–2009 is slightly low and the rate slightly high for those years. This is small. The fix would be per-county nearest fill, which is out of scope.
10. **Spec numbers.** Spec §3 "KSI people" uses Fatal victims, while the tile uses `number_killed`. They differ by ±2 a year (R1 Step 2 notes this).
