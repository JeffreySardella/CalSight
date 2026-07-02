import { useState } from "react";
import {
  useStreetAggregation,
  type StreetScope,
  type StreetAggRow,
} from "../../hooks/useIntersections";
import { useFilterParams, slugify } from "../../hooks/useFilterParams";
import { Skeleton } from "../ui/Skeleton";
import { EmptyState } from "../ui/EmptyState";
import { ErrorState } from "../ui/ErrorState";

const SCOPES: { value: StreetScope; label: string }[] = [
  { value: "intersections", label: "Intersections" },
  { value: "corridors", label: "Corridors" },
];

// Backend defaults differ per scope; mirror them so counts read consistently.
const MIN_CRASHES: Record<StreetScope, number> = {
  intersections: 2,
  corridors: 5,
};

const EMPTY_COPY: Record<StreetScope, string> = {
  intersections: "No intersections match these filters.",
  corridors: "No corridors match these filters.",
};

function roadLabel(row: StreetAggRow): string {
  if (row.secondary_road) return `${row.primary_road} & ${row.secondary_road}`;
  return row.primary_road;
}

export default function IntersectionsPanel() {
  const [scope, setScope] = useState<StreetScope>("intersections");
  const filters = useFilterParams();

  // Exactly one county selected → scope the query to that county; otherwise
  // (zero or many) query statewide.
  const counties = filters.selectedCounties;
  const singleCounty = counties.size === 1 ? [...counties][0] : null;
  const countySlug = singleCounty ? slugify(singleCounty) : null;

  const range = filters.selectedDateRange;
  const yearStart = range?.start?.year ?? null;
  const yearEnd = range?.end?.year ?? null;

  const { data, isLoading, error, refetch } = useStreetAggregation({
    scope,
    county: countySlug,
    yearStart,
    yearEnd,
    minCrashes: MIN_CRASHES[scope],
    limit: 25,
  });

  const rows = data ?? [];

  return (
    <section className="space-y-3" aria-label="Street-level crash aggregation">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-on-surface font-headline">
            {scope === "intersections" ? "Intersections by crash count" : "Corridors by crash count"}
          </h2>
          <p className="text-[11px] text-on-surface-variant mt-0.5">
            {singleCounty ? `${singleCounty} County` : "Statewide"} · Ranked by crash count
          </p>
        </div>
        <div
          role="radiogroup"
          aria-label="Aggregation scope"
          className="flex gap-1 rounded-lg bg-surface-container p-1"
        >
          {SCOPES.map((s) => (
            <button
              key={s.value}
              type="button"
              role="radio"
              aria-checked={scope === s.value}
              onClick={() => setScope(s.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                scope === s.value
                  ? "bg-primary-container text-on-primary-container"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </header>

      {isLoading ? (
        <div className="space-y-1.5" aria-busy="true" aria-label="Loading results">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : error ? (
        <ErrorState
          className="py-10"
          title="Couldn't load results"
          description="The server may be temporarily unavailable. Please try again."
          onRetry={() => refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          className="py-10"
          icon="location_off"
          description={EMPTY_COPY[scope]}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg bg-surface-container-lowest ghost-border">
          <table className="w-full text-xs">
            <caption className="sr-only">
              {scope === "intersections" ? "Intersections" : "Corridors"} ranked by crash count
            </caption>
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-on-surface-variant">
                <th scope="col" className="text-left px-3 py-2 font-bold">#</th>
                <th scope="col" className="text-left px-3 py-2 font-bold">
                  {scope === "intersections" ? "Intersection" : "Road"}
                </th>
                <th scope="col" className="text-right px-3 py-2 font-bold">Crashes</th>
                <th scope="col" className="text-right px-3 py-2 font-bold">Fatal</th>
                <th scope="col" className="text-right px-3 py-2 font-bold">Injury</th>
                <th scope="col" className="text-right px-3 py-2 font-bold">PDO</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={`${r.county_code}-${r.primary_road}-${r.secondary_road ?? ""}-${i}`}
                  className="border-t border-outline-variant/20 hover:bg-surface-container/40 transition-colors"
                >
                  <th
                    scope="row"
                    className="px-3 py-2 text-left font-normal text-on-surface-variant tabular-nums"
                  >
                    {i + 1}
                  </th>
                  <td className="px-3 py-2 font-bold text-on-surface">{roadLabel(r)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-bold text-on-surface">
                    {r.crash_count.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-on-surface-variant">
                    {r.fatal_count.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-on-surface-variant">
                    {r.injury_count.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-on-surface-variant">
                    {r.pdo_count.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
