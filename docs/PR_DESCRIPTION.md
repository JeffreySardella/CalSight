# PR: Interactive Dashboard Builder with Statistical Analysis Engine

**Issue:** #269
**Branch:** `feat/215-lightweight-charts`
**Scope:** 57 commits | 137 files changed | ~22K lines added

---

## Summary

- Adds a full-featured dashboard builder with 8 curated presets, drag-and-drop reordering, and a custom chart configuration panel supporting 12 chart types across 14 data dimensions and 9 measures
- Implements a client-side statistical analysis engine from scratch (no external dependencies): linear/polynomial/Holt-Winters forecasting, anomaly detection via z-score + IQR + CUSUM change-point analysis, and a complete hypothesis testing library (chi-squared, Welch's t-test, ANOVA, Mann-Kendall trend, Kolmogorov-Smirnov, Pearson correlation with FDR correction)
- Builds a natural language query (NLQ) parser that translates plain English like "fatalities by county as a scatter plot" into chart configurations, with synonym resolution and confidence scoring
- Delivers cross-filter interaction, time-lapse animation, geographic drill-down, data stories, AI-generated narrative insights, and collision-free smart label placement with force-directed positioning
- Adds shareable dashboard URLs (base64 URL codec), print/export mode, SEO with dynamic Open Graph images, structured JSON-LD, and a Cloudflare Worker for OG image generation

---

## Features

### Dashboard Builder Core
- **Preset Mode:** 8 analyst-designed presets (Safety Overview, Time Patterns, Demographics, Fatality Focus, DUI Deep Dive, Injury Analysis, Equity & Safety, County Comparison)
- **Builder Mode:** Fully custom dashboard with add/remove/reorder/configure per chart slot
- **12 Chart Types:** Bar, horizontal bar, line, area, donut, treemap, scatter, radar, polar, lollipop, gauge, stat card
- **14 Dimensions:** Hour, day of week, month, year, cause, severity, county, gender, age bracket, at-fault gender, at-fault age, weather, lighting, collision type
- **9 Measures:** Count, fatalities, injuries, percentage, fatality rate, YoY change, per 100K population, per 10K drivers, per 100 road miles
- **Chart Options:** Trend line overlay, mean line, standard deviation band, outlier highlighting, log scale, cumulative mode, moving average (configurable window), forecasting (linear/polynomial/Holt-Winters)
- **Persistence:** Dashboard state auto-saves to localStorage with debouncing; restores from URL param or storage on load

### Statistical Analysis Engine
- **Forecasting:** Linear regression, polynomial regression (with Gaussian elimination), Holt-Winters triple exponential smoothing with seasonal decomposition, confidence intervals
- **Anomaly Detection:** Z-score outlier detection, IQR fence method, CUSUM change-point detection -- aggregated per chart with severity scoring and natural language messages
- **Hypothesis Testing Library (pure TypeScript, zero dependencies):**
  - Chi-squared test of independence (with Cramer's V effect size)
  - Welch's two-sample t-test (with Cohen's d and 95% CI)
  - One-way ANOVA (with eta-squared effect size and Welch correction warning)
  - Mann-Kendall non-parametric trend test (with Sen's slope estimator)
  - Kolmogorov-Smirnov two-sample distribution test
  - Pearson correlation significance (with Fisher z-transformation CI)
  - Multiple testing correction: Bonferroni FWER and Benjamini-Hochberg FDR
  - Full correlation matrix batch significance testing
- **Distribution Functions:** Lanczos gamma approximation, regularized incomplete gamma/beta functions, normal/t/chi-squared/F CDFs -- all implemented from first principles

### Natural Language Query (NLQ) Interface
- Plain English to chart configuration parser with synonym dictionaries for dimensions, measures, chart types, and overlay options
- Confidence scoring (high/medium/low) with graceful fallback defaults
- Example suggestions carousel for discoverability
- Instant parsing feedback as user types

### Interactive Features
- **Cross-Filter:** Click any chart bar/segment to filter all other charts by that category -- with visual chip indicators and one-click clear
- **Time-Lapse Player:** Animated year-by-year playback with play/pause/seek/speed controls (0.5x-4x), driven by requestAnimationFrame for smooth 60fps
- **Geographic Drill-Down:** Click a county bar to zoom into that county's data; breadcrumb navigation back to statewide view
- **Data Stories:** 3 narrative-driven data explorations ("The Two Californias", "The DUI Clock", "Twenty Years of Progress?") with interleaved charts, stat callouts, and editorial narrative blocks

### AI-Powered Insights
- **Narrative Engine:** Template-based paragraph generation analyzing peak/trough detection, trend direction, concentration (Pareto analysis), dominance ratios, volatility (coefficient of variation), and demographic comparisons -- all without LLM calls
- **Per-Chart Narratives:** Each chart gets a 2-4 sentence statistical summary, adjustable between "technical" and "plain English" tones
- **Dashboard Key Findings:** Auto-generated top-5 bullet points ranked by statistical significance
- **Smart Chart Suggestions:** Context-aware "you might also want to see..." recommendations based on active filters, detected anomalies, and unexplored dimensions

### Visualization Intelligence
- **Smart Label Placement System:**
  - AABB collision detection with configurable margins
  - Force-directed simulation for scatter plot labels (20-iteration physics engine with decay)
  - Responsive density scaling across mobile/tablet/desktop breakpoints
  - Chart-type-specific strategies: bar rotation/truncation/nth-skip, donut inline vs leader-line, line peak/valley detection, treemap area-proportional sizing, lollipop value placement
  - Accessibility: full aria-label generation for hidden labels
- **Custom SVG Chart Components:** Lightweight (~22KB total vs 80KB+ Recharts), zero-dependency chart renderers with Material Design 3 theming, smooth CSS transitions, and print-optimized styling

### Sharing & SEO
- **Shareable URLs:** Base64-encoded dashboard configuration in URL params -- share exact dashboard state via link
- **Open Graph Images:** Dynamic OG image generation via Cloudflare Worker (renders preset + county + metric into social preview cards)
- **Structured Data:** JSON-LD Dataset and BreadcrumbList schemas for search engine rich results
- **Meta Tags:** Dynamic title, description, and Twitter card metadata reflecting current filter state
- **Share Panel:** Copy link, native Web Share API, and social media quick-share buttons

### UX & Accessibility
- **Keyboard Shortcuts:** 1-8 for preset switching, B for builder mode, Escape to close config panels
- **Print Mode:** Dedicated print stylesheet with header/footer showing active filters, methodology notes, and data freshness timestamp
- **Saved Dashboards:** Save/load named dashboard configurations to localStorage
- **Correlation Matrix Explorer:** Interactive 26-field heatmap with click-to-test statistical significance per cell
- **Vehicle Trends Section:** Separate visualization module for fleet composition trends
- **Data Freshness Banner:** Shows last ETL run timestamp
- **Hero Metrics:** 3 KPI cards (Total Incidents, KSI Rate/100K, YoY Fatality Change) with sparkline mini-charts and directional indicators

---

## Technical Details

### Architecture

The dashboard system is organized into clearly separated layers:

| Layer | Location | Responsibility |
|-------|----------|----------------|
| Type System | `lib/dashboard/types.ts` | Dimension/Measure/ChartSlot/Config types |
| Presets | `lib/dashboard/presets.ts` | 8 preset definitions and builder |
| Statistics | `lib/dashboard/stats.ts` | Regression, forecasting, moving average |
| Hypothesis Testing | `lib/dashboard/hypothesis.ts` | 5 statistical tests + corrections (~1,500 lines of pure math) |
| Anomaly Detection | `lib/dashboard/anomaly.ts` | Z-score, IQR, CUSUM detectors |
| NLQ Parser | `lib/dashboard/nlqParser.ts` | Synonym matching, confidence scoring |
| Narrative Engine | `lib/dashboard/narrativeEngine.ts` | Fact extraction, template rendering, paragraph composition |
| Chart Suggestions | `lib/dashboard/chartSuggestion.ts` | Context-aware recommendation engine |
| Label Placement | `lib/dashboard/labelPlacement.ts` | Collision-free label positioning (~920 lines) |
| Data Stories | `lib/dashboard/stories.ts` | Structured narrative blocks |
| URL Codec | `lib/dashboard/urlCodec.ts` | Base64 encode/decode for sharing |
| State Management | `hooks/useDashboardConfig.ts` | Config state + localStorage persistence |
| Cross-Filter | `hooks/useCrossFilter.ts` | Chart interaction state |
| Time-Lapse | `hooks/useTimelapsePlayer.ts` | RAF-driven animation loop |
| Drill-Down | `hooks/useDrillDown.ts` | Geographic navigation state |
| Narrative Hook | `hooks/useNarrativeInsights.ts` | Connects engine to React lifecycle |
| Suggestions Hook | `hooks/useChartSuggestions.ts` | Memoized suggestion generation |
| Data Fetching | `hooks/useDashboardData.ts` | Parallel API calls per chart slot |
| Dashboard Grid | `components/stats/DashboardGrid.tsx` | Layout orchestration + drag-drop |
| Chart Card | `components/stats/ChartCard.tsx` | Individual chart container + config |
| 17 SVG Charts | `components/charts/*.tsx` | Lightweight custom renderers |
| SEO | `components/seo/*.tsx` | MetaTags, JsonLd, SharePanel |
| OG Worker | `workers/og-image/` | Cloudflare Worker for OG images |

### Key Design Decisions

1. **Zero-dependency statistics** -- All math (gamma functions, matrix operations, distribution CDFs) implemented from scratch. No lodash, no d3-array, no stats libraries. This keeps the bundle tiny and gives full control over numerical precision.

2. **Pure SVG charts instead of Recharts** -- Custom chart components total ~22KB vs 80KB+ for Recharts. Each chart is a single component with direct SVG rendering, enabling fine-grained control over animations, accessibility, and print styling.

3. **Template-based narratives over LLM** -- The narrative engine generates insight paragraphs using statistical fact extraction + sentence templates. This runs instantly (no API call), works offline, and produces deterministic output that can be tested.

4. **Force-directed label placement** -- The label system solves the "overlapping text" problem using a mini physics simulation (20 iterations with anchor pull + repulsion + decay), rather than the common approach of simply hiding labels.

5. **Cross-filter as state, not data refetch** -- Clicking a chart segment updates a React state object that generates filter overrides for all other charts' API calls. This gives immediate visual feedback while keeping chart data consistent.

### Test Coverage

- **Unit Tests (Vitest):** 382 tests covering statistical functions, NLQ parser, URL codec, presets, label placement, hypothesis testing
- **E2E Tests (Playwright):** `dashboard-full.spec.ts` -- 10 test suites covering hero metrics, all 8 preset switches, NLQ query submission, builder mode chart creation, SVG rendering verification, anomaly panel, filter interaction, mobile viewport (390x844), keyboard shortcuts, data table toggle
- **Test Files:** `stats.test.ts`, `nlqParser.test.ts`, `presets.test.ts`, `urlCodec.test.ts`, `hypothesis.test.ts`, `labelPlacement.test.ts`

---

## Screenshots

> _TODO: Add screenshots of:_
> - Dashboard with Safety Overview preset (desktop)
> - Builder mode with custom chart configuration panel
> - NLQ query bar in action
> - Anomaly detection panel with critical findings
> - Cross-filter highlighting
> - Time-lapse controls during playback
> - Data Stories reader ("The Two Californias")
> - Correlation matrix with significance overlay
> - Mobile responsive layout (390x844)
> - Print preview mode
> - Dark mode full dashboard

---

## Test Plan

- [ ] Vitest unit tests pass (382 tests)
- [ ] TypeScript compiles clean (`tsc --noEmit`)
- [ ] Playwright E2E tests pass (`dashboard-full.spec.ts`)
- [ ] Visual QA on desktop (1280x800)
- [ ] Visual QA on mobile (390x844)
- [ ] Light mode verified
- [ ] Dark mode verified
- [ ] All 8 presets render correct charts with data
- [ ] NLQ parser resolves "crashes by hour" to correct chart config
- [ ] Builder mode: add, remove, reorder, reconfigure charts
- [ ] Cross-filter: click bar segment, verify other charts update
- [ ] Time-lapse: play through all years without errors
- [ ] Geographic drill-down: click county bar, verify breadcrumb appears
- [ ] Print mode: no clipped content, filters shown in header
- [ ] Share URL: encode dashboard, open in new tab, verify restoration
- [ ] Saved dashboards: save, reload page, load saved config
- [ ] Keyboard shortcuts: 1-8 for presets, B for builder, Escape closes config
- [ ] Data table toggle: click table icon, verify table renders with data
- [ ] Anomaly panel: verify anomalies display when present in data
- [ ] Correlation matrix: click cell, verify significance test result appears
- [ ] OG image worker: verify social preview renders correctly
- [ ] No horizontal overflow on any viewport width (390px-2560px)
- [ ] Service worker: offline fallback works for cached API data
- [ ] Performance: initial chart render < 500ms on desktop
