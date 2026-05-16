import React, { useMemo, useState } from "react";

interface DataRow {
  label: string;
  value: number;
  x?: number;
  y?: number;
}

interface Props {
  data: DataRow[];
  title: string;
  isScatter: boolean;
  valueLabel: string;
}

type SortKey = "label" | "value" | "x" | "y";
type SortDir = "asc" | "desc";

function ChartDataTable({ data, title, isScatter, valueLabel }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return data;
    const q = search.toLowerCase();
    return data.filter((d) => d.label.toLowerCase().includes(q));
  }, [data, search]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      let av: string | number;
      let bv: string | number;
      if (sortKey === "label") {
        av = a.label.toLowerCase();
        bv = b.label.toLowerCase();
      } else if (sortKey === "x") {
        av = a.x ?? 0;
        bv = b.x ?? 0;
      } else if (sortKey === "y") {
        av = a.y ?? 0;
        bv = b.y ?? 0;
      } else {
        av = a.value;
        bv = b.value;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "label" ? "asc" : "desc");
    }
  }

  function downloadCsv() {
    const headers = isScatter ? ["Label", "Crashes", "Fatalities"] : ["Label", valueLabel];
    const rows = sorted.map((d) =>
      isScatter
        ? [d.label, String(d.x ?? 0), String(d.y ?? 0)]
        : [d.label, String(d.value)]
    );
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <span className="material-symbols-outlined text-[14px] opacity-30">unfold_more</span>;
    return (
      <span className="material-symbols-outlined text-[14px] text-primary">
        {sortDir === "asc" ? "arrow_upward" : "arrow_downward"}
      </span>
    );
  }

  const thClass = "px-2 py-1.5 text-left text-[11px] font-headline font-bold text-on-surface-variant cursor-pointer select-none hover:text-on-surface whitespace-nowrap";
  const tdClass = "px-2 py-1 text-[12px] text-on-surface border-t border-outline-variant/20";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <span className="material-symbols-outlined text-[16px] absolute left-2 top-1/2 -translate-y-1/2 text-on-surface-variant">search</span>
          <input
            type="text"
            placeholder="Filter rows..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-7 pr-2 py-1 text-[12px] rounded-lg bg-surface-container border border-outline-variant/40 text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <button
          onClick={downloadCsv}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-surface-container hover:bg-surface-container-high text-on-surface-variant transition-colors"
          title="Download CSV"
        >
          <span className="material-symbols-outlined text-[14px]">download</span>
          CSV
        </button>
      </div>

      <div className="overflow-y-auto max-h-[300px] rounded-lg border border-outline-variant/30">
        <table className="w-full">
          <thead className="sticky top-0 bg-surface-container z-10">
            <tr>
              <th className={thClass} onClick={() => handleSort("label")}>
                <span className="inline-flex items-center gap-0.5">Label <SortIcon col="label" /></span>
              </th>
              {isScatter ? (
                <>
                  <th className={thClass} onClick={() => handleSort("x")}>
                    <span className="inline-flex items-center gap-0.5">Crashes <SortIcon col="x" /></span>
                  </th>
                  <th className={thClass} onClick={() => handleSort("y")}>
                    <span className="inline-flex items-center gap-0.5">Fatalities <SortIcon col="y" /></span>
                  </th>
                </>
              ) : (
                <th className={thClass} onClick={() => handleSort("value")}>
                  <span className="inline-flex items-center gap-0.5">{valueLabel} <SortIcon col="value" /></span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={isScatter ? 3 : 2} className="px-2 py-4 text-center text-[12px] text-on-surface-variant">
                  No matching rows
                </td>
              </tr>
            ) : (
              sorted.map((d, i) => (
                <tr key={i} className="hover:bg-surface-container/50">
                  <td className={tdClass}>{d.label}</td>
                  {isScatter ? (
                    <>
                      <td className={`${tdClass} tabular-nums`}>{(d.x ?? 0).toLocaleString()}</td>
                      <td className={`${tdClass} tabular-nums`}>{(d.y ?? 0).toLocaleString()}</td>
                    </>
                  ) : (
                    <td className={`${tdClass} tabular-nums`}>{d.value.toLocaleString()}</td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-on-surface-variant text-right">
        {sorted.length} of {data.length} rows
      </p>
    </div>
  );
}

export default React.memo(ChartDataTable);
