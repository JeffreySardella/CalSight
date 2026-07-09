import { useState, useRef, useEffect, useId } from "react";
import type { CorrelationField, CountyRow } from "../../hooks/useCorrelationData";
import { linearRegressionXY } from "../../lib/dashboard/stats";
import { useIsDark } from "../../context/ThemeContext";
import { useDesignTokens } from "../../hooks/useDesignTokens";
import { correlationColor, correlationDotColor, type CorrelationTokens } from "../../lib/theme/tokens";
import { useTextScale } from "../../hooks/useTextScale";

export interface CorrelationActiveFilters {
  severity?: string[];
  alcohol?: boolean;
  pedestrian?: boolean;
  cyclist?: boolean;
  drug?: boolean;
  distracted?: boolean;
  startDate?: string;
  endDate?: string;
}

interface Props {
  fields: CorrelationField[];
  matrix: number[][];
  countyCount: number;
  counties?: CountyRow[];
  activeFilters?: CorrelationActiveFilters;
}

function colorForR(r: number, _isDark: boolean, tokens: CorrelationTokens): string {
  return correlationColor(r, tokens);
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

function DetailScatter({ counties, xField, yField, r, correlationTokens }: {
  counties: CountyRow[];
  xField: CorrelationField;
  yField: CorrelationField;
  r: number;
  correlationTokens: CorrelationTokens;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [svgW, setSvgW] = useState(500);
  const [hover, setHover] = useState<number | null>(null);
  const ts = useTextScale();

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

  const isMobileScatter = typeof window !== "undefined" && window.innerWidth < 640;
  const height = isMobileScatter ? 220 : 280;
  const pad = { top: 16, right: 12, bottom: 36, left: isMobileScatter ? 40 : 56 };
  const cw = svgW - pad.left - pad.right;
  const ch = height - pad.top - pad.bottom;
  const maxX = Math.max(...points.map((p) => p.x), 1);
  const maxY = Math.max(...points.map((p) => p.y), 1);

  const reg = linearRegressionXY(points.map((p) => ({ x: p.x, y: p.y })));

  return (
    <div className="w-full overflow-visible relative mt-3" style={{ height }}>
      <svg ref={svgRef} width="100%" height={height} className="block" role="img" aria-label={`Scatter plot: ${xField.label} vs ${yField.label}, r = ${r.toFixed(2)}`}
        onTouchMove={(e) => {
          const svg = svgRef.current;
          if (!svg || !points.length) return;
          const rect = svg.getBoundingClientRect();
          const tx = e.touches[0].clientX - rect.left;
          const ty = e.touches[0].clientY - rect.top;
          let closest = 0, minDist = Infinity;
          for (let i = 0; i < points.length; i++) {
            const px = pad.left + (points[i].x / maxX) * cw;
            const py = pad.top + ch - (points[i].y / maxY) * ch;
            const d = (tx - px) ** 2 + (ty - py) ** 2;
            if (d < minDist) { minDist = d; closest = i; }
          }
          setHover(closest);
        }}
        onTouchEnd={() => setHover(null)}>
        {[0, 1, 2, 3, 4].map((i) => {
          const v = (maxY / 4) * i;
          const py = pad.top + ch - (v / maxY) * ch;
          return (
            <g key={`y-${i}`}>
              <line x1={pad.left} x2={pad.left + cw} y1={py} y2={py} stroke="rgb(var(--outline-variant))" strokeOpacity={0.15} />
              <text x={pad.left - 6} y={py + 3} textAnchor="end" fontSize={9 * ts} fill="rgb(var(--on-surface-variant))" fontFamily="'Inter Variable', Inter, sans-serif">{fmt((maxY / 4) * i)}</text>
            </g>
          );
        })}
        {[0, 1, 2, 3, 4].map((i) => {
          const v = (maxX / 4) * i;
          const px = pad.left + (v / maxX) * cw;
          return <text key={`x-${i}`} x={px} y={height - pad.bottom + 16} textAnchor="middle" fontSize={9 * ts} fill="rgb(var(--on-surface-variant))" fontFamily="'Inter Variable', Inter, sans-serif">{fmt(v)}</text>;
        })}

        {points.length >= 3 && (() => {
          const y0Val = reg.intercept;
          const yNVal = reg.slope * maxX + reg.intercept;
          const y0 = pad.top + ch - (Math.max(0, Math.min(y0Val, maxY)) / maxY) * ch;
          const yN = pad.top + ch - (Math.max(0, Math.min(yNVal, maxY)) / maxY) * ch;
          return <line x1={pad.left} x2={pad.left + cw} y1={y0} y2={yN} stroke="rgb(var(--error))" strokeWidth={1.5} strokeDasharray="6 3" strokeOpacity={0.5} />;
        })()}

        {points.map((p, i) => {
          if (i === hover) return null;
          const px = pad.left + (p.x / maxX) * cw;
          const py = pad.top + ch - (p.y / maxY) * ch;
          return (
            <circle key={i} cx={px} cy={py} r={3.5} fill={correlationDotColor(r, correlationTokens)} fillOpacity={0.55}
              stroke="rgb(var(--surface))" strokeWidth={0.75}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className="cursor-pointer" />
          );
        })}
        {hover !== null && points[hover] && (() => {
          const p = points[hover];
          const px = pad.left + (p.x / maxX) * cw;
          const py = pad.top + ch - (p.y / maxY) * ch;
          const nearRight = px > pad.left + cw * 0.7;
          const nearTop = py < pad.top + 20;
          return (
            <g>
              <circle cx={px} cy={py} r={6} fill={correlationDotColor(r, correlationTokens)} fillOpacity={0.95}
                stroke="rgb(var(--on-surface))" strokeWidth={1.5}
                onMouseLeave={() => setHover(null)} className="cursor-pointer" />
              <text x={nearRight ? px - 8 : px + 8} y={nearTop ? py + 14 : py - 6} textAnchor={nearRight ? "end" : "start"} fontSize={10 * ts} fontWeight={700} fill="rgb(var(--on-surface))" stroke="rgb(var(--surface))" strokeWidth={3} paintOrder="stroke" fontFamily="'Inter Variable', Inter, sans-serif">
                {p.name}
              </text>
            </g>
          );
        })()}

        <text x={svgW / 2} y={height - 4} textAnchor="middle" fontSize={9 * ts} fontWeight={600} fill="rgb(var(--on-surface-variant))" fontFamily="'Inter Variable', Inter, sans-serif">{xField.label}</text>
        <text x={14} y={height / 2} textAnchor="middle" fontSize={9 * ts} fontWeight={600} fill="rgb(var(--on-surface-variant))" fontFamily="'Inter Variable', Inter, sans-serif" transform={`rotate(-90, 14, ${height / 2})`}>{yField.label}</text>
      </svg>
    </div>
  );
}

function buildFilterSubtitle(f?: CorrelationActiveFilters): string {
  if (!f) return "All crashes statewide (no filters)";
  const parts: string[] = [];
  if (f.severity?.length) parts.push(f.severity.join(", ") + " crashes");
  if (f.alcohol) parts.push("Alcohol-involved");
  if (f.pedestrian) parts.push("Pedestrian-involved");
  if (f.cyclist) parts.push("Cyclist-involved");
  if (f.drug) parts.push("Drug-involved");
  if (f.distracted) parts.push("Distracted-driving");
  if (f.startDate || f.endDate) {
    const range = [f.startDate ?? "earliest", f.endDate ?? "latest"].join(" – ");
    parts.push(range);
  }
  if (parts.length === 0) return "All crashes statewide (no filters)";
  return parts.join(", ");
}

export default function CorrelationMatrix({ fields, matrix, countyCount, counties, activeFilters }: Props) {
  const isDark = useIsDark();
  const tokens = useDesignTokens();
  const titleId = useId();
  const ts = useTextScale();
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
          <h2 className="text-sm font-headline font-bold text-on-surface">Correlation Explorer</h2>
          <p className="text-[11px] text-on-surface-variant">Pearson r across {countyCount} counties — click any cell to explore</p>
          <p className="text-[10px] text-on-surface-variant/70 mt-0.5">Correlating: {buildFilterSubtitle(activeFilters)}</p>
        </div>
        <div className="flex items-center gap-2 text-[9px] text-on-surface-variant" aria-label="Legend: -1 (strong negative, red) to +1 (strong positive, blue)" role="img">
          <div className="flex items-center gap-1"><div className="w-3 h-3 rounded" style={{ backgroundColor: tokens.correlation.negativeStrong }} aria-hidden="true" /><span>-1</span></div>
          <div className="flex items-center gap-1"><div className="w-3 h-3 rounded" style={{ backgroundColor: tokens.correlation.neutral }} aria-hidden="true" /><span>0</span></div>
          <div className="flex items-center gap-1"><div className="w-3 h-3 rounded" style={{ backgroundColor: tokens.correlation.positiveStrong }} aria-hidden="true" /><span>+1</span></div>
        </div>
      </div>

      <p className="text-[9px] text-on-surface-variant/50 sm:hidden mb-1">Swipe to scroll</p>
      {/* Visual grid is mouse-interactive but decorative to assistive tech —
          role="img" flattened its cells out of the a11y tree, so a screen
          reader got one opaque image. The real accessible representation is the
          <table> below (arrow-key navigable, every r-value exposed). */}
      <div style={{ overflowX: "auto", overflowY: "visible", WebkitOverflowScrolling: "touch" }} aria-hidden="true">
        <svg width={svgW} height={svgH} className="block" style={{ overflow: "visible" }}>
          <title id={titleId}>Correlation matrix: Pearson r values across {countyCount} California counties for {n} metrics</title>
          <desc>A {n} by {n} grid showing pairwise Pearson correlation coefficients between crash, demographic, and environmental metrics. Blue cells indicate positive correlations, red cells indicate negative correlations. Click any cell to view a scatter plot.</desc>
          {/* cells first so labels paint on top */}
          {matrix.map((row, i) =>
            row.map((r, j) => {
              const x = labelW + j * cellSize;
              const y = headerH + labelW + i * cellSize;
              const isHovered = hoverCell?.i === i && hoverCell?.j === j;
              const isSelected = selected?.i === i && selected?.j === j;
              return (
                <g key={`${i}-${j}`} role="img" aria-label={`${fields[i].label} vs ${fields[j].label}: r = ${isNaN(r) ? "N/A" : r.toFixed(2)}`} onMouseEnter={() => setHoverCell({ i, j })} onMouseLeave={() => setHoverCell(null)}>
                  <rect x={x + 0.5} y={y + 0.5} width={cellSize - 1} height={cellSize - 1} rx={2} fill={colorForR(r, isDark, tokens.correlation)}
                    opacity={isHovered || isSelected ? 1 : 0.85} stroke={isSelected ? "rgb(var(--on-surface))" : isHovered ? "rgb(var(--outline))" : "none"} strokeWidth={isSelected ? 2 : 1}
                    onClick={() => {
                      if (i === j) { setSelected(null); return; }
                      setSelected(selected?.i === i && selected?.j === j ? null : { i, j });
                    }}
                    className="cursor-pointer" />
                  {cellSize >= 28 && (
                    <text x={x + cellSize / 2} y={y + cellSize / 2 + 3} textAnchor="middle" fontSize={(cellSize >= 36 ? 9 : 7) * ts} fontWeight={700} fill={textColorForR(r, isDark)} fontFamily="'Inter Variable', Inter, sans-serif" style={{ pointerEvents: "none" }}>
                      {isNaN(r) ? "—" : r.toFixed(2)}
                    </text>
                  )}
                </g>
              );
            }),
          )}
          {/* row labels — pointer-events:none so they don't block cell clicks */}
          {fields.map((f, i) => (
            <text key={`row-${i}`} x={labelW - 4} y={headerH + labelW + i * cellSize + cellSize / 2 + 3} textAnchor="end" fontSize={(isMobile ? 7 : 8) * ts} fontWeight={600} fill="rgb(var(--on-surface-variant))" fontFamily="'Inter Variable', Inter, sans-serif" style={{ pointerEvents: "none" }}>{f.label}</text>
          ))}
          {/* column labels — pointer-events:none so they don't block cell clicks */}
          {fields.map((f, j) => {
            const tx = labelW + j * cellSize + cellSize / 2;
            const ty = headerH + labelW - 6;
            return (
              <text key={`col-${j}`} x={tx} y={ty} textAnchor="start" fontSize={(isMobile ? 7 : 9) * ts} fontWeight={600} fill="rgb(var(--on-surface-variant))" fontFamily="'Inter Variable', Inter, sans-serif" transform={`rotate(-55, ${tx}, ${ty})`} style={{ pointerEvents: "none" }}>{f.label}</text>
            );
          })}
        </svg>
      </div>

      {/* Screen-reader-accessible representation of the matrix above.
       * Wrapped in a block-level sr-only div: a bare <table> is display:table,
       * which treats width:1px as a minimum and grows to its content width. As
       * an absolutely-positioned box that escapes the section's overflow clip,
       * it would widen the document and shift the fixed mobile nav. The div
       * (display:block) honors width:1px + overflow:hidden and clips the table. */}
      <div className="sr-only">
        <table>
          <caption>
            Correlation matrix: Pearson r values across {countyCount} California counties for {n} metrics.
          </caption>
          <thead>
            <tr>
              <th scope="col">Metric</th>
              {fields.map((f) => (
                <th key={f.label} scope="col">{f.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, i) => (
              <tr key={fields[i].label}>
                <th scope="row">{fields[i].label}</th>
                {row.map((r, j) => (
                  <td key={j}>{isNaN(r) ? "N/A" : r.toFixed(2)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hoverCell && !selected && (
        <p className="text-xs text-on-surface-variant text-center">
          <span className="font-bold text-on-surface">{fields[hoverCell.i].label}</span>
          {" × "}
          <span className="font-bold text-on-surface">{fields[hoverCell.j].label}</span>
          {" = "}
          {Number.isNaN(matrix[hoverCell.i][hoverCell.j]) ? (
            <span className="font-bold">no data</span>
          ) : (
            <>
              <span className="font-bold" style={{ color: Math.abs(matrix[hoverCell.i][hoverCell.j]) >= 0.2 ? colorForR(matrix[hoverCell.i][hoverCell.j], isDark, tokens.correlation) : undefined }}>r = {matrix[hoverCell.i][hoverCell.j].toFixed(2)}</span>
              {Math.abs(matrix[hoverCell.i][hoverCell.j]) >= 0.7 && " (strong)"}
              {Math.abs(matrix[hoverCell.i][hoverCell.j]) >= 0.4 && Math.abs(matrix[hoverCell.i][hoverCell.j]) < 0.7 && " (moderate)"}
            </>
          )}
        </p>
      )}

      {selected && counties && (
        <div className="bg-surface-container rounded-xl p-3 sm:p-4 overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-bold text-on-surface">
                {fields[selected.i].label} × {fields[selected.j].label}
              </p>
              <p className="text-[10px] text-on-surface-variant">
                {Number.isNaN(matrix[selected.i][selected.j]) ? (
                  "no data — this source didn't load or too few counties report both metrics"
                ) : (
                  <>
                    r = {matrix[selected.i][selected.j].toFixed(2)} — {
                      Math.abs(matrix[selected.i][selected.j]) >= 0.7 ? "strong" :
                      Math.abs(matrix[selected.i][selected.j]) >= 0.4 ? "moderate" :
                      Math.abs(matrix[selected.i][selected.j]) >= 0.2 ? "weak" : "negligible"
                    } {matrix[selected.i][selected.j] >= 0 ? "positive" : "negative"} correlation
                  </>
                )}
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
            correlationTokens={tokens.correlation}
          />
        </div>
      )}
    </div>
  );
}
