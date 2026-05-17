import { useState, useRef, useEffect } from "react";
import type { CorrelationField, CountyRow } from "../../hooks/useCorrelationData";
import { linearRegressionXY } from "../../lib/dashboard/stats";
import { useIsDark } from "../../context/ThemeContext";

interface Props {
  fields: CorrelationField[];
  matrix: number[][];
  countyCount: number;
  counties?: CountyRow[];
}

function colorForR(r: number, isDark: boolean): string {
  if (r >= 0.7) return "#1d4ed8";
  if (r >= 0.4) return "#3b82f6";
  if (r >= 0.2) return "#93c5fd";
  if (r > -0.2) return isDark ? "#3f3f46" : "#e5e7eb";
  if (r > -0.4) return "#fca5a5";
  if (r > -0.7) return "#ef4444";
  return "#991b1b";
}

function textColorForR(r: number, isDark: boolean): string {
  // Strong correlation: white text on saturated blue/red backgrounds
  if (Math.abs(r) >= 0.4) return "#ffffff";
  // Weak positive/negative: colored bg is mid-tone, use dark text for contrast
  if (Math.abs(r) >= 0.2) return "#1f1f23";
  // Near-zero: neutral bg adapts to mode
  return isDark ? "#e4e4e7" : "#1f1f23";
}

function fmt(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  if (v >= 100) return Math.round(v).toString();
  if (v >= 1) return v.toFixed(1);
  return v.toFixed(2);
}

function DetailScatter({ counties, xField, yField, r }: {
  counties: CountyRow[];
  xField: CorrelationField;
  yField: CorrelationField;
  r: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [svgW, setSvgW] = useState(500);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    setSvgW(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setSvgW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const points = counties
    .map((c) => ({ name: String(c._name ?? "?"), x: Number(c[xField.key] ?? 0), y: Number(c[yField.key] ?? 0) }))
    .filter((p) => isFinite(p.x) && isFinite(p.y) && (p.x !== 0 || p.y !== 0));

  if (points.length < 3) return <p className="text-sm text-on-surface-variant">Insufficient data</p>;

  const height = 280;
  const pad = { top: 20, right: 20, bottom: 40, left: 56 };
  const cw = svgW - pad.left - pad.right;
  const ch = height - pad.top - pad.bottom;
  const maxX = Math.max(...points.map((p) => p.x), 1);
  const maxY = Math.max(...points.map((p) => p.y), 1);

  const reg = linearRegressionXY(points.map((p) => ({ x: p.x, y: p.y })));

  return (
    <div className="w-full overflow-visible relative mt-3" style={{ height }}>
      <svg ref={svgRef} width="100%" height={height} className="block">
        {[0, 1, 2, 3, 4].map((i) => {
          const v = (maxY / 4) * i;
          const py = pad.top + ch - (v / maxY) * ch;
          return (
            <g key={`y-${i}`}>
              <line x1={pad.left} x2={pad.left + cw} y1={py} y2={py} stroke="rgb(var(--outline-variant))" strokeOpacity={0.15} />
              <text x={pad.left - 6} y={py + 3} textAnchor="end" fontSize={9} fill="rgb(var(--on-surface-variant))" fontFamily="'Inter Variable', Inter, sans-serif">{fmt((maxY / 4) * i)}</text>
            </g>
          );
        })}
        {[0, 1, 2, 3, 4].map((i) => {
          const v = (maxX / 4) * i;
          const px = pad.left + (v / maxX) * cw;
          return <text key={`x-${i}`} x={px} y={height - pad.bottom + 16} textAnchor="middle" fontSize={9} fill="rgb(var(--on-surface-variant))" fontFamily="'Inter Variable', Inter, sans-serif">{fmt(v)}</text>;
        })}

        {points.length >= 3 && (() => {
          const y0Val = reg.intercept;
          const yNVal = reg.slope * maxX + reg.intercept;
          const y0 = pad.top + ch - (Math.max(0, Math.min(y0Val, maxY)) / maxY) * ch;
          const yN = pad.top + ch - (Math.max(0, Math.min(yNVal, maxY)) / maxY) * ch;
          return <line x1={pad.left} x2={pad.left + cw} y1={y0} y2={yN} stroke="rgb(var(--error))" strokeWidth={1.5} strokeDasharray="6 3" strokeOpacity={0.5} />;
        })()}

        {points.map((p, i) => {
          const px = pad.left + (p.x / maxX) * cw;
          const py = pad.top + ch - (p.y / maxY) * ch;
          const isH = hover === i;
          return (
            <g key={i}>
              <circle cx={px} cy={py} r={isH ? 6 : 4} fill={r >= 0 ? "#2563eb" : "#dc2626"} fillOpacity={isH ? 0.95 : 0.6}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className="cursor-pointer" />
              {isH && (
                <text x={px + 8} y={py - 4} fontSize={9} fontWeight={700} fill="rgb(var(--on-surface))" fontFamily="'Inter Variable', Inter, sans-serif">
                  {p.name}
                </text>
              )}
            </g>
          );
        })}

        <text x={svgW / 2} y={height - 4} textAnchor="middle" fontSize={9} fontWeight={600} fill="rgb(var(--on-surface-variant))" fontFamily="'Inter Variable', Inter, sans-serif">{xField.label}</text>
        <text x={14} y={height / 2} textAnchor="middle" fontSize={9} fontWeight={600} fill="rgb(var(--on-surface-variant))" fontFamily="'Inter Variable', Inter, sans-serif" transform={`rotate(-90, 14, ${height / 2})`}>{yField.label}</text>
      </svg>
    </div>
  );
}

export default function CorrelationMatrix({ fields, matrix, countyCount, counties }: Props) {
  const isDark = useIsDark();
  const [hoverCell, setHoverCell] = useState<{ i: number; j: number } | null>(null);
  const [selected, setSelected] = useState<{ i: number; j: number } | null>(null);
  const [windowWidth, setWindowWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1024,
  );

  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const n = fields.length;
  const isMobile = windowWidth < 768;
  const cellSize = isMobile ? 24 : 36;
  const labelW = isMobile ? 64 : 84;
  const headerH = isMobile ? 70 : 90;
  const svgW = labelW + n * cellSize;
  const gridH = labelW + n * cellSize;
  const svgH = headerH + gridH;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-headline font-bold text-on-surface">Correlation Explorer</h3>
          <p className="text-[10px] text-on-surface-variant">Pearson r across {countyCount} counties — click any cell to explore</p>
        </div>
        <div className="flex items-center gap-2 text-[9px] text-on-surface-variant">
          <div className="flex items-center gap-1"><div className="w-3 h-3 rounded" style={{ backgroundColor: "#991b1b" }} /><span>-1</span></div>
          <div className="flex items-center gap-1"><div className="w-3 h-3 rounded" style={{ backgroundColor: isDark ? "#3f3f46" : "#e5e7eb" }} /><span>0</span></div>
          <div className="flex items-center gap-1"><div className="w-3 h-3 rounded" style={{ backgroundColor: "#1d4ed8" }} /><span>+1</span></div>
        </div>
      </div>

      <div style={{ overflowX: "auto", overflowY: "visible" }}>
        <svg width={svgW} height={svgH} className="block" style={{ overflow: "visible" }}>
          {/* cells first so labels paint on top */}
          {matrix.map((row, i) =>
            row.map((r, j) => {
              const x = labelW + j * cellSize;
              const y = headerH + labelW + i * cellSize;
              const isHovered = hoverCell?.i === i && hoverCell?.j === j;
              const isSelected = selected?.i === i && selected?.j === j;
              return (
                <g key={`${i}-${j}`} onMouseEnter={() => setHoverCell({ i, j })} onMouseLeave={() => setHoverCell(null)}
                  onClick={() => i !== j && setSelected(selected?.i === i && selected?.j === j ? null : { i, j })} className="cursor-pointer">
                  <rect x={x + 0.5} y={y + 0.5} width={cellSize - 1} height={cellSize - 1} rx={2} fill={colorForR(r, isDark)}
                    opacity={isHovered || isSelected ? 1 : 0.85} stroke={isSelected ? "rgb(var(--on-surface))" : isHovered ? "rgb(var(--outline))" : "none"} strokeWidth={isSelected ? 2 : 1} />
                  {cellSize >= 28 && (
                    <text x={x + cellSize / 2} y={y + cellSize / 2 + 3} textAnchor="middle" fontSize={cellSize >= 36 ? 9 : 7} fontWeight={700} fill={textColorForR(r, isDark)} fontFamily="'Inter Variable', Inter, sans-serif">
                      {i === j ? "" : r.toFixed(2)}
                    </text>
                  )}
                </g>
              );
            }),
          )}
          {/* row labels */}
          {fields.map((f, i) => (
            <text key={`row-${i}`} x={labelW - 4} y={headerH + labelW + i * cellSize + cellSize / 2 + 3} textAnchor="end" fontSize={isMobile ? 7 : 8} fontWeight={600} fill="rgb(var(--on-surface-variant))" fontFamily="'Inter Variable', Inter, sans-serif">{f.label}</text>
          ))}
          {/* column labels — anchored at top edge of cell grid, rotated upward */}
          {fields.map((f, j) => {
            const tx = labelW + j * cellSize + cellSize / 2;
            const ty = headerH + labelW - 6;
            return (
              <text key={`col-${j}`} x={tx} y={ty} textAnchor="start" fontSize={isMobile ? 7 : 9} fontWeight={600} fill="rgb(var(--on-surface-variant))" fontFamily="'Inter Variable', Inter, sans-serif" transform={`rotate(-55, ${tx}, ${ty})`}>{f.label}</text>
            );
          })}
        </svg>
      </div>

      {hoverCell && !selected && (
        <p className="text-xs text-on-surface-variant text-center">
          <span className="font-bold text-on-surface">{fields[hoverCell.i].label}</span>
          {" × "}
          <span className="font-bold text-on-surface">{fields[hoverCell.j].label}</span>
          {" = "}
          <span className="font-bold" style={{ color: Math.abs(matrix[hoverCell.i][hoverCell.j]) >= 0.2 ? colorForR(matrix[hoverCell.i][hoverCell.j], isDark) : undefined }}>r = {matrix[hoverCell.i][hoverCell.j].toFixed(2)}</span>
          {Math.abs(matrix[hoverCell.i][hoverCell.j]) >= 0.7 && " (strong)"}
          {Math.abs(matrix[hoverCell.i][hoverCell.j]) >= 0.4 && Math.abs(matrix[hoverCell.i][hoverCell.j]) < 0.7 && " (moderate)"}
        </p>
      )}

      {selected && counties && (
        <div className="bg-surface-container rounded-xl p-4">
          <div className="flex items-center justify-between mb-1">
            <div>
              <p className="text-sm font-bold text-on-surface">
                {fields[selected.i].label} × {fields[selected.j].label}
              </p>
              <p className="text-[10px] text-on-surface-variant">
                r = {matrix[selected.i][selected.j].toFixed(2)} — {
                  Math.abs(matrix[selected.i][selected.j]) >= 0.7 ? "strong" :
                  Math.abs(matrix[selected.i][selected.j]) >= 0.4 ? "moderate" :
                  Math.abs(matrix[selected.i][selected.j]) >= 0.2 ? "weak" : "negligible"
                } {matrix[selected.i][selected.j] >= 0 ? "positive" : "negative"} correlation
              </p>
            </div>
            <button onClick={() => setSelected(null)} className="p-1 rounded-full hover:bg-surface-container-high text-on-surface-variant" aria-label="Close scatter plot detail">
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">close</span>
            </button>
          </div>
          <DetailScatter
            counties={counties}
            xField={fields[selected.i]}
            yField={fields[selected.j]}
            r={matrix[selected.i][selected.j]}
          />
        </div>
      )}
    </div>
  );
}
