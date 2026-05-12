/**
 * PDF export — generates a one-page summary report covering the current
 * filter scope. Minimum-viable on purpose: the goal is "share a snapshot
 * that holds up as a screenshot in a Slack message" rather than a full
 * statistical report.
 *
 * Pulls two backend rollups itself (grand total + top-N counties) so it
 * doesn't depend on MapPage or StatsPage having pre-loaded the data.
 */

import { API_BASE } from "../../config";
import { triggerDownload, todayStamp } from "./download";
import type { FilterScope } from "./filterSummary";

/**
 * jsPDF's default Helvetica only supports Latin-1 (WinAnsi). Strings with
 * characters outside that range get emitted as UTF-16BE and rendered byte
 * by byte against the Latin-1 font, producing spaced-out garbage. Loading
 * a Unicode TTF would add ~150KB to the bundle, so we sanitize the few
 * decorative characters our scope strings actually contain.
 */
function sanitizeForPdf(s: string): string {
  return s
    .replace(/→/g, " to ")
    .replace(/[–—]/g, "-")
    .replace(/·/g, ", ");
}

interface GrandTotal {
  total_crashes: number;
  total_killed: number;
  total_injured: number;
}

interface CountyRow {
  county_code: number;
  county_name: string | null;
  crash_count: number;
  total_killed: number;
  total_injured: number;
}

export interface PdfExportOptions {
  /** Active-filters scope to render in the report header. */
  scope: FilterScope;
  /** Pre-built filter query string for the backend rollup fetches. */
  filterQs: string;
  /** Cancellation signal — abort propagates to the in-flight stats fetches
   *  so closing the panel mid-generation doesn't leak requests. */
  signal?: AbortSignal;
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

export async function exportPdf(opts: PdfExportOptions): Promise<void> {
  const { scope, filterQs, signal } = opts;

  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  // Two parallel rollups — grand totals + top counties. We forward the
  // current filter QS so the report reflects what the user is looking at.
  const statsQs = filterQs ? `?${filterQs}` : "";
  const countyQs = filterQs ? `?${filterQs}&group_by=county` : "?group_by=county";

  const [total, counties] = await Promise.all([
    fetchJson<GrandTotal>(`${API_BASE}/api/stats${statsQs}`, signal),
    fetchJson<CountyRow[]>(`${API_BASE}/api/stats${countyQs}`, signal),
  ]);

  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 48;
  let y = margin;

  // Title block
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("CalSight Crash Report", margin, y);
  y += 22;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(110);
  doc.text(`Generated ${new Date().toLocaleString()}`, margin, y);
  y += 24;

  // Filters block — table-style so it lines up neatly.
  doc.setTextColor(0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Filters", margin, y);
  y += 10;

  autoTable(doc, {
    startY: y,
    head: [],
    body: scope.rows.map((r) => [sanitizeForPdf(r.label), sanitizeForPdf(r.value)]),
    theme: "plain",
    styles: { fontSize: 10, cellPadding: { top: 2, right: 6, bottom: 2, left: 0 } },
    columnStyles: {
      0: { fontStyle: "bold", textColor: 110, cellWidth: 90 },
      1: { textColor: 30 },
    },
    margin: { left: margin, right: margin },
  });
  // @ts-expect-error — autotable mutates doc with lastAutoTable.finalY
  y = doc.lastAutoTable.finalY + 28;

  // Hero metric strip
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Summary", margin, y);
  y += 18;

  const metrics: { label: string; value: string }[] = [
    { label: "Total crashes", value: total.total_crashes.toLocaleString() },
    { label: "Total killed", value: total.total_killed.toLocaleString() },
    { label: "Total injured", value: total.total_injured.toLocaleString() },
  ];
  const colWidth = (pageWidth - margin * 2) / metrics.length;
  metrics.forEach((m, i) => {
    const x = margin + colWidth * i;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(110);
    doc.text(m.label.toUpperCase(), x, y);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(0);
    doc.text(m.value, x, y + 22);
  });
  y += 50;

  // Top counties table (limit to top 10 by crash count).
  const top = [...counties]
    .sort((a, b) => b.crash_count - a.crash_count)
    .slice(0, 10);

  if (top.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(`Top ${top.length} counties by crash count`, margin, y);
    y += 10;

    autoTable(doc, {
      startY: y,
      head: [["County", "Crashes", "Killed", "Injured"]],
      body: top.map((c) => [
        c.county_name ?? `Code ${c.county_code}`,
        c.crash_count.toLocaleString(),
        c.total_killed.toLocaleString(),
        c.total_injured.toLocaleString(),
      ]),
      theme: "striped",
      headStyles: { fillColor: [60, 60, 60], textColor: 255, fontSize: 10 },
      styles: { fontSize: 10 },
      margin: { left: margin, right: margin },
    });
  }

  // Footer
  const footerY = doc.internal.pageSize.getHeight() - 24;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(140);
  doc.text(
    "Source: CalSight (calsight.app). Data: CCRS + SWITRS crash records.",
    margin,
    footerY,
  );

  const blob = doc.output("blob");
  const stamp = todayStamp();
  triggerDownload(blob, `calsight-report_${stamp}.pdf`);
}
