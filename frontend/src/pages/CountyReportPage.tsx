/**
 * CountyReportPage — /county/:slug/report
 *
 * A one-page, printable summary of a single county for journalists, advocates
 * and local officials: six headline numbers with the statewide figure beside
 * each, a ten-year trend, the top primary collision factors, an hour-of-day
 * strip, the county's rank, and a "how to read this" footer.
 *
 * Every number comes from the API (see useCountyReport). Nothing here is
 * hard-coded, including the year the report describes.
 *
 * Print: the app's global @media print block (index.css) already hides nav,
 * footers, buttons and links and forces the light palette. The block at the
 * bottom of this file adds what is specific to this page — Letter sizing,
 * page-break rules, and keeping the two links that belong in a printed copy.
 * Charts encode with position and length, not hue, so they survive grayscale.
 */

import { useEffect, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import MetaTags from "../components/seo/MetaTags";
import CopyLinkButton from "../components/ui/CopyLinkButton";
import { ErrorState } from "../components/ui/ErrorState";
import { Skeleton } from "../components/ui/Skeleton";
import { CA_COUNTIES, slugify } from "../hooks/useFilterParams";
import { useCountyReport, type CountyReport, type FactorItem } from "../hooks/useCountyReport";
import { useCountyInsight } from "../hooks/useCountyInsight";
import { useDataFreshness } from "../hooks/useDataFreshness";
import { DATA_SOURCE_PROVIDERS } from "../lib/dataSources";
import {
  formatChange,
  formatCount,
  formatValue,
  ordinal,
  type MetricRow,
} from "../lib/countyReport";

const COUNTY_BY_SLUG = new Map(CA_COUNTIES.map((c) => [slugify(String(c)), String(c)]));

function hourLabel(hour: number): string {
  if (hour === 0) return "midnight";
  if (hour === 12) return "noon";
  return hour < 12 ? `${hour} am` : `${hour - 12} pm`;
}

/**
 * The chart's numbers as a real table, for screen readers.
 *
 * sr-only goes on a wrapping div, not on the table: `display: table` widens to
 * fit its content regardless of the 1px box sr-only sets, which pushed the
 * page into horizontal scroll at phone widths. A block wrapper clips it.
 */
function ChartData({ caption, head, rows }: { caption: string; head: string[]; rows: string[][] }) {
  return (
    <div className="sr-only">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]}>
              <th scope="row">{r[0]}</th>
              {r.slice(1).map((cell, i) => (
                <td key={i}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function linePath(values: number[], max: number, w: number, h: number, pad: number): string {
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  return values
    .map((v, i) => {
      const x = pad + i * step;
      const y = h - pad - (max > 0 ? v / max : 0) * (h - pad * 2);
      return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function TrendChart({ report }: { report: CountyReport }) {
  const { trend } = report;
  const W = 320;
  const H = 110;
  const PAD = 10;
  const maxCrashes = Math.max(...trend.map((p) => p.crashes), 1);
  const maxKilled = Math.max(...trend.map((p) => p.killed), 1);
  const step = trend.length > 1 ? (W - PAD * 2) / (trend.length - 1) : 0;

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto text-on-surface"
        style={{ maxHeight: "150px" }}
        role="img"
        aria-label={`Crashes and deaths in ${report.countyName} County, ${report.windowStart} to ${report.year}. Crashes went from ${formatCount(trend[0]?.crashes ?? null)} to ${formatCount(trend[trend.length - 1]?.crashes ?? null)}; deaths from ${formatCount(trend[0]?.killed ?? null)} to ${formatCount(trend[trend.length - 1]?.killed ?? null)}.`}
      >
        <path
          d={linePath(trend.map((p) => p.crashes), maxCrashes, W, H, PAD)}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d={linePath(trend.map((p) => p.killed), maxKilled, W, H, PAD)}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeDasharray="4 3"
        />
        {trend.map((p, i) => (
          <circle
            key={p.year}
            cx={PAD + i * step}
            cy={H - PAD - (p.crashes / maxCrashes) * (H - PAD * 2)}
            r="1.8"
            fill="currentColor"
          />
        ))}
      </svg>
      <div className="flex items-center justify-between text-[10px] text-on-surface-variant mt-1">
        <span>{report.windowStart}</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <svg viewBox="0 0 16 4" className="w-4 h-1 text-on-surface" aria-hidden="true">
              <line x1="0" y1="2" x2="16" y2="2" stroke="currentColor" strokeWidth="2" />
            </svg>
            Crashes
          </span>
          <span className="flex items-center gap-1">
            <svg viewBox="0 0 16 4" className="w-4 h-1 text-on-surface" aria-hidden="true">
              <line x1="0" y1="2" x2="16" y2="2" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" />
            </svg>
            Deaths
          </span>
        </span>
        <span>{report.year}</span>
      </div>
      <p className="text-[10px] text-on-surface-variant mt-1">
        Each line is scaled to its own maximum, so the two are read for shape, not height against each other.
      </p>
      <ChartData
        caption={`Crashes and deaths in ${report.countyName} County by year`}
        head={["Year", "Crashes", "Deaths"]}
        rows={trend.map((p) => [String(p.year), formatCount(p.crashes), formatCount(p.killed)])}
      />
    </div>
  );
}

function FactorList({ factors, countyName, window: win }: { factors: FactorItem[]; countyName: string; window: string }) {
  const max = Math.max(...factors.map((f) => f.count), 1);
  return (
    <div>
      <ol className="space-y-1.5">
        {factors.map((f) => (
          <li key={f.label}>
            <div className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="text-on-surface font-medium truncate">{f.label}</span>
              <span className="text-on-surface-variant tabular-nums shrink-0">{formatCount(f.count)}</span>
            </div>
            <svg
              viewBox="0 0 100 5"
              preserveAspectRatio="none"
              className="w-full h-[5px] text-on-surface"
              aria-hidden="true"
            >
              <rect x="0" y="0" width={(f.count / max) * 100} height="5" fill="currentColor" />
            </svg>
          </li>
        ))}
      </ol>
      <ChartData
        caption={`Most-reported primary collision factors in ${countyName} County, ${win}`}
        head={["Factor", "Crashes"]}
        rows={factors.map((f) => [f.label, formatCount(f.count)])}
      />
    </div>
  );
}

function HourStrip({ report }: { report: CountyReport }) {
  const { hours } = report;
  const max = Math.max(...hours.map((h) => h.crash_count), 1);
  const peak = hours.reduce<{ hour: number; crash_count: number } | null>(
    (best, h) => (best == null || h.crash_count > best.crash_count ? h : best),
    null,
  );
  const W = 240;
  const H = 40;
  const slot = W / 24;

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full text-on-surface"
        style={{ height: "40px" }}
        role="img"
        aria-label={`Crashes by hour of day in ${report.countyName} County, ${report.windowStart} to ${report.year}. The busiest hour starts at ${peak ? hourLabel(peak.hour) : "no recorded hour"}.`}
      >
        {hours.map((h) => {
          const barH = (h.crash_count / max) * H;
          return (
            <rect
              key={h.hour}
              x={h.hour * slot + 0.4}
              y={H - barH}
              width={slot - 0.8}
              height={barH}
              fill="currentColor"
            />
          );
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-on-surface-variant mt-1">
        <span>midnight</span>
        <span>noon</span>
        <span>midnight</span>
      </div>
      <ChartData
        caption={`Crashes by hour of day in ${report.countyName} County, ${report.windowStart} to ${report.year}`}
        head={["Hour starting", "Crashes"]}
        rows={hours.map((h) => [hourLabel(h.hour), formatCount(h.crash_count)])}
      />
    </div>
  );
}

/** One row of the headline table. */
function MetricCells({ m }: { m: MetricRow }) {
  const value = m.countyTooSmall
    ? "Not shown"
    : m.decimals === 0
      ? formatCount(m.county)
      : formatValue(m.county, m.decimals);
  const statewide = m.decimals === 0 ? formatCount(m.statewide) : formatValue(m.statewide, m.decimals);
  return (
    <>
      <td className="py-1.5 pl-2 text-right font-bold text-on-surface tabular-nums">{value}</td>
      <td className="py-1.5 pl-2 text-right text-on-surface-variant tabular-nums">{statewide}</td>
      <td className="py-1.5 pl-2 text-right text-on-surface-variant tabular-nums">
        {m.countyTooSmall ? "—" : formatChange(m.changePct)}
      </td>
    </>
  );
}

function ReportBody({ report, narrative }: { report: CountyReport; narrative: string | null }) {
  const { countyName, year, priorYear, windowStart, metrics, factors, rank } = report;
  const win = `${windowStart} to ${year}`;
  const suppressed = metrics.filter((m) => m.countyTooSmall);
  const mapHref = `/?county=${slugify(countyName)}`;

  return (
    <>
      <section aria-labelledby="key-numbers" className="report-block">
        <h2 id="key-numbers" className="font-headline text-sm font-bold text-on-surface mb-2">
          {year} at a glance
        </h2>
        <table className="w-full text-[11px] border-collapse">
          <caption className="sr-only">
            {countyName} County in {year}, each figure beside the statewide figure and the change
            against {priorYear}
          </caption>
          <thead>
            <tr className="border-b border-outline-variant text-[9px] uppercase tracking-wider text-on-surface-variant">
              <th scope="col" className="text-left font-bold py-1">Measure</th>
              <th scope="col" className="text-right font-bold py-1 pl-2">{countyName}</th>
              <th scope="col" className="text-right font-bold py-1 pl-2">Statewide</th>
              <th scope="col" className="text-right font-bold py-1 pl-2">vs {priorYear}</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m.key} className="border-b border-outline-variant/40">
                <th scope="row" className="text-left font-medium text-on-surface py-1.5 pr-2">
                  {m.label}
                </th>
                <MetricCells m={m} />
              </tr>
            ))}
          </tbody>
        </table>
        {suppressed.length > 0 && (
          <p className="text-[10px] text-on-surface-variant mt-1.5">
            Not shown: {suppressed.map((m) => m.label.toLowerCase()).join(", ")}. The count for{" "}
            {countyName} County in {year} is too small for a stable rate, so the report gives the
            counts above and leaves the rate out.
          </p>
        )}
      </section>

      <section aria-labelledby="trend" className="report-block">
        <h2 id="trend" className="font-headline text-sm font-bold text-on-surface mb-2">
          Crashes and deaths, {win}
        </h2>
        <TrendChart report={report} />
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <section aria-labelledby="factors" className="report-block">
          <h2 id="factors" className="font-headline text-sm font-bold text-on-surface mb-2">
            Most-reported primary collision factors
          </h2>
          {factors.length > 0 ? (
            <FactorList factors={factors} countyName={countyName} window={win} />
          ) : (
            <p className="text-[11px] text-on-surface-variant">No factor breakdown on record for {win}.</p>
          )}
        </section>

        <section aria-labelledby="hours" className="report-block">
          <h2 id="hours" className="font-headline text-sm font-bold text-on-surface mb-2">
            When crashes happen
          </h2>
          {report.hours.length > 0 ? (
            <HourStrip report={report} />
          ) : (
            <p className="text-[11px] text-on-surface-variant">No hour breakdown on record for {win}.</p>
          )}
        </section>
      </div>

      <section aria-labelledby="rank" className="report-block">
        <h2 id="rank" className="font-headline text-sm font-bold text-on-surface mb-1">
          Rank among California counties
        </h2>
        <p className="text-[11px] text-on-surface-variant leading-relaxed">
          {rank
            ? `On deaths per 1,000 crashes in ${year}, ${countyName} County ranks ${ordinal(rank.rank)} highest of the ${rank.of} counties with a figure for that year.`
            : `No ranking for ${countyName} County in ${year}.`}
        </p>
      </section>

      {narrative && (
        <section aria-labelledby="narrative" className="report-block">
          <h2 id="narrative" className="font-headline text-sm font-bold text-on-surface mb-1">
            County insight
          </h2>
          <p className="text-[11px] text-on-surface-variant leading-relaxed">{narrative}</p>
        </section>
      )}

      <section aria-labelledby="how-to-read" className="report-block border-t border-outline-variant pt-3">
        <h2 id="how-to-read" className="font-headline text-sm font-bold text-on-surface mb-1.5">
          How to read this
        </h2>
        <dl className="text-[10px] text-on-surface-variant leading-relaxed space-y-1">
          <div>
            <dt className="inline font-bold text-on-surface">Sources. </dt>
            <dd className="inline">{DATA_SOURCE_PROVIDERS.join(", ")}.</dd>
          </div>
          <div>
            <dt className="inline font-bold text-on-surface">Death counts lag. </dt>
            <dd className="inline">
              A death is recorded against the crash once the outcome is confirmed, which can take
              six months or more. Recent years are still filling in and will rise.
            </dd>
          </div>
          <div>
            <dt className="inline font-bold text-on-surface">Coordinate coverage. </dt>
            <dd className="inline">
              Not every crash record carries usable coordinates. The counts here come from the full
              records; the interactive map can only plot the records that have a location.
            </dd>
          </div>
          <div>
            <dt className="inline font-bold text-on-surface">Rate definitions. </dt>
            <dd className="inline">
              Deaths per 1,000 crashes = people killed ÷ crashes × 1,000. Crashes per 10,000
              licensed drivers uses the DMV count for {year}, or the nearest year DMV publishes.
              Crashes per 100 road miles uses Caltrans centre-line mileage across all functional
              classes. Rates are left out where a count is too small to be stable.
            </dd>
          </div>
          <div>
            <dt className="inline font-bold text-on-surface">Partial years. </dt>
            <dd className="inline">
              The in-progress calendar year is left out everywhere on this page. {year} is the
              latest complete year.
            </dd>
          </div>
        </dl>
        <p className="text-[10px] mt-2">
          <Link to={mapHref} className="print-keep text-primary underline">
            Open {countyName} County on the interactive map
          </Link>
          <span className="hidden print:inline"> — calsight.org{mapHref}</span>
        </p>
      </section>
    </>
  );
}

function LoadingBody() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading county report card">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-28 w-full" />
      <span className="sr-only">Loading county report card</span>
    </div>
  );
}

export default function CountyReportPage() {
  const { slug } = useParams<{ slug: string }>();
  const countyName = slug ? (COUNTY_BY_SLUG.get(slug.toLowerCase()) ?? null) : null;

  const { report, isLoading, isError, refetch } = useCountyReport(countyName);
  const { data: insight } = useCountyInsight(countyName);
  const { lastUpdatedAt } = useDataFreshness();

  const title = countyName
    ? `${countyName} County Crash Report Card — CalSight`
    : "County Not Found — CalSight";
  const description = countyName
    ? `A one-page, printable summary of reported traffic crashes, deaths and injuries in ${countyName} County, California, with statewide figures for comparison.`
    : "That California county could not be found.";

  // Layout.tsx owns document.title and, as the parent route element, its effect
  // runs AFTER this page's — React flushes child effects first — so a title set
  // inline here is immediately overwritten. Re-asserting it in a microtask lands
  // once the whole effect flush is done, without a visible flicker.
  useEffect(() => {
    queueMicrotask(() => {
      document.title = title;
    });
  }, [title]);

  const dataThrough = useMemo(
    () =>
      lastUpdatedAt
        ? lastUpdatedAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
        : null,
    [lastUpdatedAt],
  );

  if (!countyName) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center page-enter">
        <MetaTags title={title} description={description} path={`/county/${slug ?? ""}/report`} />
        <span className="material-symbols-outlined text-[56px] text-on-surface-variant/40" aria-hidden="true">
          explore_off
        </span>
        <h1 className="text-2xl font-headline font-bold text-on-surface mt-3 mb-2">
          No such county
        </h1>
        <p className="text-on-surface-variant mb-6">
          CalSight has a report card for each of California's counties, but not for “{slug}”.
        </p>
        <Link
          to="/"
          className="inline-block px-5 py-2.5 bg-primary text-on-primary rounded-full font-semibold text-sm hover:opacity-90 transition-opacity"
        >
          Back to the map
        </Link>
      </div>
    );
  }

  const summary =
    report &&
    `In ${report.year}, the latest complete year, ${countyName} County recorded ${formatCount(
      report.metrics.find((m) => m.key === "crashes")?.county ?? null,
    )} reported crashes, ${formatCount(
      report.metrics.find((m) => m.key === "deaths")?.county ?? null,
    )} people killed and ${formatCount(
      report.metrics.find((m) => m.key === "injuries")?.county ?? null,
    )} people injured.`;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 page-enter report-card">
      <MetaTags title={title} description={description} path={`/county/${slug}/report`} />
      <style>{PRINT_CSS}</style>

      <header className="report-block mb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-headline text-xl sm:text-2xl font-bold text-on-surface tracking-tight">
              {countyName} County crash report card
            </h1>
            <p className="text-[11px] text-on-surface-variant mt-1">
              CalSight · {dataThrough ? `Data loaded ${dataThrough}` : "Data load date unavailable"}
            </p>
          </div>
          <div className="flex gap-2 shrink-0" data-print-hide>
            <button
              type="button"
              onClick={() => window.print()}
              className="flex items-center gap-1.5 bg-primary text-on-primary px-3 py-2 rounded-lg text-[11px] font-bold tracking-widest uppercase hover:opacity-90 transition-opacity"
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">print</span>
              Print
            </button>
            <CopyLinkButton
              label="Copy link"
              className="flex items-center gap-1.5 bg-surface-container-high hover:bg-surface-container-highest text-on-surface px-3 py-2 rounded-lg text-[11px] font-bold tracking-widest uppercase transition-colors"
            />
          </div>
        </div>
        {summary && (
          <p className="text-xs text-on-surface leading-relaxed mt-2.5">{summary}</p>
        )}
      </header>

      {isError ? (
        <ErrorState
          title="Couldn't build this report card"
          description={`The data for ${countyName} County didn't load. Try again in a moment.`}
          onRetry={refetch}
          className="py-16"
        />
      ) : isLoading || !report ? (
        <LoadingBody />
      ) : (
        <div className="space-y-4">
          <ReportBody report={report} narrative={insight?.narrative ?? null} />
        </div>
      )}
    </div>
  );
}

/**
 * Page-specific print rules. index.css already hides nav/footer/buttons/links
 * and forces the light palette in print, so this adds only what that can't
 * know: Letter sizing, the header bar (a <header>, not a <nav>), the bottom
 * tab bar, keeping sections off page seams, and shrinking type so the whole
 * card lands on one sheet.
 */
const PRINT_CSS = `
@media print {
  @page { size: letter; margin: 12mm; }
  body { background: #fff !important; }
  header.fixed, [aria-label="Mobile navigation"], [data-print-hide] { display: none !important; }
  main { padding-top: 0 !important; padding-bottom: 0 !important; }
  .report-card {
    max-width: none !important;
    padding: 0 !important;
    font-size: 9.5pt;
    color: #000 !important;
  }
  .report-card h1 { font-size: 15pt; }
  .report-card h2 { font-size: 10pt; }
  .report-card .report-block {
    break-inside: avoid;
    page-break-inside: avoid;
    margin-bottom: 4mm;
  }
  .report-card svg { max-height: 26mm !important; }
  .report-card table { width: 100%; }
  .report-card a.print-keep { color: #000 !important; text-decoration: none; }
  .report-card, .report-card * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;
