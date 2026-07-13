# CalSight Deep Multi-Dimension Audit — 2026-07-11

Second-pass, high-depth audit going **below** the 2026-07-01 and 2026-07-09 audits (both now
remediated across PRs #371/#372). Four parallel adversarial deep-audits — **security,
performance, data-correctness, supply-chain/infra** — each instructed to refute its own findings
before reporting and to record verified-sound defenses. A companion deep-research report on
self-hosted-runner hardening is tracked separately.

All findings verified against `main` at the time of audit. Nothing here is fixed yet — this is
the analysis; a remediation plan is at the end.

## Headline

The codebase is genuinely well-hardened — **security found no criticals or highs**, and every
dimension's "verified-sound" list is substantial (typed AI tool registry, XSS-safe rendering,
constant-time auth, sound deploy trust boundary, correct SWITRS/CCRS dedup, correct timezone
handling, the M10/M13 fixes hold). The real value this round is in three places the prior audits
never reached:

1. **A publicly-visible data-correctness bug on the site's default map measure** — per-capita
   crash rates are wrong by ~18× when a single year is selected (D-1).
2. **A metric-definition problem** — "alcohol-involved" silently includes drug-only crashes, and
   drug crashes are double-counted (D-2).
3. **A structural performance ceiling** — the request threadpool is 4× the DB pool, so ~10
   concurrent heavy requests stall the whole site (P-1); and the LLM spend cap shipped in #293
   is **inert in production** (S-1).

Severity tally across dimensions: **0 critical, ~5 high, ~18 medium, ~15 low.**

---

## Data correctness & analytical integrity
*(highest-value section — this is a public civic-data site; wrong numbers erode trust)*

### D-1 (HIGH) — Map default per-capita rate is ~18× too low when filtered by year
`frontend/src/hooks/useChoroplethData.ts:97-98,135-140,231-235,275`,
`frontend/src/lib/choropleth/measures.ts:265-288`, `backend/app/routers/demographics.py:19-40`

Silent parameter mismatch: the frontend sends the date filter as `start`/`end`, but
`/api/demographics` only honors `year`, so it always returns all ~18 population-years (2005–2022)
per county. The map then calls `computeMeasureValue` **without** `perYearCrashes`, so
`crashes_per_100k` falls to the fallback branch that divides the date-filtered crash count by the
sum of population over all ~18 years. Result scales by `(years-in-range / 18)`. Filter to 2022
and Los Angeles shows ≈28 per 100k instead of ≈500. This is the map's **default measure** — the
first number a visitor sees — and the tell is behavioral: narrowing the date range makes the
"rate" plummet. `MIN_CRASHES_FOR_RATE=5` doesn't catch it (counts are large). A live sibling of
the "~25×" family fixed earlier.
**Fix:** make `/api/demographics` honor a year range **and** pass `perYearCrashes` so the correct
per-year branch runs; or in the fallback, restrict `summedPop` to in-range years and divide by
their count (annual average). Add a regression test: single-year LA ≈ 500/100k, not ≈ 28.

### D-2 (HIGH) — "Alcohol-involved" includes drug-only crashes; drug crashes double-counted
`backend/etl/backfill_derived.py:311-312,450-451`; surfaced in UI filter chips, Story copy, and
every AI tool (`ai_tools.py:161-162,274-276,341,361,405-407`)

`is_alcohol_involved` is TRUE for sobriety `HBD-UNDER INFLUENCE` **OR** `UNDER_DRUG_INFLUENCE`;
`is_drug_involved` is the narrower drug value. So drug-only-impaired crashes are labeled
"Alcohol-involved" in the UI and AI answers, and are counted in **both** metrics. The docstring
admits the OR was chosen to hit "8.9% ≈ NHTSA national average" — but that target is reached only
by folding drug cases into alcohol, inflating the headline alcohol rate.
**Fix:** `is_alcohol_involved` = alcohol only; keep `is_drug_involved` separate; add an explicit
`is_impairment_involved` union if a combined metric is wanted; relabel UI/AI; re-derive the
"8.9%" claim honestly. *(Note: the "what counts as alcohol-involved" definition is partly a
product decision — flagged for your call.)*

### D-3 (HIGH) — Presentation-integrity cluster: fabricated stats, fake-confidence anomalies, unqualified correlations
- **Data Stories** hard-code dozens of headline figures rendered as fact (`stories.ts` `stat-callout`s): "3.1x", "r = 0.73", "+340%", causal phrasing like "DUI enforcement produced a 41% decline." The hard-coded `r = 0.73` **contradicts** the live Correlation Explorer for the same pair. (`stories.ts` + `StoryReader.tsx:167-182`)
- **Anomaly detector** relabels a 2σ z-score as "95%/97%/99% confidence" and ≥95→"critical" (`anomaly.ts:35-42`), on right-skewed raw counts with no multiple-comparisons correction — so the largest county is always an "anomaly," and ~2-3 false alarms per 58-county chart are expected, each shown "95% confidence."
- **Correlation matrix** prints Pearson r at n≥5 with no significance/CI and no causation caveat; includes tautological part-whole pairs (`fatality_rate` vs Fatalities) and silently correlates date-filtered crashes against most-recent-year demographics. (`useCorrelationData.ts`, `CorrelationMatrix.tsx`)

**Fix:** compute story stats live or badge them editorial + drop the coefficients that collide
with live tools + strip causal phrasing; drop the fake anomaly "confidence"/"critical" or compute
FDR-corrected p-values on normalized measures; raise the correlation n-floor to ≥15–20, grey out
non-significant cells, add a standing causation disclaimer, exclude self-derived pairs. *(Partly
editorial — your call on framing.)*

### D-4 (MEDIUM) — assorted
- **Hotspot z-score framing overstated** (`clusters.py:65-72`): occupied-cell counts are Poisson/right-skewed, so normal-theory "statistically significant" isn't earned; no exposure normalization (a "hotspot" is really "busy place"); fixed-grid MAUP/edge effects; non-square cells. The occupied-only baseline is a good choice. Re-label "elevated crash density" or use Getis-Ord Gi*.
- **SWITRS unknown/malformed time → midnight** (`switrs_api.py:93-106`) inflates the hour-0 time-of-day bin for 2001–2015. Store NULL and exclude from hour aggregations.
- **`get_crash_rate` year-mismatched denominators** (`ai_tools.py:816-879`): 2005 crashes ÷ ~2024 drivers/vehicles/population. Year-match denominators or refuse non-overlapping rates.
- **`years=[a,b]` is a range in two AI tools, an exact set in the rest** (`ai_tools.py:909-910,950-951`) — prior L3, still open.
- **YoY "biggest change" ranks partial-2026 vs full-2025** without annualizing (`YoyChangesPanel`/`changes.py`) — every county ≈ −50%. The caveat is shown, but the ranking math isn't prorated.

### D-5 (LOW)
data-quality `alcohol_true_pct` divides by flag-NULL SWITRS rows (latent — not surfaced); NULL
`county_code`/`crash_datetime` rows silently dropped at upsert (warn-only); hands-free counted as
distraction (debatable); AI `fatality_rate_pct` can exceed 100 (mislabeled "pct"); `mv_crash_rates`
has no data ≥2023 (ACS pinned to 2022); `Footer.tsx:19` hard-codes "© 2026".

**Verified correct & honest:** timezone handling (naive local → true local hour/DOW); SWITRS↔CCRS
merge cannot double-count (disjoint years + unique key + dedup); the M10 flag resync is correct
(`IS DISTINCT FROM` ground truth, right NULL handling); AI grounding/M13 fixes hold
(`SUM() OVER ()` denominators, unknown-metric errors, rollback + grounded-from-success + no
degraded caching); YoY backend discipline (partial-year flag, small-baseline demotion, coverage
default); insight cards exclude the current year; the choropleth correctly sums all severities for
its numerator (the severity-undercount hypothesis does **not** occur — D-1 is purely the year
denominator).

---

## Security *(adversarial second pass — no criticals, no highs)*

### S-1 (MEDIUM) — LLM daily-spend backstop is inert in production
`backend/app/settings.py:135` (`llm_daily_request_budget: int = 0`), `.env.example:53`,
`deploy.yml` env block (never writes it), `backend/app/llm_budget.py:42` (`budget<=0` → unlimited)

The spend/quota cap added in #293 defaults to `0` (unlimited), `.env.example` ships `0`, and the
deploy workflow's managed `.env` never sets it — so it never fires in prod. The only remaining
guard is slowapi's `10/minute;200/day`, built with **no `storage_uri`** → in-process
`MemoryStorage`, per-worker (×4) and reset on restart. An IP-rotating attacker appending a
throwaway history turn per request (forces a cache miss → real multi-round LLM call) can exhaust
the free-tier quotas of Groq/Gemini/OpenRouter/Cerebras for all users.
**Fix:** set a non-zero `LLM_DAILY_REQUEST_BUDGET` in the deploy `.env`; longer-term back slowapi
with a shared store so the daily cap is enforced across workers.

### S-2 (MEDIUM) — `/api/ask` worker threads can outlive requests and saturate the executor
`ask.py:227-234,366-367`: on timeout `wait_for` returns but the thread runs to the next round
boundary (~60s + one 30s provider call ≈ 90s), using the loop's default `ThreadPoolExecutor`
(~6 threads on 2 vCPU). Sustained timing-out requests starve the AI executor. Confined to the AI
path (separate from the sync-endpoint anyio pool). Cap AI concurrency with a bounded
executor/semaphore and shorten the per-provider timeout. *(Overlaps perf P-1.)*

### S-3 (LOW)
CSP omits `base-uri`/`object-src`/`form-action` (defense-in-depth; no live HTML-injection sink);
ETL archive extraction has no decompression-bomb ceiling (`switrs_api.py`, `nhtsa_fars.py`,
`census_tract_density.py` — not attacker-reachable, trusted pinned URLs); feedback endpoint is
unauthenticated-by-design (rate-limited, narrow grant, storage-exhaustion only). **Info:** the
`rate_limit.py:14-15` comment states a *wrong reason* ("no host port published") for a
still-correct conclusion — the prod bind is `127.0.0.1:8000`, so the conclusion holds; fix the
comment. Grounding passes on a single shared number (documented, downgrade-only).

**Verified-sound:** AI tool-abuse boundary (16 typed tools, no `text()`/shell/network/file, rows
capped, enum-validated, bad kwargs → caught error); no LLM→SQL/HTML/shell interpolation anywhere;
XSS-safe rendering (react-markdown, no `rehype-raw`, no `dangerouslySetInnerHTML`); all
`text(f"...")` interpolate ints/constants/allowlisted identifiers only; constant-time auth with
`no-store` on the raised exceptions; read-only DB role split real; deploy fork-spoof + freshness
guards complete.

---

## Performance & scalability

### P-1 (HIGH) — Request threadpool (40) is 4× the DB pool (10); heavy endpoints stall the whole worker
`app/database.py:9-17`, `settings.py:62-63`, `Dockerfile:28`; no `pool_timeout` (default 30s)

79/80 handlers are sync `def` → run in anyio's 40-token threadpool, each holding a DB connection,
but the pool supplies 10/worker. >10 concurrent DB requests queue up to 30s then 500. The
endpoints that hold longest are exactly the ones bounded to a 30s statement timeout
(clusters/intersections/corridors/highways/distribution) — so the timeout guarantees a 30s hold
under load. ~10 concurrent heavy requests site-wide degrades everything, including cheap MV reads.
`/ask`'s abandoned threads (S-2) compound it.
**Fix:** cap the anyio threadpool to ≈`pool_size+max_overflow`; set a short explicit `pool_timeout`
(≈5s) so exhaustion fails fast to 503+Retry-After; consider a separate pool for heavy analytics;
front heavy endpoints with TTL caches (P-2) so they rarely hold a connection.

### P-2 (HIGH) — Uncached full-table scans on the hot analytical endpoints
- **`/intersections` + `/corridors`** GROUP BY an unindexed functional expression on
  `primary_road`/`secondary_road` → full 11M-row seq scan + per-row `regexp_replace` (~25s cold,
  the code's own figure). Only `street-concentration` has an in-process cache; the other two
  re-run per filter permutation. (`intersections.py:100-206`)
- **`/crashes/clusters` + heatmap grid** aggregate ~4.1M coord rows on a computed grid key with no
  in-process cache (only per-browser HTTP cache). Fetched on map load + every filter change.
  (`clusters.py:121-133`, `heatmap.py:207-217`)
- **`/stats/yoy-changes`** default path runs an unbounded full-table `GROUP BY crash_year` (11M
  rows) with **no statement timeout** and no cache (`changes.py:54-69` — prior L4, still open).

**Fix:** add the `_concentration_cache` TTL pattern to intersections/corridors/clusters/yoy;
route yoy default-year off `mv_crashes_by_year`; add `apply_statement_timeout` to yoy + heatmap;
structurally, normalize+index the road columns (or a `mv_intersections`) and precompute the
statewide-default cluster grid.

### P-3 (HIGH) — Nightly `backfill_derived` rescans full tables for 6 flags that only change for 2 years
`backfill_derived.py:211-291,876-901`: six passes each full-scan 8.8M parties + anti-join every
CCRS year of crashes, though parties only reload current+previous year. The `IS DISTINCT FROM`
guards keep *writes* near zero (correct), but the *read* cost is paid nightly — the dominant
nightly DB cost after MV refresh. Scope the resync to the reloaded year range; move full-history
resync to the weekly pipeline.

### P-4 (MEDIUM)
heatmap `raw` OFFSET pagination is O(n²) on dense counties + separate COUNT + no timeout
(keyset-paginate on `id`); `fatalGradient` rebuilt as a fresh object every render → per-render
teardown+filter+rebuild of the 600K-point fatal canvas (one-line `useMemo`); dot layer re-filters
up to 600K points per pan (`bounds.contains` loop — build a grid index); service worker caches
`no-store` individual-crash PII responses (exclude `/api/crashes` non-heatmap from the cacheable
route); `mv_crashes_wide` involvement filters hit no index (minor at ~1M rows); nightly MV refresh
fully recomputes 8 aggregations (incremental-by-year is the long-term fix).

**Verified well-optimized:** MV dispatch (`_pick_view` routes to the smallest supporting MV);
heatmap accumulator cap + race-safe gating (C5 done right); gcTime scoping (H7 done right);
statement-timeout mechanism; `street-concentration` cache pattern; imperative Leaflet layer
management; process-cached slug map; pre-extracted derived columns; reasonable bundle splitting.

---

## Supply-chain & infrastructure

### SC-1 (HIGH) — CI `GITHUB_TOKEN` is write-scoped for every job while running untrusted install scripts
`.github/workflows/ci.yml:9-12` (workflow-level `pull-requests: write` + `security-events: write`,
no per-job override), `:48,72` (`npm ci`/`pip install` lifecycle scripts), `:99,124,157-158`
(unpinned `bandit`/`pip-audit`/`@lhci/cli`/`serve`); ci.yml checkouts lack `persist-credentials:
false` (unlike deploy/run-etl). A compromised transitive dep or unpinned tool reads the persisted
token and opens PRs / writes bogus security-alert resolutions. Ephemeral runner limits blast
radius, but the token is the asset.
**Fix:** workflow-level `permissions: contents: read`; grant writes per-job only where used; add
`persist-credentials: false` to ci.yml checkouts; pin the runtime tools.

### SC-2 (HIGH) — `npm audit --audit-level=high` is a hard, blocking deploy gate
`ci.yml:114-116` (no `continue-on-error`, unlike `pip-audit` two steps later). One dev-tree
advisory with no fix available blocks **all** production deploys — including an emergency security
fix. Make it `continue-on-error` (mirroring pip-audit) or `--omit=dev`; track real vulns via
dependabot.

### SC-3 (MEDIUM)
tag-pinned (not digest-pinned) base images built on the **prod host** (poisoned tag/dep runs next
to prod secrets); dependabot blind to `workers/og-image` (real npm root, wrangler a major behind)
and compose images (postgres/cloudflared); **bandit scans only `backend/app/`, skipping
`backend/etl/`** where all subprocess/`pg_dump`/network code lives; `boto3` unpinned + no hash
pinning on backend deps; `etl-status.sh` still `docker exec calsight-backend` (nonexistent under
Compose v2 — the #370 README says one thing, the script another).

### SC-4 (LOW)
frontend nginx image creates an `app` user but never `USER app` (unused, not the prod frontend);
**stray empty root `/package-lock.json`** (delete); og-image `compatibility_date` 18 months stale;
`db/postgresql.conf` orphaned (says PG16, stack is PG17); dev compose binds `0.0.0.0` + weak
password; deploy-failure Discord posts raw backend logs; pipeline container has no healthcheck.

**Verified solid:** every GitHub Action SHA-pinned to trusted publishers; no committed secrets,
`.env` excluded from both build contexts; secrets never truncate-leak (temp-file-swap merge, `env:`
only, regex-validated job input); backend container non-root; least-privilege split DB roles; one
LLM SDK (`openai`) not five; exact-pinned runtime deps + lockfile integrity; sound deploy gate;
resource limits + log rotation on all prod services.

---

## Remediation plan (prioritized)

**Tier 1 — correctness the public sees (do first):**
1. **D-1** per-capita denominator (demographics date-range + `perYearCrashes`) + single-year regression test.
2. **D-2** split alcohol from drug (relabel UI/AI; re-derive headline) — *confirm the definition with the team*.
3. **S-1** activate the LLM spend cap in the deploy `.env` (one line + doc).

**Tier 2 — resilience & scale (contained fixes):**
4. **P-1** align the anyio threadpool to the DB pool + short `pool_timeout`.
5. **P-2** TTL caches on intersections/corridors/clusters/yoy + yoy statement timeout + route yoy off the MV.
6. **P-3** scope the nightly flag resync to the reloaded years.
7. **SC-1 / SC-2** scope the CI token to `contents: read` + writes per-job; make `npm audit` non-blocking.

**Tier 3 — hardening & hygiene:**
8. **S-2 / P-4** bound AI-path concurrency; memoize `fatalGradient`; keyset-paginate the heatmap.
9. **SC-3** point bandit at `backend/etl/`; extend dependabot; digest-pin images; fix `etl-status.sh`.
10. **D-3/D-4** presentation integrity (story stats, anomaly labels, correlation significance, hotspot framing) — *largely editorial/product calls*.
11. **D-5 / SC-4** the lows (delete the stray root lockfile, © year, CSP additions, etc.).

**Structural / longer-term:** normalize+index road columns (or `mv_intersections`); incremental
by-year MV refresh; shared rate-limit store; build images on an ephemeral runner and ship digests
to prod.

Items marked *product/editorial* (D-2 definition, D-3 framing) should be confirmed with the team
before changing user-facing numbers. Everything in Tiers 2–3 (except the structural items) is a
contained, testable engineering fix.
