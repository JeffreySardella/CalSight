# Spec: a real KSI series (Killed or Seriously Injured people)

Status: draft for owner review. Nothing implemented. Numbers measured read-only on prod 2026-09-18.

## 1. Goal

Add a per-crash count of **seriously injured people** so CalSight can report true KSI = killed + seriously injured **people**, 2001 to present, through the same filter path as every other `/api/stats` measure. Three things use it:

1. **Stats hero tile.** Today it is `(killed + ALL injured) / population` (`frontend/src/hooks/useStats.ts:172`, sparkline `pages/StatsPage.tsx:368`). The stopgap PR relabels it "Killed + injured / 100K". This spec turns it back into a true KSI tile.
2. **Dashboard year chart.** New `ksi` measure.
3. **2015/2016 annotation.** A footnote where the definition changes.

Out of scope (YAGNI): KSI on the map/choropleth, the hour/weather/lighting/collision-type/DOW groupings (those `mv_crashes_wide` branches don't return killed/injured today either), the demographic dimensions, and `mv_crashes_by_month`/`mv_crash_rates` columns.

## 2. Definitions and user-facing wording

| Era | Source | "Seriously injured" means |
|---|---|---|
| 2001–2015 | SWITRS (Zenodo SQLite `collisions.severe_injury_count`, from raw `COUNT_SEVERE_INJ`) | "Severe injury" (the old SWITRS scale) |
| 2016+ | CCRS `crash_victims.injury_severity` | `SuspectSerious` (KABCO "A") **plus** `SevereInactive` (the retired pre-KABCO code, still in use by some agencies) |

"Killed" stays `crashes.number_killed` in both eras. For CCRS it agrees with victim `Fatal` rows to within ±2/yr (e.g. 2022: 4,661 vs 4,659).

The column was confirmed in upstream `agude/SWITRS-to-SQLite` `src/switrs_to_sqlite/row_types.py` (`COUNT_SEVERE_INJ` → `severe_injury_count`, next to `killed_victims`/`injured_victims`). The first backfill run asserts the column exists and fails loudly if it doesn't.

**Asterisk text** (chart footnote, hero tile tooltip, methodology doc):

> \* KSI = people killed or seriously injured. Before 2016 "seriously injured" is SWITRS's "severe injury". From 2016 it is CCRS's "suspected serious injury" plus the older "severe" code that agencies phased out through about 2025. The definitions are close but not identical, so compare years across 2015→2016 (and 2017→2018, when most agencies switched) with care.

## 3. Measured numbers (prod, read-only)

CCRS seriously-injured and killed **victims** by crash year (victims joined to crashes on `collision_id, data_source`):

| Year | Fatal | SevereInactive | SuspectSerious | Serious total | KSI people | SevereInactive share |
|---|---|---|---|---|---|---|
| 2016 | 3,919 | 13,528 | 11 | 13,539 | 17,458 | 99.9% |
| 2017 | 3,965 | 11,928 | 2,563 | 14,491 | 18,456 | 82% |
| 2018 | 3,867 | 6,045 | 10,515 | 16,560 | 20,427 | 37% |
| 2019 | 3,785 | 5,838 | 10,997 | 16,835 | 20,620 | 35% |
| 2020 | 4,081 | 5,068 | 10,789 | 15,857 | 19,938 | 32% |
| 2021 | 4,590 | 4,706 | 13,972 | 18,678 | 23,268 | 25% |
| 2022 | 4,659 | 3,084 | 15,314 | 18,398 | 23,057 | 17% |
| 2023 | 4,015 | 2,310 | 13,822 | 16,132 | 20,147 | 14% |
| 2024 | 4,015 | 1,916 | 15,266 | 17,182 | 21,197 | 11% |
| 2025 | 3,420 | 998 | 16,038 | 17,036 | 20,456 | 6% |
| 2026 (partial) | 1,269 | 402 | 9,672 | 10,074 | 11,343 | 4% |

What this shows:

- **SevereInactive never stops.** It tapers off by agency over about 10 years. Counting both codes is required, because either one alone produces a fake trend.
- **The real step is 2017→2018, not only 2015→2016.** Serious injuries rose 14% (14,491 → 16,560) in the year SuspectSerious overtook SevereInactive, while deaths fell. KABCO "suspected serious" is probably scored more generously than the old "severe". The footnote therefore names both boundaries.
- CCRS victim coverage is essentially complete. Only 0–9 injury crashes per year have no victim rows.

Sizes:

- `crashes` holds 11,603,526 rows: 12 GB total, 4.95 GB heap, 25 indexes. The DB is 25 GB.
- SWITRS 2001–2015 is 6,992,007 crashes (2001 = 522,562 after the ID fold).
- `demographics.population` covers **2005–2023 only**, 58 counties. This matters for the denominator (section 7).
- Last successful runs: `backfill` 14m05s, `matviews` 10m52s. The only matview dependency among the targets is `mv_crash_rates → mv_crashes_by_year`.

## 4. Data model and migration

Add `crashes.number_severe_injured SMALLINT NOT NULL DEFAULT 0` to `Crash` in `backend/app/models.py`, next to `number_killed`.

- **Why DEFAULT 0 NOT NULL and not nullable:** in PG11+ a constant default is metadata-only, so adding the column rewrites no rows. The backfills then write only crashes that have a seriously injured person (≈ 3% of rows) instead of rewriting all 11.6M. A nullable column needs every SWITRS row written to tell 0 apart from unknown. That is about 7M row versions, roughly 3 GB of heap bloat plus 25 index entries per row.
- **The cost:** "not backfilled yet" looks the same as 0. Two things cover it: the rollout order (section 9) exposes nothing until both backfills are verified, and a validation check fails if any complete year has `SUM(number_severe_injured) = 0`.
- `load_crashes._UPSERT_COLUMNS` is an explicit list. The new column stays out of it, so daily CCRS upserts never clobber it and new inserts get 0 until `backfill_derived` runs.

Migration: `down_revision = "77b8d6739669"` (the current single head). Generate the ID with `alembic revision` and don't invent a pattern ID. **Run `backend/tests/test_migration_graph.py` before pushing.** Contents, all in one migration:

1. `op.add_column(... server_default="0", nullable=False)`, **inside `with op.get_context().autocommit_block():` preceded by `SET lock_timeout = '5s'`**.
   - `migrations/env.py` runs the entire upgrade in one transaction. Without the autocommit block, ADD COLUMN's ACCESS EXCLUSIVE lock on `crashes` would be held through the matview builds (minutes), blocking `/api/crashes`, the map and the nightly ETL.
   - The lock_timeout stops it from queuing behind a long read and stalling everything behind it. If it times out, the deploy fails cleanly; re-run it.
2. Rebuild `mv_crashes_by_year`, `mv_crashes_by_cause` and `mv_crashes_wide`, each gaining `COALESCE(SUM(number_severe_injured),0)::integer AS total_severe_injured`. These are the only three views `/api/stats` and `/api/stats/batch` read for year, county, cause and grand totals under any filter combination (`_pick_view`, plus the `mv_wide` branch for involvement/condition filters, `app/routers/stats.py:177-486`).
   - **Avoid the empty-view window.** The old pattern (`DROP` + `CREATE ... WITH NO DATA`) leaves `/api/stats` returning errors from the migration until the deploy's refresh step. That step runs after the full `backfill_derived` and `backfill_conditions`, which is 30+ minutes.
   - Instead: `CREATE MATERIALIZED VIEW <name>_new ... WITH DATA`, create its indexes, then `DROP MATERIALIZED VIEW <old> CASCADE` (only `mv_crash_rates` depends on it), `ALTER ... RENAME TO`, and rename the indexes. The old views keep serving while the new ones build.
   - The build, drop and rename all run inside alembic's migration transaction, so the old views stay readable during the multi-minute build. ACCESS EXCLUSIVE on the old views is taken only at the DROP, near the end, and is held until commit, which also covers recreating the small `mv_crash_rates`.
   - Expect a few seconds of blocked (not failed) `/api/stats` reads.
3. Recreate `mv_crash_rates` with its definition unchanged, `WITH DATA`. It is small.
4. The `RENAME TO` trips `scripts/check_migration_expand_contract.py`. Add a `# migration-safety: matview swap, expand-only on crashes` marker.
5. `downgrade()`: rebuild the three views without the column and drop the column.

At migration time `total_severe_injured` is 0 everywhere. That's harmless, because no UI reads it yet.

A migration file change sets `check-backfill needed=true` in `deploy.yml`. That run does a full `backfill_derived`, then `backfill_conditions`, then refreshes the matviews, so the CCRS derivation (section 6) runs and the views are refreshed in the same deploy.

## 5. SWITRS backfill job: `backend/etl/backfill_switrs_ksi.py` (new, about 80 lines)

This module reuses `switrs_api.download_switrs_archive`, `_fold_case_id`, `_safe_int` and `_safe_count`, plus the loader's temp-dir cleanup pattern.

- **Stream:** one year at a time, `SELECT case_id, severe_injury_count FROM collisions WHERE collision_date LIKE ? AND severe_injury_count > 0`. This is only the non-zero rows, estimated 150–200k over 15 years, so memory stays flat.
- **Match with the same folded IDs:** `collision_id = _fold_case_id(_safe_int(case_id))`, exactly as `transform_switrs` does. Without the fold, 211,120 of 2001's rows would silently match nothing. Dedupe `case_id` per batch (last wins, same as the loader's upsert).
- **Write:** batches of 5,000 with
  `UPDATE crashes c SET number_severe_injured = v.n FROM unnest(:ids, :ns) AS v(id, n) WHERE c.collision_id = v.id AND c.data_source = 'switrs' AND c.number_severe_injured IS DISTINCT FROM v.n`.
  This uses `uq_crashes_collision_source`, commits per batch and is idempotent: a re-run writes 0 rows. The fast default already holds 0 for every other row.
- **Verify, and fail the job on mismatch:** per year, log source sum vs `SUM(number_severe_injured)` on `crashes` and matched vs unmatched counts. Unmatched rows are expected only where the loader skipped a null datetime. Fail if any year is 0 or the match rate is below 99%.
- **Runtime:** about 10–20 min, mostly download plus gunzip of the 1.3 GB archive (the same step `crashes_switrs` does). The updates are about 40 small batches per year and take minutes. Heap churn is ~200k row versions, which autovacuum absorbs.
- **Trigger:** manual one-off. It is not registered in `jobs.py`, because the source is static.
  `gh workflow run run-etl.yml -f job=backfill_switrs_ksi -f refresh_matviews=true`
  This runs on VM 101's runner through `docker compose exec backend`, with a 240-min timeout. Track it with `@track_etl_run("switrs_ksi")` so `etl_runs` records that it happened.

## 6. CCRS derivation in `backfill_derived.py`

Add `backfill_severe_injured(db, since_year)`, modelled on `_resync_party_flag`. It is year-by-year over `_ccrs_year_range(db)`, skips years below `since_year`, commits per year, and uses `IS DISTINCT FROM` guards, so a no-change run writes nothing.

- **Pass 1 (set):** `UPDATE crashes c SET number_severe_injured = v.n FROM (SELECT v.collision_id, count(*) n FROM crash_victims v JOIN crashes c2 ON c2.collision_id = v.collision_id AND c2.data_source = 'ccrs' WHERE v.data_source = 'ccrs' AND v.injury_severity IN ('SuspectSerious','SevereInactive') AND c2.crash_datetime >= :start AND c2.crash_datetime < :end GROUP BY 1) v WHERE c.collision_id = v.collision_id AND c.data_source = 'ccrs' AND c.number_severe_injured IS DISTINCT FROM v.n`
- **Pass 2 (reset):** set 0 where the stored value is > 0 and no qualifying victim remains. This handles victim amendments.
- Keep the two severity codes in one module constant `SERIOUS_INJURY_CODES`, with a comment citing the measured values.
- **Call order in `run()`:** after `backfill_severity` and before the party-flag resyncs.
- **Dependency fix (required):** in `jobs.py`, change the `backfill` job's `depends_on` to `["crashes_ccrs", "parties", "victims"]`. Today `backfill` doesn't wait for `victims`, so the derivation would read yesterday's victims. `matviews` already depends on `victims`, so no new failure mode is added.
- **Cost:** about 176k qualifying victims in total, a few seconds per year. The nightly scoped run covers only the previous and current year.
- **Docs:** fix the stale severity lists in `DATA_DICTIONARY.md:142` and the `models.py:280` comment to show the real values: Fatal, SuspectSerious, SevereInactive, SuspectMinor, PossibleInjury, OtherVisibleInactive, ComplaintOfPainInactive, null.

## 7. API and frontend

**Backend (`app/routers/stats.py`):**
- Add `Column("total_severe_injured", Integer)` to `mv_year`, `mv_cause` and `mv_wide`.
- Select it wherever `total_killed` is selected: grand total, county, year, cause, severity and month-on-wide.
- Add `total_severe_injured: int = 0` to `YearRow`, `CountyRow`, `CauseRow`, `SeverityRow` and `GrandTotal`.
- This is additive, so old frontends ignore it.
- Leave `mv_crash_rates` alone for now. An `/api/stats?group_by=rate` KSI rate would be a follow-up.

**Hero tile:**
- `computeHeroMetrics`: numerator = `Σ (total_killed + total_severe_injured)`.
- **Denominator fix (a real bug today):** population is summed over the demographics rows, which only cover 2005–2023, but the numerator sums every crash year returned, 2001–2026. The unfiltered tile therefore overstates the rate by about 26/19.
  - Restrict the numerator to years present in `demoQuery.data` with non-null population. The county filter already applies to both sides.
  - Show the covered span under the value ("2005–2023").
- Sparkline: `killed + severe_injured`.
- Relabel to "KSI / 100K pop.\*" with the asterisk tooltip (`JargonTerm` already defines KSI). Update the aria-labels and `JsonLd.tsx:98`.

**Year chart:**
- Add `"ksi"` to `MEASURES` with `MEASURE_LABELS.ksi = "Killed or Seriously Injured*"`.
- `pickValue`: `ksi → (total_killed ?? 0) + (total_severe_injured ?? 0)`.
- Offer it in `ChartConfigPanel` only for `year` (county, cause and severity can follow later, since the data is already there).
- Add `DimensionRow.total_severe_injured` and teach the NLQ parser `["serious injuries","ksi"]`.
- **Annotation:** reuse the `partialYearNote` footnote pattern in `ChartCard.tsx:344-572`. Add `ksiDefinitionNote(labels)`, which returns the asterisk text when `measure === "ksi"` and the visible years span 2015/2016 or 2017/2018. Put the text in one shared constant used by the chart, the hero tooltip and the methodology doc. A vertical reference line is optional polish and not required.

## 8. Tests

- `test_switrs_api.py` / new `test_backfill_switrs_ksi.py`:
  - a tiny in-memory SQLite `collisions` table including a > 2**63 `case_id`; assert the UPDATE targets the folded ID
  - a second run writes 0 rows
  - negative counts clamp to 0
- `test_backfill_derived.py`:
  - both codes counted; `SuspectMinor` and `Fatal` excluded
  - a victim downgraded from serious resets the crash to 0
  - a second run writes 0
  - `since_year` scoping
- `test_migration_graph.py` (mandatory) and the expand/contract guard pass with the marker.
- Stats router test: `total_severe_injured` is present and summed on the `mv_year`, `mv_cause` and `mv_wide` paths.
- Frontend:
  - `computeHeroMetrics` year-matching denominator (years with no population are excluded)
  - `pickValue("ksi")`
  - footnote appears only when the range crosses 2015/16 or 2017/18

## 9. Rollout (each step is its own push to main, and each push deploys)

1. **PR A, backend only:** the migration, `backfill_derived` step, `jobs.py` dependency, backfill module, router fields and docs, as one batched commit.
   - On deploy the migration swaps the views (no empty window) and the full `backfill_derived` fills CCRS.
   - **Check:** the CCRS per-year serious totals match section 3.
2. **Manual run:** `backfill_switrs_ksi` with `refresh_matviews=true`.
   - **Check:** SWITRS per-year sums are non-zero and plausible next to CCRS 2016 (13.5k).
   - **Check:** `curl /api/stats?group_by=year` shows `total_severe_injured` for 2001+.
3. **PR B, frontend:** hero tile, year-chart measure and footnote. Do a real-browser pass before merging (standing lesson). This reverts the stopgap label.

**Rollback:**
- PR B is a plain revert.
- For PR A, revert the code and leave the column in place. The column is additive and ignored, and the views with the extra column are harmless.
- Only run `alembic downgrade` if the migration itself misbehaves. It rebuilds three views, so expect roughly 10 minutes of degraded `/api/stats`.
- The backfills are idempotent, so re-running is always safe.
- Before step 1, confirm last night's R2 dump exists.

## 10. Open questions for the owner

1. **The 2017→2018 KABCO step (+14% serious) is inside CCRS.** Is a footnote enough, or should the chart shade 2016–2018 as a "transition" band?
2. **Hero denominator coverage ends in 2023** because demographics has no 2024+. Accept "2005–2023" on the tile, or load ACS/DOF 2024–2025 population first (a separate small task)?
3. **Should KSI also get a per-100k measure** on the rates dashboard (`mv_crash_rates`)? That would be a small follow-up migration.
4. **Show the partial current year for KSI?** Deaths lag 6+ months, so partial-year KSI is doubly misleading. The recommendation is to reuse the existing partial-year exclusion.
