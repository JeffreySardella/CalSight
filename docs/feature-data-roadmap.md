# CalSight — Feature & Data Roadmap ("be a beast")

**Created:** 2026-07-02. Purpose: a researched, prioritized roadmap of new **data points** and
**product features** to push CalSight from "great civic crash explorer" to best-in-class,
grounded in what leading road-safety tools do.

**Scope (from the owner):** general-purpose audience (public/journalism + Vision-Zero/advocacy +
personal safety), **California-deep** (not multi-state), emphasizing all four axes — analytical
depth, new data points, killer UX, and AI/interactivity.

> **Provenance & verification note.** This roadmap was produced by a multi-source research pass
> (11 primary sources cited inline). The automated adversarial-verification stage was interrupted
> by a usage limit, so the source claims below were **hand-vetted against domain knowledge**
> rather than machine-verified — they're consistent with established highway-safety practice
> (FHWA Highway Safety Manual, Vision Zero programs). Treat feasibility/format details for any
> new dataset as **"confirm the actual download format before building"** — the same rule that
> killed the DUI effort (see `data-source-backlog.md`).

---

## 0. The strategic insight (read this first)

**UC Berkeley's TIMS/SafeTREC already offers free, geocoded SWITRS mapping and point-and-click
tools, and has for 20+ years** [safetrec.berkeley.edu]. It ships things CalSight doesn't: a DUI
Crash Summary, Weekly Crash Trends, a Safe-Routes-to-School map, a Motorcycle Crash Map, ATP
(Active Transportation Program) maps, and Safety-Performance-Measure target-setting.

So **"free SWITRS on a map" is not a moat.** CalSight's differentiation has to come from the
things TIMS *doesn't* do well: **exposure-normalized risk, statistical rigor (not raw counts),
route/segment-level risk, natural-language AI, and modern UX/embeds.** Every item below is ranked
with that lens — impact-per-effort, weighted toward what makes CalSight *distinct*, not just
what's missing.

---

## 1. New California data points (beyond the vetted VMT / EV / transit backlog)

Ranked by analytical unlock × feasibility. Formats flagged **[confirm]** still need a
download-format check before building.

### D1. Hospital / EMS injury data — the "police undercount" corrector ⭐ highest-novelty
- **Why it matters:** police crash reports capture only **44–75% of pedestrian injury crashes**
  and as little as **7–46% of bicyclist injury crashes** when validated against hospital records
  [escholarship.org/uc/item/0jq5h6f5]. CalSight is SWITRS-based, so it **systematically
  undercounts exactly the vulnerable-road-user harm it most wants to surface.** A hospital/EMS
  layer (or even just an honest "police data undercounts VRU injuries by X%" adjustment banner)
  is a genuine analytical differentiator no free CA tool foregrounds.
- **Candidate sources:** CA **HCAI** (formerly OSHPD) ED-visit & inpatient-discharge data
  (external-cause/transport injury codes); **EMSA CEMSIS** (California EMS Information System)
  [emsa.ca.gov/cemsis]. County-keyable.
- **Feasibility:** MEDIUM–LOW. High value, but access is the risk — HCAI patient-level data is
  often restricted/aggregated, and **crash-victim re-identification is a real hazard** (see §4).
  **[confirm]** what's available as public **county-aggregate** CSV before committing. Start with
  aggregate injury *counts by county/mode/year* (safe, public) rather than record-level.

### D2. Roadway inventory & facility classification — unlocks the flagship analytics
- **Why it matters:** the statistically-correct hotspot method (SPF + Empirical Bayes, §3/A1)
  needs only **crash counts + AADT exposure + facility-type classification** — no full asset
  inventory [highways.dot.gov HSM]. CalSight already has crashes and state-highway AADT; adding
  **functional class / lane count / segment geometry** turns on network screening.
- **Candidate sources:** Caltrans **GIS open-data / HPMS** (ArcGIS Hub — `gisdata-caltrans.opendata.arcgis.com`),
  the Caltrans Road Data / Highway Performance Monitoring System layers. Segment-level (GIS).
- **Feasibility:** MEDIUM. Caltrans publishes GIS layers (good), but coverage is **state highways**;
  local roads are the gap (that's why §3/A2's AADT-imputation matters). **[confirm]** the GIS
  attribute tables carry functional class + AADT per segment.

### D3. Safety intervention / countermeasure layers — enables before/after
- **Why it matters:** NYC's Vision Zero View overlays **speed humps, slow zones, street-improvement
  projects, and the 25 mph limit** directly on the crash map so users can relate crashes to
  treatments [vzv.nyc]. This is a whole feature class CalSight lacks and is the backbone of
  credible "did it work?" analysis for advocates and journalists.
- **Candidate sources:** Caltrans **SHOPP** / safety project lists, local Vision Zero project
  layers (SF, LA, Oakland, San Diego open-data portals), speed-limit-change records.
- **Feasibility:** MEDIUM (state) / fragmented (local). Start with Caltrans + the 3–4 biggest city
  open-data portals. **[confirm]** machine-readable project geometries + dates.

### D4. Active-transportation exposure (bike/ped counts) — the VRU denominator
- **Why it matters:** you can't compute a *rate* for pedestrians/cyclists without exposure. CA's
  **AT Count / bike-ped count** program exists (`data.ca.gov/dataset/at-count-dataset`).
- **Feasibility:** MEDIUM, sparse coverage. Good for the biggest metros; **[confirm]** county
  coverage. Pairs with D1 to make VRU analytics honest.

### D5. TIMS geocoded coordinates as an upstream geocoding benchmark
- **Why it matters:** SafeTREC has geocoded **~95% of CA fatal & severe-injury crashes**, supplying
  `POINT_X/POINT_Y` alongside the raw report lat/long [safetrec.berkeley.edu]. If CalSight's dot
  placement relies on raw SWITRS coordinates (which are noisier), TIMS geocoding quality is a
  **benchmark to measure against** and possibly a source to reconcile with.
- **Feasibility:** validation/quality play, not a new dataset per se. Low effort, quiet quality win.

> Also surfaced and worth a look: the CA DPH **"Road Traffic Injuries"** dataset on data.ca.gov
> (already-curated county injury indicators) and the **OTS data-sources** index (crash rankings by
> city/county OTS already publishes — a benchmark and possible import).

---

## 2. Features leading tools have that CalSight lacks — quick wins

These are proven by the benchmark tools and cheap to build on data CalSight already has (SWITRS/CCRS
points). High impact-per-effort.

- **F1. Intersection & corridor deep-dive / ranking.** Portland's High Crash Network is literally
  "the 30 streets and 30 intersections with the most crashes," ranked by **count, rate, and total
  collision cost** over a fixed multi-year window [portland.gov]. NYC rolls crashes up **per
  intersection, by month/year and by mode** (ped/bike/vehicle) [vzv.nyc]. CalSight has county
  choropleths and dots but **no intersection object** — this is the single most-requested civic
  crash feature and is computable from geocoded points.
- **F2. Mode-specific views (ped / bike / motorcycle).** Dedicated pedestrian, bicycle, and
  motorcycle layers/summaries — TIMS ships a Motorcycle Crash Map and SRTS map. Serves consumers
  ("is my bike commute dangerous") and advocates.
- **F3. DUI view + Weekly/seasonal trend view.** TIMS ships both as standard. CalSight has the data;
  these are chart/preset additions.
- **F4. Embeddable widgets + auto-generated reports.** A per-county/per-city "safety report card"
  (PDF/embeddable card) is a distribution and journalism multiplier — every local news story about
  a crash could embed CalSight. Low data risk, high reach.
- **F5. Countermeasure overlay** (depends on D3) — even a read-only "recent safety projects" layer.

---

## 3. Flagship analytical bets (the moat)

This is where CalSight beats TIMS. All are grounded in the highway-safety literature.

### A1. Statistically-rigorous hotspot detection (SPF + Empirical Bayes) ⭐ flagship
- **The problem with the obvious approach:** ranking locations by raw crash count — or even by
  crash *rate* — is **wrong**. It's fooled by regression-to-the-mean (a bad-luck year looks like a
  dangerous site). The FHWA-standard fix is **Safety Performance Functions + the Empirical Bayes
  method**, which "identifies high-priority locations more accurately than ranking by raw
  frequencies or rates" [highways.dot.gov HSM].
- **Why CalSight can do it:** network-screening SPFs need **only crash counts + AADT + facility
  class** — data CalSight has or can add (D2). EB shrinkage *also* fixes CalSight's **small-county
  instability** problem (5 tiny counties swing wildly) for free.
- **Effort:** MEDIUM-HIGH (the flagship). Ship it as "statistically-adjusted risk ranking," a
  claim no free CA tool makes.

### A2. Exposure normalization done *honestly* (don't just divide by VMT)
- **The trap:** crash counts scale **sublinearly** with traffic — estimated exposure exponents of
  **0.49–0.70 (all < 1)**, the "safety in numbers" effect [arxiv 2605.27889]. So **naive
  per-VMT/per-AADT rates overstate risk on high-volume roads and understate it on low-volume
  roads.** The vetted VMT backlog item is right to pursue, but the normalization must use the
  sublinear model (or an SPF), not a straight ratio.
- **Bonus method:** a **Bayesian hierarchical model can impute missing AADT** on local roads
  (where Caltrans has none) and produce per-segment rates *with uncertainty* at statewide scale
  (demonstrated on 408k segments / 2.9M crashes) [arxiv 2605.27889]. This is the principled answer
  to "AADT only covers state highways."

### A3. Network-constrained hotspot / segment risk
- Crashes live on a **linear road network**, so hotspot detection should use **network-constrained
  KDE** (kernel density along the graph), not planar 2D heatmaps [arxiv 1911.07827]. The
  open-source, peer-reviewed **DRHotNet** R package finds micro-segments where a *specific* crash
  type (e.g., pedestrian) is over-represented — a **type-specific hotspot** feature distinct from
  CalSight's existing raw-count heatmap.
- **Corridor scoring template:** Boston MPO's HIN uses a **1-mile sliding window in half-mile
  shifts**, aggregating **severity- and VRU-weighted (EPDO cost) scores** [ctps.org]. Result: the
  HIN is **~7% of road miles but ~65% of killed/severe-injury crashes** — mirrored in Portland
  (**8% of streets, 67% of deaths**) [portland.gov]. That concentration is the *entire argument*
  for why segment-level beats county choropleths.

### A4. Route / segment risk score (consumer-facing)
- "How dangerous is my commute" = fuse historical crashes with exposure/behavior layers (a
  fuzzy-logic or model-based combination) rather than crash counts alone [arxiv 2209.05604].
  **Caveat to ship with it:** history-only risk omits driver behavior and real-time conditions —
  say so in the UI [arxiv 2209.05604].

### A5. AI/interactivity built on the above
- Once hotspots/anomalies are computed: **auto-narrate** the top movers ("Intersection X entered
  the high-injury network this year, +40% ped injuries"), **anomaly detection** on trends, and
  extend the NLQ tool registry with hotspot/route/intersection tools. This is where CalSight's
  existing AI stack compounds the new analytics.

---

## 4. Statistical & ethical pitfalls (build these in, not after)

- **Re-identification of crash victims is real and severe.** Crash details *outside* HIPAA's 18
  identifiers (year, location, circumstances) can re-identify people in "de-identified" hospital
  data — relative risk **537× vs. general population**, rising to **25%** if the victim was
  hospitalized and **66.7%** if hospitalized with permanent injury [PMC6371259]. **The severe/fatal
  crashes CalSight most wants to surface are the most re-identifiable.** Mitigation: for
  fatal/severe records, avoid exposing precise location **+** exact date **+** victim detail
  *together*; consider spatial/temporal jitter or aggregation at the most sensitive tiers.
- **Police undercount (D1):** headline VRU numbers should carry the "police data captures only
  44–75% of ped / 7–46% of bike injuries" caveat, or CalSight overstates safety.
- **Small-county instability:** EB shrinkage (A1) is the principled fix; until then keep the
  min-denominator guard and methodology note.
- **Correlation ≠ causation:** the matrix and any new "risk" framing must stay honest — the
  sublinear-exposure finding (A2) is a concrete example of how a naive rate misleads.

---

## 5. Prioritized roadmap (impact-per-effort tiers)

**Tier 1 — Quick wins (weeks, data already in hand):**
1. **F1 Intersection/corridor deep-dive + ranking** (Portland/NYC template) — biggest
   feature gap, computable from geocoded SWITRS points.
2. **F3 DUI + weekly/seasonal trend presets** — cheap, matches TIMS baseline.
3. **F2 Mode-specific (ped/bike/motorcycle) views** + the **D1 undercount caveat banner**.
4. **F4 Embeddable per-county "safety report card"** — distribution/journalism multiplier.

**Tier 2 — Flagship analytics (the moat):**
5. **A3 Network-constrained + severity/VRU-weighted hotspot/HIN** — CalSight's "7% of roads, 65%
   of deaths" headline.
6. **A1 SPF + Empirical Bayes risk ranking** — rigorous, also fixes small-county instability.
7. **A2 Honest exposure normalization** (sublinear model; ties in the vetted VMT item correctly).

**Tier 3 — Data expansions (unlock more of the above):**
8. **D2 Caltrans roadway/facility GIS** (enables A1) → **D3 countermeasure layers** (before/after)
   → **D4 bike/ped exposure** → **D1 hospital/EMS aggregates** (highest-novelty, gated on access).

**Tier 4 — Flagship consumer + AI:**
9. **A4 Route-risk score** and **A5 AI auto-narratives / anomaly detection** on top of Tier 2.

**Sequencing logic:** Tier 1 closes the visible feature gap vs. TIMS fast; Tier 2 builds the
statistical moat TIMS lacks; Tier 3 feeds Tier 2; Tier 4 is the consumer/AI flourish that ties
CalSight's existing AI stack to the new analytics.

---

## Sources
- UC Berkeley SafeTREC / TIMS — tools & geocoding: https://safetrec.berkeley.edu/tools/transportation-injury-mapping-system-tims
- Boston MPO High-Injury Network methodology: https://www.ctps.org/data/html/plans/Vision-Zero/Vision_Zero_Appendices_Files/VisionZeroAppCHigh-InjuryNetworkMethodology.html
- FHWA Highway Safety Manual — SPF/Empirical Bayes network screening: https://highways.dot.gov/safety/learn-safety/highway-safety-manual-case-study-4-development-safety-performance-functions
- Portland Vision Zero High Crash Network: https://www.portland.gov/transportation/vision-zero/high-crash-network-streets-and-intersections
- NYC Vision Zero View: https://vzv.nyc/
- DRHotNet (network-constrained differential hotspots): https://arxiv.org/pdf/1911.07827
- Bayesian hierarchical crash-rate w/ AADT imputation & sublinear exposure: https://arxiv.org/pdf/2605.27889
- Fuzzy-logic segment risk scoring: https://arxiv.org/pdf/2209.05604
- Crash-victim re-identification risk: https://pmc.ncbi.nlm.nih.gov/articles/PMC6371259/
- Pedestrian/bicyclist police-report underreporting: https://escholarship.org/uc/item/0jq5h6f5
- Candidate CA data portals: EMSA CEMSIS (emsa.ca.gov/cemsis), Caltrans GIS open-data
  (gisdata-caltrans.opendata.arcgis.com), CA DPH Road Traffic Injuries & AT Count (data.ca.gov),
  OTS data sources (ots.ca.gov/data-sources).
