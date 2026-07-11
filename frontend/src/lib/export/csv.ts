/**
 * CSV export of /api/crashes results. Client-side paginated — loops through
 * the existing paginated endpoint at the max page size (1000), accumulates
 * rows in memory, builds a CSV string, and triggers a Blob download.
 *
 * Capped at MAX_EXPORT_ROWS to keep the browser tab responsive on very large
 * scopes (e.g. all of LA County is ~6M crashes; nobody is opening a CSV that
 * size in Excel anyway). For larger exports we'd need a streaming backend
 * endpoint — see the file 43-line comment in backend/app/routers/crashes.py.
 */

import { API_BASE } from "../../config";
import { triggerDownload, todayStamp } from "./download";

export const MAX_EXPORT_ROWS = 50_000;
const PAGE_SIZE = 1000;

interface CrashRow {
  id: number;
  collision_id: number;
  data_source: string | null;
  crash_datetime: string;
  county_code: number;
  county_name: string | null;
  city_name: string | null;
  latitude: number | null;
  longitude: number | null;
  severity: string | null;
  canonical_cause: string | null;
  primary_factor: string | null;
  number_killed: number | null;
  number_injured: number | null;
  weather: string | null;
  road_condition: string | null;
  lighting: string | null;
  is_alcohol_involved: boolean | null;
  is_distraction_involved: boolean | null;
  pedestrian_involved: boolean | null;
}

interface CrashesResponse {
  items: CrashRow[];
  limit: number;
  offset: number;
  total: number | null;
}

const COLUMNS: { key: keyof CrashRow; header: string }[] = [
  { key: "id", header: "id" },
  { key: "collision_id", header: "collision_id" },
  { key: "data_source", header: "data_source" },
  { key: "crash_datetime", header: "crash_datetime" },
  { key: "county_code", header: "county_code" },
  { key: "county_name", header: "county_name" },
  { key: "city_name", header: "city_name" },
  { key: "latitude", header: "latitude" },
  { key: "longitude", header: "longitude" },
  { key: "severity", header: "severity" },
  { key: "canonical_cause", header: "canonical_cause" },
  { key: "primary_factor", header: "primary_factor" },
  { key: "number_killed", header: "number_killed" },
  { key: "number_injured", header: "number_injured" },
  { key: "weather", header: "weather" },
  { key: "road_condition", header: "road_condition" },
  { key: "lighting", header: "lighting" },
  { key: "is_alcohol_involved", header: "is_alcohol_involved" },
  { key: "is_distraction_involved", header: "is_distraction_involved" },
  { key: "pedestrian_involved", header: "pedestrian_involved" },
];

/** RFC 4180-flavored escape: quote if the value contains comma, quote, CR,
 *  or LF; double internal quotes. null/undefined → empty cell.
 *
 *  Also neutralizes CSV formula injection: a cell that begins with =, +, -, @,
 *  tab, or CR can be executed as a formula by Excel / Google Sheets, so such a
 *  value is prefixed with a single quote. Genuine numeric cells (e.g. negative
 *  longitudes like -118.24) are left untouched — only non-numeric values that
 *  start with a dangerous character are guarded. */
export function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  const isNumber = typeof v === "number" && Number.isFinite(v);
  if (!isNumber && /^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildCsv(rows: CrashRow[]): string {
  const lines = [COLUMNS.map((c) => c.header).join(",")];
  for (const row of rows) {
    lines.push(COLUMNS.map((c) => csvEscape(row[c.key])).join(","));
  }
  // CRLF endings — Excel-safe on Windows, ignored elsewhere.
  return lines.join("\r\n");
}

export type CsvProgress =
  | { phase: "counting" }
  | { phase: "fetching"; fetched: number; total: number }
  | { phase: "building" }
  | { phase: "done" };

export interface CsvExportOptions {
  /** Pre-built query string from buildFilterQS — e.g. "severity=fatal&year=2023". */
  filterQs: string;
  /** Suffix added to the filename, e.g. "_los-angeles_2023-01_2023-12". */
  filenameSuffix?: string;
  /** Called for each progress event so the UI can reflect status. */
  onProgress?: (p: CsvProgress) => void;
  /** Aborts the in-flight fetch loop. */
  signal?: AbortSignal;
}

export class CsvExportTooLargeError extends Error {
  constructor(public total: number) {
    super(
      `Your filters select ${total.toLocaleString()} crashes, which exceeds the ` +
      `${MAX_EXPORT_ROWS.toLocaleString()}-row export limit. Narrow your filters and try again.`,
    );
    this.name = "CsvExportTooLargeError";
  }
}

export class CsvExportEmptyError extends Error {
  constructor() {
    super("No crashes match the current filters — nothing to export.");
    this.name = "CsvExportEmptyError";
  }
}

async function fetchPage(filterQs: string, offset: number, includeTotal: boolean, signal?: AbortSignal): Promise<CrashesResponse> {
  const sp = new URLSearchParams(filterQs);
  sp.set("limit", String(PAGE_SIZE));
  sp.set("offset", String(offset));
  if (includeTotal) sp.set("include_total", "true");
  const res = await fetch(`${API_BASE}/api/crashes?${sp.toString()}`, { signal });
  if (!res.ok) {
    throw new Error(`/api/crashes ${res.status}`);
  }
  return res.json();
}

export async function exportCsv(opts: CsvExportOptions): Promise<void> {
  const { filterQs, filenameSuffix = "", onProgress, signal } = opts;

  // First page also carries the total so we get count + first batch in one
  // round trip.
  onProgress?.({ phase: "counting" });
  const firstPage = await fetchPage(filterQs, 0, true, signal);

  const total = firstPage.total;
  if (total === null) {
    // Backend refused include_total — usually means no filter was set.
    // Caller is expected to have validated this, so treat as a programmer
    // error rather than a user-facing one.
    throw new Error(
      "Server declined to compute a row count for the export. Apply at least " +
      "one filter (county, year, severity, etc.) and try again.",
    );
  }
  if (total > MAX_EXPORT_ROWS) {
    throw new CsvExportTooLargeError(total);
  }
  if (total === 0) {
    throw new CsvExportEmptyError();
  }

  const rows: CrashRow[] = [...firstPage.items];
  onProgress?.({ phase: "fetching", fetched: rows.length, total });

  while (rows.length < total) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const page = await fetchPage(filterQs, rows.length, false, signal);
    if (page.items.length === 0) break; // Defensive — shouldn't happen mid-fetch.
    rows.push(...page.items);
    onProgress?.({ phase: "fetching", fetched: rows.length, total });
  }

  onProgress?.({ phase: "building" });
  const csv = buildCsv(rows);
  // BOM so Excel reads UTF-8 with non-ASCII characters (county names with
  // accents, road names, etc.) correctly.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, `calsight-crashes_${todayStamp()}${filenameSuffix}.csv`);
  onProgress?.({ phase: "done" });
}
