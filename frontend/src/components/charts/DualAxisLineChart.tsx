import { useState, useRef, useCallback, useEffect, useId } from "react";
import ChartTooltip from "./ChartTooltip";
import { useChartAnimation } from "../../hooks/useChartAnimation";
import { useTextScale } from "../../hooks/useTextScale";

export interface DualAxisPoint {
  label: string;
  primary: number;
  secondary: number;
}

interface DualAxisLineChartProps {
  data: DualAxisPoint[];
  height?: number;
  primaryColor?: string;
  secondaryColor?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  showArea?: boolean;
  renderTooltip?: (item: DualAxisPoint, idx: number) => React.ReactNode;
  title?: string;
}

function formatNumber(val: number): string {
  if (Math.abs(val) >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (Math.abs(val) >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  if (Math.abs(val) < 1 && val !== 0) return val.toFixed(2);
  return val.toLocaleString();
}

function niceScale(maxVal: number, ticks: number): number[] {
  if (maxVal <= 0) return Array.from({ length: ticks + 1 }, (_, i) => i);
  const rawStep = maxVal / ticks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const residual = rawStep / magnitude;
  let niceStep: number;
  if (residual <= 1.5) niceStep = 1 * magnitude;
  else if (residual <= 3) niceStep = 2 * magnitude;
  else if (residual <= 7) niceStep = 5 * magnitude;
  else niceStep = 10 * magnitude;
  return Array.from({ length: ticks + 1 }, (_, i) => Math.round(niceStep * i * 100) / 100);
}

export default function DualAxisLineChart({
  data,
  height = 220,
  primaryColor = "rgb(var(--primary))",
  secondaryColor = "rgb(var(--tertiary))",
  primaryLabel = "Primary",
  secondaryLabel = "Secondary",
  showArea = false,
  renderTooltip,
  title,
}: DualAxisLineChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);
  const [svgWidth, setSvgWidth] = useState(400);
  const titleId = useId();
  const { progress } = useChartAnimation(svgRef);
  const ts = useTextScale();

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSvgWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGRectElement>, idx: number) => {
    setHover({ idx, x: e.clientX, y: e.clientY });
  }, []);

  // Touch scrub: snap to the nearest data point on the x axis, mirroring
  // SimpleLineChart's touch handling.
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

  const yAxisLeftW = 52;
  const yAxisRightW = 52;
  const padding = { top: 16, right: yAxisRightW + 8, bottom: 36, left: yAxisLeftW + 8 };
  const chartH = height - padding.top - padding.bottom;
  const chartW = Math.max(svgWidth - padding.left - padding.right, 0);
  const n = data.length;
  const yTicks = 4;

  // Compute independent scales for each axis
  const rawMaxPrimary = Math.max(...data.map((d) => d.primary), 1);
  const maxPrimary = Number.isFinite(rawMaxPrimary) ? rawMaxPrimary : 1;
  const rawMaxSecondary = Math.max(...data.map((d) => d.secondary), 0.01);
  const maxSecondary = Number.isFinite(rawMaxSecondary) ? rawMaxSecondary : 0.01;

  const leftTicks = niceScale(maxPrimary, yTicks);
  const rightTicks = niceScale(maxSecondary, yTicks);
  const leftMax = leftTicks[leftTicks.length - 1] || maxPrimary;
  const rightMax = rightTicks[rightTicks.length - 1] || maxSecondary;

  // Map data to pixel coordinates
  const xPos = (i: number) => n >= 2
    ? padding.left + (i / (n - 1)) * chartW
    : padding.left + chartW / 2;

  const primaryPoints = data.map((d, i) => ({
    x: xPos(i),
    y: padding.top + chartH - (d.primary / leftMax) * chartH,
  }));
  pointsRef.current = primaryPoints;

  const secondaryPoints = data.map((d, i) => ({
    x: xPos(i),
    y: padding.top + chartH - (d.secondary / rightMax) * chartH,
  }));

  // Build SVG path strings
  const buildPath = (points: { x: number; y: number }[]) =>
    points.length >= 2
      ? points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ")
      : "";

  const primaryPath = buildPath(primaryPoints);
  const secondaryPath = buildPath(secondaryPoints);

  const primaryPathLength = primaryPoints.length >= 2
    ? primaryPoints.reduce((len, p, i) => i === 0 ? 0 : len + Math.sqrt((p.x - primaryPoints[i - 1].x) ** 2 + (p.y - primaryPoints[i - 1].y) ** 2), 0)
    : 0;

  const interval = n > 12 ? Math.ceil(n / 6) : 1;

  return (
    <div className="w-full overflow-visible relative" style={{ height }}>
      <svg
        ref={svgRef}
        width="100%"
        height={height}
        className="block"
        role="img"
        aria-labelledby={title ? titleId : undefined}
        onTouchMove={handleTouchScrub}
        onTouchEnd={() => setHover(null)}
      >
        {title && <title id={titleId}>{title}</title>}

        {/* Left Y-axis grid lines and labels (primary) */}
        {leftTicks.map((v) => {
          const y = padding.top + chartH - (v / leftMax) * chartH;
          return (
            <g key={`l-${v}`}>
              <line
                x1={padding.left}
                x2={padding.left + chartW}
                y1={y}
                y2={y}
                stroke="rgb(var(--outline-variant))"
                strokeOpacity={0.15}
              />
              <text
                x={padding.left - 6}
                y={y + 3}
                textAnchor="end"
                fontSize={9 * ts}
                fill={primaryColor}
                fontFamily="'Inter Variable', Inter, sans-serif"
              >
                {formatNumber(v)}
              </text>
            </g>
          );
        })}

        {/* Right Y-axis labels (secondary) */}
        {rightTicks.map((v) => {
          const y = padding.top + chartH - (v / rightMax) * chartH;
          return (
            <g key={`r-${v}`}>
              <text
                x={padding.left + chartW + 6}
                y={y + 3}
                textAnchor="start"
                fontSize={9 * ts}
                fill={secondaryColor}
                fontFamily="'Inter Variable', Inter, sans-serif"
              >
                {formatNumber(v)}
              </text>
            </g>
          );
        })}

        {/* Left axis line */}
        <line
          x1={padding.left}
          x2={padding.left}
          y1={padding.top}
          y2={padding.top + chartH}
          stroke={primaryColor}
          strokeOpacity={0.3}
          strokeWidth={1}
        />

        {/* Right axis line */}
        <line
          x1={padding.left + chartW}
          x2={padding.left + chartW}
          y1={padding.top}
          y2={padding.top + chartH}
          stroke={secondaryColor}
          strokeOpacity={0.3}
          strokeWidth={1}
        />

        {/* Primary area fill */}
        {showArea && primaryPath && primaryPoints.length >= 2 && (
          <path
            d={`${primaryPath} L ${primaryPoints[primaryPoints.length - 1].x} ${padding.top + chartH} L ${primaryPoints[0].x} ${padding.top + chartH} Z`}
            fill={primaryColor}
            fillOpacity={0.1 * progress}
            stroke="none"
          />
        )}

        {/* Primary line (solid) */}
        {primaryPath && (
          <path
            d={primaryPath}
            fill="none"
            stroke={primaryColor}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={primaryPathLength || undefined}
            strokeDashoffset={primaryPathLength * (1 - progress)}
          />
        )}

        {/* Secondary line (dashed) */}
        {secondaryPath && (
          <path
            d={secondaryPath}
            fill="none"
            stroke={secondaryColor}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="6 3"
            style={{
              opacity: progress,
            }}
          />
        )}

        {/* Primary dots */}
        {primaryPoints.map((p, i) => {
          const dotProgress = n > 1 ? Math.max(0, Math.min(1, (progress * n - i))) : progress;
          return (
            <circle
              key={`pd-${i}`}
              cx={p.x}
              cy={p.y}
              r={hover?.idx === i ? 5 : 3}
              fill={primaryColor}
              stroke="rgb(var(--surface))"
              strokeWidth={1.5}
              style={{
                opacity: dotProgress,
                transform: `scale(${dotProgress})`,
                transformOrigin: `${p.x}px ${p.y}px`,
                transition: "r 0.15s ease",
              }}
            />
          );
        })}

        {/* Secondary dots */}
        {secondaryPoints.map((p, i) => {
          const dotProgress = n > 1 ? Math.max(0, Math.min(1, (progress * n - i))) : progress;
          return (
            <circle
              key={`sd-${i}`}
              cx={p.x}
              cy={p.y}
              r={hover?.idx === i ? 5 : 3}
              fill="rgb(var(--surface))"
              stroke={secondaryColor}
              strokeWidth={2}
              style={{
                opacity: dotProgress,
                transform: `scale(${dotProgress})`,
                transformOrigin: `${p.x}px ${p.y}px`,
                transition: "r 0.15s ease",
              }}
            />
          );
        })}

        {/* Hover interaction rects and X-axis labels */}
        {data.map((d, i) => (
          <g key={`interact-${i}`}>
            <rect
              x={xPos(i) - (n >= 2 ? chartW / n / 2 : 20)}
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
                x={xPos(i)}
                y={height - padding.bottom + 16}
                textAnchor="middle"
                fontSize={10 * ts}
                fill="rgb(var(--on-surface-variant))"
                fontFamily="'Inter Variable', Inter, sans-serif"
              >
                {d.label}
              </text>
            )}
          </g>
        ))}

        {/* Hover crosshair */}
        {hover !== null && primaryPoints[hover.idx] && (
          <line
            x1={primaryPoints[hover.idx].x}
            x2={primaryPoints[hover.idx].x}
            y1={padding.top}
            y2={padding.top + chartH}
            stroke="rgb(var(--on-surface))"
            strokeOpacity={0.15}
            strokeDasharray="4 2"
          />
        )}

        {/* Legend */}
        <g transform={`translate(${padding.left + 4}, ${padding.top - 6})`}>
          <line x1={0} x2={12} y1={0} y2={0} stroke={primaryColor} strokeWidth={2} />
          <circle cx={6} cy={0} r={2.5} fill={primaryColor} />
          <text x={16} y={3} fontSize={9 * ts} fill={primaryColor} fontWeight={600} fontFamily="'Inter Variable', Inter, sans-serif">
            {primaryLabel}
          </text>

          <line x1={100} x2={112} y1={0} y2={0} stroke={secondaryColor} strokeWidth={2} strokeDasharray="4 2" />
          <circle cx={106} cy={0} r={2.5} fill="rgb(var(--surface))" stroke={secondaryColor} strokeWidth={1.5} />
          <text x={116} y={3} fontSize={9 * ts} fill={secondaryColor} fontWeight={600} fontFamily="'Inter Variable', Inter, sans-serif">
            {secondaryLabel}
          </text>
        </g>
      </svg>

      {/* Combined tooltip showing both values */}
      <ChartTooltip x={hover?.x ?? 0} y={hover?.y ?? 0} visible={hover !== null} containerRef={svgRef}>
        {hover !== null && data[hover.idx] != null && renderTooltip?.(data[hover.idx], hover.idx)}
      </ChartTooltip>
    </div>
  );
}
