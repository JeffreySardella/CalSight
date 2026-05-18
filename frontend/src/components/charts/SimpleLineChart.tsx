import { useState, useRef, useCallback, useEffect, useId } from "react";
import ChartTooltip from "./ChartTooltip";
import { linearRegression, mean as calcMean, stddev as calcStddev } from "../../lib/dashboard/stats";
import { useChartAnimation } from "../../hooks/useChartAnimation";

interface LinePoint {
  label: string;
  value: number;
}

export interface ForecastPoint {
  label: string;
  value: number;
  upper: number;
  lower: number;
}

interface SimpleLineChartProps {
  data: LinePoint[];
  height?: number;
  color?: string;
  showDots?: boolean;
  showYAxis?: boolean;
  showArea?: boolean;
  showTrendLine?: boolean;
  showMeanLine?: boolean;
  showStdBand?: boolean;
  showOutliers?: boolean;
  forecastData?: ForecastPoint[];
  renderTooltip?: (item: LinePoint, idx: number) => React.ReactNode;
  title?: string;
}

function formatNumber(val: number): string {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return val.toLocaleString();
}

export default function SimpleLineChart({
  data,
  height = 180,
  color = "rgb(var(--primary))",
  showDots = true,
  showYAxis = true,
  showArea = false,
  showTrendLine = false,
  showMeanLine = false,
  showStdBand = false,
  forecastData,
  showOutliers = false,
  renderTooltip,
  title,
}: SimpleLineChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);
  const [svgWidth, setSvgWidth] = useState(400);
  const titleId = useId();
  const { progress } = useChartAnimation(svgRef);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSvgWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGCircleElement | SVGRectElement>, idx: number) => {
    setHover({ idx, x: e.clientX, y: e.clientY });
  }, []);

  const pointsRef = useRef<{ x: number }[]>([]);

  const handleTouchScrub = useCallback((e: React.TouchEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || pointsRef.current.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const touchX = e.touches[0].clientX - rect.left;
    let closest = 0;
    let minDist = Infinity;
    for (let i = 0; i < pointsRef.current.length; i++) {
      const d = Math.abs(pointsRef.current[i].x - touchX);
      if (d < minDist) { minDist = d; closest = i; }
    }
    setHover({ idx: closest, x: e.touches[0].clientX, y: e.touches[0].clientY });
  }, []);

  if (!data.length) return null;

  const dataMax = Math.max(...data.map((d) => d.value), 1);
  // When forecast is enabled, scale the Y axis to include forecast upper bounds
  // so the actual data line and forecast band share a single consistent scale.
  const maxVal = forecastData && forecastData.length > 0
    ? Math.max(dataMax, ...forecastData.map(f => f.upper))
    : dataMax;
  const yAxisW = showYAxis ? 54 : 0;
  const padding = { top: 16, right: 16, bottom: 32, left: yAxisW + 8 };
  const chartH = height - padding.top - padding.bottom;
  const chartW = Math.max(svgWidth - padding.left - padding.right, 0);
  const n = data.length;

  const yTicks = 4;
  const yTickVals = Array.from({ length: yTicks + 1 }, (_, i) => Math.round((maxVal / yTicks) * i));

  const points = n >= 2
    ? data.map((d, i) => ({
        x: padding.left + (i / (n - 1)) * chartW,
        y: padding.top + chartH - (d.value / maxVal) * chartH,
      }))
    : [{ x: padding.left + chartW / 2, y: padding.top + chartH - (data[0].value / maxVal) * chartH }];
  pointsRef.current = points;

  const pathD = points.length >= 2
    ? points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ")
    : "";

  const pathLength = points.length >= 2
    ? points.reduce((len, p, i) => i === 0 ? 0 : len + Math.sqrt((p.x - points[i - 1].x) ** 2 + (p.y - points[i - 1].y) ** 2), 0)
    : 0;

  const interval = n > 12 ? Math.ceil(n / 6) : 1;
  const trendR2 = showTrendLine && points.length >= 2 ? linearRegression(data.map(d => d.value)).r2 : null;

  return (
    <div className="w-full overflow-visible relative" style={{ height }}>
      {trendR2 !== null && (
        <span className="absolute bottom-8 right-1 z-10 text-[9px] font-bold text-on-surface-variant bg-surface-container/80 rounded px-1.5 py-0.5">
          R²={trendR2.toFixed(2)}
        </span>
      )}
      <svg ref={svgRef} width="100%" height={height} className="block overflow-visible touch-none" role="img" aria-labelledby={title ? titleId : undefined}
        onTouchMove={handleTouchScrub} onTouchEnd={() => setHover(null)}>
        {title && <title id={titleId}>{title}</title>}
        {showYAxis && yTickVals.map((v) => {
          const y = padding.top + chartH - (v / maxVal) * chartH;
          return (
            <g key={v}>
              <line x1={padding.left} x2={svgWidth - padding.right} y1={y} y2={y} stroke="rgb(var(--outline-variant))" strokeOpacity={0.2} />
              <text x={Math.max(padding.left - 6, 2)} y={y + 3} textAnchor="end" fontSize={10} fill="rgb(var(--on-surface-variant))" fontFamily="'Inter Variable', Inter, sans-serif">
                {formatNumber(v)}
              </text>
            </g>
          );
        })}

        {pathD && showArea && points.length >= 2 && (
          <path
            d={`${pathD} L ${points[points.length - 1].x} ${padding.top + chartH} L ${points[0].x} ${padding.top + chartH} Z`}
            fill={color}
            fillOpacity={0.2 * progress}
            stroke="none"
          />
        )}
        {pathD && (
          <path
            d={pathD}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeDasharray={pathLength || undefined}
            strokeDashoffset={pathLength * (1 - progress)}
          />
        )}

        {points.map((p, i) => {
          const dotProgress = n > 1 ? Math.max(0, Math.min(1, (progress * n - i))) : progress;
          return (
          <g key={i}>
            {showDots && (
              <circle cx={p.x} cy={p.y} r={hover?.idx === i ? 5 : 3} fill={color} stroke="rgb(var(--surface))" strokeWidth={1.5}
                style={{ opacity: dotProgress, transform: `scale(${dotProgress})`, transformOrigin: `${p.x}px ${p.y}px`, transition: "r 0.15s ease" }} />
            )}
            <rect
              x={p.x - (n >= 2 ? chartW / n / 2 : 20)}
              y={padding.top}
              width={Math.max(n >= 2 ? chartW / n : 40, 1)}
              height={Math.max(chartH, 0)}
              fill="transparent"
              onMouseMove={(e) => handleMouseMove(e, i)}
              onMouseLeave={() => setHover(null)}
              className="cursor-pointer"
            />
            {i % interval === 0 && (
              <text
                x={p.x}
                y={height - padding.bottom + 16}
                textAnchor="middle"
                fontSize={10}
                fill="rgb(var(--on-surface-variant))"
                fontFamily="'Inter Variable', Inter, sans-serif"
              >
                {data[i].label}
              </text>
            )}
          </g>
        );
        })}

        {showMeanLine && (() => {
          const m = calcMean(data.map(d => d.value));
          const yM = padding.top + chartH - (m / maxVal) * chartH;
          return (
            <g>
              <line x1={padding.left} x2={padding.left + chartW} y1={yM} y2={yM} stroke="rgb(var(--error))" strokeWidth={1} strokeDasharray="6 3" strokeOpacity={0.6} />
              <text x={padding.left + chartW - 4} y={yM + 3} textAnchor="end" fontSize={8} fontWeight={700} fill="rgb(var(--error))" fillOpacity={0.7} fontFamily="'Inter Variable', Inter, sans-serif">AVG</text>
            </g>
          );
        })()}

        {showStdBand && points.length >= 3 && (() => {
          const vals = data.map(d => d.value);
          const m = calcMean(vals);
          const sd = calcStddev(vals);
          const yUpper = padding.top + chartH - (Math.min(m + sd, maxVal) / maxVal) * chartH;
          const yLower = padding.top + chartH - (Math.max(m - sd, 0) / maxVal) * chartH;
          return (
            <rect
              x={padding.left}
              y={yUpper}
              width={Math.max(chartW, 0)}
              height={Math.max(yLower - yUpper, 0)}
              fill="rgb(var(--primary))"
              fillOpacity={0.08}
              rx={4}
            />
          );
        })()}

        {showOutliers && points.length >= 4 && (() => {
          const vals = data.map(d => d.value);
          const m = calcMean(vals);
          const sd = calcStddev(vals);
          return points.map((p, i) => {
            const z = sd > 0 ? Math.abs((data[i].value - m) / sd) : 0;
            if (z < 2) return null;
            return (
              <g key={`outlier-${i}`}>
                <circle cx={p.x} cy={p.y} r={8} fill="none" stroke="rgb(var(--error))" strokeWidth={1.5} strokeDasharray="3 2" />
                <text x={p.x} y={p.y - 12} textAnchor="middle" fontSize={8} fontWeight={700} fill="rgb(var(--error))" fontFamily="'Inter Variable', Inter, sans-serif">
                  {z.toFixed(1)}σ
                </text>
              </g>
            );
          });
        })()}

        {showTrendLine && points.length >= 2 && (() => {
          const reg = linearRegression(data.map(d => d.value));
          const y0 = padding.top + chartH - ((reg.intercept) / maxVal) * chartH;
          const yN = padding.top + chartH - ((reg.slope * (n - 1) + reg.intercept) / maxVal) * chartH;
          return (
            <line x1={points[0].x} x2={points[points.length - 1].x} y1={y0} y2={yN} stroke="rgb(var(--tertiary))" strokeWidth={1.5} strokeDasharray="8 4" strokeOpacity={0.7} />
          );
        })()}

        {hover !== null && points[hover.idx] && (
          <line
            x1={points[hover.idx].x}
            x2={points[hover.idx].x}
            y1={padding.top}
            y2={padding.top + chartH}
            stroke={color}
            strokeOpacity={0.3}
            strokeDasharray="4 2"
          />
        )}

        {forecastData && forecastData.length > 0 && (() => {
          const lastPt = points[points.length - 1];
          if (!lastPt) return null;
          // maxVal already includes forecast upper bounds (computed above),
          // so we use the same scale as the main data line.
          const yScale = (v: number) => padding.top + chartH - (v / maxVal) * chartH;
          const stepX = n > 1 ? (points[1].x - points[0].x) : chartW / 4;
          const maxX = svgWidth - padding.right;
          const fcPts = forecastData.map((f, i) => ({
            x: Math.min(lastPt.x + (i + 1) * stepX, maxX),
            yPred: yScale(f.value),
            yUpper: yScale(f.upper),
            yLower: yScale(f.lower),
          }));
          const bandPoly = [
            `${lastPt.x},${yScale(data[data.length - 1].value)}`,
            ...fcPts.map(p => `${p.x},${p.yUpper}`),
            ...[...fcPts].reverse().map(p => `${p.x},${p.yLower}`),
            `${lastPt.x},${yScale(data[data.length - 1].value)}`,
          ].join(" ");
          const fcPath = [`M ${lastPt.x} ${yScale(data[data.length - 1].value)}`, ...fcPts.map(p => `L ${p.x} ${p.yPred}`)].join(" ");
          return (
            <g>
              <line x1={lastPt.x} x2={lastPt.x} y1={padding.top} y2={padding.top + chartH} stroke="rgb(var(--outline-variant))" strokeWidth={1} strokeDasharray="4 4" strokeOpacity={0.5} />
              <text x={lastPt.x + 4} y={padding.top + 10} fontSize={8} fill="rgb(var(--on-surface-variant))" fillOpacity={0.7} fontFamily="'Inter Variable', Inter, sans-serif">FORECAST</text>
              <polygon points={bandPoly} fill="rgb(var(--tertiary))" fillOpacity={0.1} />
              <path d={fcPath} fill="none" stroke="rgb(var(--tertiary))" strokeWidth={2} strokeDasharray="8 4" strokeOpacity={0.8} />
              {fcPts.map((p, i) => (
                <circle key={`fc-${i}`} cx={p.x} cy={p.yPred} r={3.5} fill="rgb(var(--surface))" stroke="rgb(var(--tertiary))" strokeWidth={1.5} />
              ))}
              {fcPts.map((p, i) => (
                <text key={`fl-${i}`} x={p.x} y={height - padding.bottom + 16} textAnchor="middle" fontSize={9} fontStyle="italic" fill="rgb(var(--tertiary))" fillOpacity={0.7} fontFamily="'Inter Variable', Inter, sans-serif">{forecastData[i].label}</text>
              ))}
            </g>
          );
        })()}
      </svg>
      <ChartTooltip x={hover?.x ?? 0} y={hover?.y ?? 0} visible={hover !== null} containerRef={svgRef}>
        {hover !== null && renderTooltip?.(data[hover.idx], hover.idx)}
      </ChartTooltip>
    </div>
  );
}
