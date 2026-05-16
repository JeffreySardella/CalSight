/**
 * SmartLabelExamples.tsx
 *
 * Reference implementation showing how to integrate the smart labeling system
 * into each chart type. These are NOT standalone components — they demonstrate
 * the SVG rendering patterns to integrate into the existing chart components.
 *
 * Integration guide:
 * 1. Import the relevant hook from useSmartLabels.ts
 * 2. Compute labels in the render body (memoized via the hook)
 * 3. Replace the existing label <text> elements with the smart-placed ones
 * 4. Add aria-label for hidden labels
 */

import React from "react";
import type {
  BarLabelResult,
  DonutLabelResult,
  LinePointLabel,
  ScatterLabelResult,
  TreemapLabelResult,
} from "./useSmartLabels";

// ---------------------------------------------------------------------------
// 1. BAR CHART: Rotated + Abbreviated Labels
// ---------------------------------------------------------------------------

/**
 * SVG rendering for smart bar labels.
 * Replace the existing label rendering in SimpleBarChart.tsx with this pattern.
 */
export function renderBarLabels(
  labels: BarLabelResult[],
  getX: (idx: number) => number,
  baseY: number,
  originalTexts: string[],
): React.ReactNode {
  return labels.map((label, i) => {
    if (!label.visible) {
      // Hidden label: still accessible via aria
      return (
        <g key={`label-${i}`} role="img" aria-label={originalTexts[i]}>
          <text
            x={getX(i)}
            y={baseY}
            className="sr-only"
            aria-hidden="false"
          >
            {originalTexts[i]}
          </text>
        </g>
      );
    }

    if (label.rotated) {
      return (
        <g key={`label-${i}`}>
          <text
            x={getX(i)}
            y={baseY}
            textAnchor="end"
            fontSize={label.fontSize}
            fontWeight={600}
            fill="rgb(var(--on-surface-variant))"
            fontFamily="'Inter Variable', Inter, sans-serif"
            transform={`rotate(-45, ${getX(i)}, ${baseY})`}
          >
            {label.text}
          </text>
          {label.truncated && (
            <title>{originalTexts[i]}</title>
          )}
        </g>
      );
    }

    return (
      <g key={`label-${i}`}>
        <text
          x={getX(i)}
          y={baseY}
          textAnchor="middle"
          fontSize={label.fontSize}
          fontWeight={600}
          fill="rgb(var(--on-surface-variant))"
          fontFamily="'Inter Variable', Inter, sans-serif"
        >
          {label.text}
        </text>
        {label.truncated && (
          <title>{originalTexts[i]}</title>
        )}
      </g>
    );
  });
}

// ---------------------------------------------------------------------------
// 2. DONUT CHART: Inline + Leader Lines
// ---------------------------------------------------------------------------

/**
 * SVG rendering for donut labels with leader lines.
 * Add this after the segment paths in SimpleDonutChart.tsx.
 */
export function renderDonutLabels(
  labels: DonutLabelResult[],
  segmentColors: string[],
): React.ReactNode {
  return labels.map((label, i) => {
    if (!label.visible) {
      return (
        <g key={`dlabel-${i}`} role="img" aria-label={label.text}>
          {/* Screen reader accessible but visually hidden */}
        </g>
      );
    }

    if (label.useLeader && label.leaderLine) {
      const { x1, y1, x2, y2, x3, y3 } = label.leaderLine;
      return (
        <g key={`dlabel-${i}`}>
          {/* Leader line: arc edge -> elbow -> label */}
          <path
            d={`M ${x1} ${y1} L ${x2} ${y2} L ${x3} ${y3}`}
            fill="none"
            stroke="rgb(var(--outline-variant))"
            strokeWidth={1}
            strokeOpacity={0.6}
          />
          {/* Small dot at arc edge */}
          <circle
            cx={x1}
            cy={y1}
            r={2}
            fill={segmentColors[i]}
          />
          {/* External label text */}
          <text
            x={label.externalX}
            y={label.externalY! + 3}
            textAnchor={label.textAnchor}
            fontSize={label.fontSize}
            fontWeight={600}
            fill="rgb(var(--on-surface-variant))"
            fontFamily="'Inter Variable', Inter, sans-serif"
          >
            {label.text}
          </text>
        </g>
      );
    }

    // Inline label (large segments)
    return (
      <g key={`dlabel-${i}`}>
        <text
          x={label.inlineX}
          y={label.inlineY}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={label.fontSize}
          fontWeight={700}
          fill="#fff"
          fontFamily="'Inter Variable', Inter, sans-serif"
          pointerEvents="none"
        >
          {label.text}
        </text>
      </g>
    );
  });
}

// ---------------------------------------------------------------------------
// 3. LINE CHART: Peak/Valley Labels
// ---------------------------------------------------------------------------

/**
 * SVG rendering for line chart point labels.
 * Add this inside the points loop in SimpleLineChart.tsx.
 */
export function renderLineLabels(
  labels: LinePointLabel[],
  color: string,
): React.ReactNode {
  return labels
    .filter((l) => l.visible)
    .map((label) => (
      <g key={`ll-${label.idx}`}>
        {/* Value label */}
        <text
          x={label.x}
          y={label.y}
          textAnchor="middle"
          fontSize={label.fontSize}
          fontWeight={700}
          fill={label.type === "peak" ? color : "rgb(var(--on-surface-variant))"}
          fontFamily="'Inter Variable', Inter, sans-serif"
        >
          {label.text}
        </text>
        {/* Subtle indicator for peaks */}
        {label.type === "peak" && (
          <polygon
            points={`${label.x - 3},${label.y + 3} ${label.x + 3},${label.y + 3} ${label.x},${label.y + 6}`}
            fill={color}
            fillOpacity={0.4}
          />
        )}
        {/* Subtle indicator for valleys */}
        {label.type === "valley" && (
          <polygon
            points={`${label.x - 3},${label.y - 14} ${label.x + 3},${label.y - 14} ${label.x},${label.y - 17}`}
            fill="rgb(var(--on-surface-variant))"
            fillOpacity={0.3}
          />
        )}
      </g>
    ));
}

// ---------------------------------------------------------------------------
// 4. SCATTER CHART: Force-Directed Labels with Leader Lines
// ---------------------------------------------------------------------------

/**
 * SVG rendering for scatter chart labels.
 * Add after the circle elements in SimpleScatter.tsx.
 */
export function renderScatterLabels(
  labels: ScatterLabelResult[],
): React.ReactNode {
  return labels
    .filter((l) => l.visible)
    .map((label) => (
      <g key={`sl-${label.idx}`}>
        {/* Leader line from point to displaced label */}
        {label.leaderLine && (
          <line
            x1={label.leaderLine.x1}
            y1={label.leaderLine.y1}
            x2={label.leaderLine.x2}
            y2={label.leaderLine.y2}
            stroke="rgb(var(--outline-variant))"
            strokeWidth={0.75}
            strokeOpacity={0.5}
            strokeDasharray="2 1"
          />
        )}
        {/* Label text */}
        <text
          x={label.x}
          y={label.y + label.fontSize * 0.35}
          textAnchor={label.textAnchor}
          fontSize={label.fontSize}
          fontWeight={600}
          fill="rgb(var(--on-surface))"
          fontFamily="'Inter Variable', Inter, sans-serif"
        >
          {label.text}
        </text>
      </g>
    ));
}

// ---------------------------------------------------------------------------
// 5. TREEMAP: Adaptive Font Size Labels
// ---------------------------------------------------------------------------

/**
 * SVG rendering for treemap cell labels.
 * Replace the existing text elements in SimpleTreemap.tsx.
 */
export function renderTreemapLabels(
  labels: TreemapLabelResult[],
  originalLabels: string[],
  _padX?: number,
): React.ReactNode {
  return labels.map((label, i) => (
    <g key={`tl-${i}`}>
      {label.showName ? (
        <text
          x={label.x}
          y={label.y}
          fontSize={label.fontSize}
          fontWeight={700}
          fill="#fff"
          fontFamily="'Inter Variable', Inter, sans-serif"
          clipPath={`inset(0 0 0 0)`}
        >
          {label.text}
          {label.text !== originalLabels[i] && (
            <title>{originalLabels[i]}</title>
          )}
        </text>
      ) : (
        // Cell too small: name only in aria
        <g role="img" aria-label={`${originalLabels[i]}: ${label.pctText}`} />
      )}
      {label.showPct && (
        <text
          x={label.x}
          y={label.y + label.fontSize * 1.3}
          fontSize={label.pctFontSize}
          fontWeight={800}
          fill="#fff"
          fillOpacity={0.9}
          fontFamily="'Inter Variable', Inter, sans-serif"
        >
          {label.pctText}
        </text>
      )}
    </g>
  ));
}

// ---------------------------------------------------------------------------
// 6. ACCESSIBILITY: Screen-reader-only data table
// ---------------------------------------------------------------------------

/**
 * Render a visually hidden data table for screen readers.
 * Place this inside the chart container div (outside the SVG).
 *
 * This ensures all data is accessible even when labels are hidden.
 */
export function renderAccessibleDataTable(
  data: Array<{ label: string; value: number | string }>,
  chartTitle: string,
): React.ReactNode {
  return (
    <table
      className="sr-only"
      aria-label={`Data table for ${chartTitle}`}
      role="table"
    >
      <caption>{chartTitle}</caption>
      <thead>
        <tr>
          <th scope="col">Category</th>
          <th scope="col">Value</th>
        </tr>
      </thead>
      <tbody>
        {data.map((d, i) => (
          <tr key={i}>
            <td>{d.label}</td>
            <td>{d.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
