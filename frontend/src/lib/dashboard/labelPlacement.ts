/**
 * Smart Data Labeling System
 *
 * Collision-free label placement for SVG chart elements.
 * Handles: AABB collision detection, force-directed positioning,
 * responsive density, font scaling, and accessibility.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LabelCandidate {
  /** Unique identifier for this label */
  id: string;
  /** Display text */
  text: string;
  /** Anchor point (element the label belongs to) */
  anchorX: number;
  anchorY: number;
  /** Computed bounding box of the placed label */
  bbox: Rect;
  /** Priority 0 = must show, higher = more droppable */
  priority: number;
  /** Whether this label was placed or hidden */
  visible: boolean;
  /** Font size assigned */
  fontSize: number;
  /** Placement angle/direction used (for radial charts) */
  angle?: number;
}

export interface PlacementConfig {
  /** Available chart area */
  bounds: Rect;
  /** Minimum margin between labels in px */
  margin?: number;
  /** Maximum number of labels to show (responsive density) */
  maxLabels?: number;
  /** Base font size */
  baseFontSize?: number;
  /** Minimum font size before label is hidden */
  minFontSize?: number;
  /** Approximate character width as fraction of font size */
  charWidthRatio?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MARGIN = 2;
const DEFAULT_BASE_FONT = 10;
const DEFAULT_MIN_FONT = 7;
const DEFAULT_CHAR_WIDTH_RATIO = 0.58; // Inter Variable avg char width / font size

// ---------------------------------------------------------------------------
// Core: Bounding Box Estimation
// ---------------------------------------------------------------------------

/**
 * Estimate text bounding box without DOM measurement.
 * Uses character count * average char width for the given font size.
 */
export function estimateTextBBox(
  text: string,
  fontSize: number,
  x: number,
  y: number,
  anchor: "start" | "middle" | "end" = "middle",
  charWidthRatio = DEFAULT_CHAR_WIDTH_RATIO,
): Rect {
  const width = text.length * fontSize * charWidthRatio;
  const height = fontSize * 1.2; // line height
  let bx: number;
  switch (anchor) {
    case "start":
      bx = x;
      break;
    case "end":
      bx = x - width;
      break;
    case "middle":
    default:
      bx = x - width / 2;
  }
  const by = y - height * 0.8; // baseline offset
  return { x: bx, y: by, width, height };
}

// ---------------------------------------------------------------------------
// Core: AABB Collision Detection
// ---------------------------------------------------------------------------

/**
 * Check if two axis-aligned bounding boxes overlap, with optional margin.
 */
export function rectsOverlap(a: Rect, b: Rect, margin = DEFAULT_MARGIN): boolean {
  return !(
    a.x + a.width + margin <= b.x ||
    b.x + b.width + margin <= a.x ||
    a.y + a.height + margin <= b.y ||
    b.y + b.height + margin <= a.y
  );
}

/**
 * Check if a rect is fully within bounds.
 */
export function rectInBounds(r: Rect, bounds: Rect): boolean {
  return (
    r.x >= bounds.x &&
    r.y >= bounds.y &&
    r.x + r.width <= bounds.x + bounds.width &&
    r.y + r.height <= bounds.y + bounds.height
  );
}

/**
 * Greedy label placement: place labels in priority order,
 * skipping any that collide with already-placed labels.
 */
export function greedyPlace(
  candidates: LabelCandidate[],
  bounds: Rect,
  margin = DEFAULT_MARGIN,
): LabelCandidate[] {
  const placed: LabelCandidate[] = [];
  const result: LabelCandidate[] = [];

  // Sort by priority (lower = more important)
  const sorted = [...candidates].sort((a, b) => a.priority - b.priority);

  for (const label of sorted) {
    const collides = placed.some((p) => rectsOverlap(label.bbox, p.bbox, margin));
    const inBounds = rectInBounds(label.bbox, bounds);
    if (!collides && inBounds) {
      label.visible = true;
      placed.push(label);
    } else {
      label.visible = false;
    }
    result.push(label);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Force-Directed Label Positioning (for Scatter / unstructured layouts)
// ---------------------------------------------------------------------------

interface ForceLabel {
  id: string;
  text: string;
  anchorX: number;
  anchorY: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  priority: number;
}

/**
 * Force-directed simulation to resolve label overlaps.
 * Labels repel each other but are pulled toward their anchor.
 *
 * @param labels - Initial label positions (x,y = center of label)
 * @param bounds - Chart area bounds
 * @param iterations - Number of simulation steps (10-30 is typically enough)
 * @param anchorStrength - Pull toward original anchor (0-1)
 * @param repelStrength - Push force between overlapping labels
 */
export function forceDirectedPlacement(
  labels: ForceLabel[],
  bounds: Rect,
  iterations = 20,
  anchorStrength = 0.3,
  repelStrength = 1.5,
): ForceLabel[] {
  const result = labels.map((l) => ({ ...l }));
  const n = result.length;

  for (let iter = 0; iter < iterations; iter++) {
    // Decay force strength over iterations for convergence
    const decay = 1 - iter / iterations;

    for (let i = 0; i < n; i++) {
      let fx = 0;
      let fy = 0;

      // Anchor pull
      fx += (result[i].anchorX + 8 - result[i].x) * anchorStrength;
      fy += (result[i].anchorY - 4 - result[i].y) * anchorStrength;

      // Repel from other labels
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const ri: Rect = {
          x: result[i].x - result[i].width / 2,
          y: result[i].y - result[i].height / 2,
          width: result[i].width,
          height: result[i].height,
        };
        const rj: Rect = {
          x: result[j].x - result[j].width / 2,
          y: result[j].y - result[j].height / 2,
          width: result[j].width,
          height: result[j].height,
        };
        if (rectsOverlap(ri, rj, 4)) {
          const dx = result[i].x - result[j].x;
          const dy = result[i].y - result[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const overlap = Math.max(
            (ri.width + rj.width) / 2 - Math.abs(dx),
            (ri.height + rj.height) / 2 - Math.abs(dy),
            1,
          );
          fx += (dx / dist) * overlap * repelStrength;
          fy += (dy / dist) * overlap * repelStrength;
        }
      }

      result[i].x += fx * decay;
      result[i].y += fy * decay;

      // Clamp within bounds
      const halfW = result[i].width / 2;
      const halfH = result[i].height / 2;
      result[i].x = Math.max(bounds.x + halfW, Math.min(bounds.x + bounds.width - halfW, result[i].x));
      result[i].y = Math.max(bounds.y + halfH, Math.min(bounds.y + bounds.height - halfH, result[i].y));
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Responsive Density Calculation
// ---------------------------------------------------------------------------

export type Breakpoint = "mobile" | "tablet" | "desktop";

/**
 * Determine current breakpoint from chart width.
 */
export function getBreakpoint(width: number): Breakpoint {
  if (width < 360) return "mobile";
  if (width < 640) return "tablet";
  return "desktop";
}

/**
 * Calculate max visible labels for a given width and chart type.
 */
export function getMaxLabels(
  width: number,
  totalLabels: number,
  chartType: "bar" | "line" | "scatter" | "donut" | "treemap" | "lollipop" | "radar" | "polar",
): number {
  const bp = getBreakpoint(width);

  // Density multiplier per breakpoint
  const densityMap: Record<Breakpoint, number> = {
    mobile: 0.4,
    tablet: 0.7,
    desktop: 1.0,
  };

  // Chart-specific base densities (fraction of totalLabels to show at desktop)
  const chartDensity: Record<string, number> = {
    bar: 1.0,
    line: 0.5, // Only peaks/valleys at most densities
    scatter: 0.6,
    donut: 1.0,
    treemap: 1.0,
    lollipop: 1.0,
    radar: 1.0,
    polar: 1.0,
  };

  const density = densityMap[bp] * (chartDensity[chartType] ?? 0.8);
  return Math.max(3, Math.ceil(totalLabels * density));
}

/**
 * Calculate responsive font size.
 */
export function getResponsiveFontSize(
  chartWidth: number,
  baseFontSize = DEFAULT_BASE_FONT,
  minFontSize = DEFAULT_MIN_FONT,
): number {
  if (chartWidth >= 640) return baseFontSize;
  if (chartWidth < 240) return minFontSize;
  // Linear interpolation between min and base
  const t = (chartWidth - 240) / (640 - 240);
  return Math.round(minFontSize + t * (baseFontSize - minFontSize));
}

// ---------------------------------------------------------------------------
// Bar Chart Label Strategy
// ---------------------------------------------------------------------------

export interface BarLabelResult {
  text: string;
  truncated: boolean;
  rotated: boolean;
  fontSize: number;
  visible: boolean;
}

/**
 * Determine bar chart x-axis label strategy.
 *
 * Strategy:
 * 1. If all labels fit horizontally at full text, show them.
 * 2. If too dense, try rotation (-45 deg).
 * 3. If still too dense, abbreviate + tooltip.
 * 4. If still too dense, show every Nth label.
 */
export function computeBarLabels(
  labels: string[],
  chartWidth: number,
  barSlotWidth: number,
  config?: PlacementConfig,
): BarLabelResult[] {
  const fontSize = getResponsiveFontSize(chartWidth, config?.baseFontSize, config?.minFontSize);
  const charW = fontSize * (config?.charWidthRatio ?? DEFAULT_CHAR_WIDTH_RATIO);
  const maxLabels = getMaxLabels(chartWidth, labels.length, "bar");

  // Strategy 1: Check if all labels fit horizontally
  const allFit = labels.every((l) => l.length * charW <= barSlotWidth - 4);

  if (allFit && labels.length <= maxLabels) {
    return labels.map((text) => ({
      text,
      truncated: false,
      rotated: false,
      fontSize,
      visible: true,
    }));
  }

  // Strategy 2: Rotation gives us more horizontal space (diagonal uses ~70% width)
  const rotatedCharLimit = Math.floor((barSlotWidth * 1.4) / charW);
  const rotationWorks = labels.every((l) => l.length <= rotatedCharLimit) && labels.length <= maxLabels;

  if (rotationWorks) {
    return labels.map((text) => ({
      text,
      truncated: false,
      rotated: true,
      fontSize,
      visible: true,
    }));
  }

  // Strategy 3: Abbreviate long labels + rotate
  const maxChars = Math.max(3, Math.floor(barSlotWidth / charW) - 1);
  const interval = Math.max(1, Math.ceil(labels.length / maxLabels));

  return labels.map((text, i) => {
    const visible = i % interval === 0;
    const needsTruncation = text.length > maxChars;
    return {
      text: needsTruncation ? text.slice(0, maxChars - 1) + "…" : text,
      truncated: needsTruncation,
      rotated: labels.length > 6,
      fontSize,
      visible,
    };
  });
}

// ---------------------------------------------------------------------------
// Donut Chart Label Strategy
// ---------------------------------------------------------------------------

export interface DonutLabelResult {
  text: string;
  /** Position for inline label (inside/on the arc) */
  inlineX: number;
  inlineY: number;
  /** Leader line points [start, elbow, end] for external labels */
  leaderLine?: { x1: number; y1: number; x2: number; y2: number; x3: number; y3: number };
  /** External label position */
  externalX?: number;
  externalY?: number;
  /** Whether to use leader line (small segments) */
  useLeader: boolean;
  fontSize: number;
  visible: boolean;
  textAnchor: "start" | "middle" | "end";
}

/**
 * Compute donut chart label placements.
 *
 * Strategy:
 * - Segments > 10% of total: inline label at midpoint of arc
 * - Segments 4-10%: leader line to external label
 * - Segments < 4%: hidden (tooltip only)
 */
export function computeDonutLabels(
  segments: Array<{ label: string; value: number; midAngle: number }>,
  cx: number,
  cy: number,
  outerRadius: number,
  total: number,
  chartWidth: number,
): DonutLabelResult[] {
  const fontSize = getResponsiveFontSize(chartWidth, 10, 8);
  const leaderStart = outerRadius + 4;
  const leaderElbow = outerRadius + 16;
  const leaderEnd = outerRadius + 28;
  const maxLabels = getMaxLabels(chartWidth, segments.length, "donut");

  // Sort by value descending for priority
  const indexed = segments.map((s, i) => ({ ...s, originalIdx: i }));
  indexed.sort((a, b) => b.value - a.value);

  const results: DonutLabelResult[] = new Array(segments.length);
  const placedBBoxes: Rect[] = [];
  let visibleCount = 0;

  for (const seg of indexed) {
    const i = seg.originalIdx;
    const pct = total > 0 ? seg.value / total : 0;
    const angleRad = ((seg.midAngle - 90) * Math.PI) / 180;

    // Inline position (midpoint between inner and outer radius)
    const inlineDist = outerRadius * 0.82;
    const inlineX = cx + inlineDist * Math.cos(angleRad);
    const inlineY = cy + inlineDist * Math.sin(angleRad);

    if (pct < 0.04 || visibleCount >= maxLabels) {
      results[i] = {
        text: seg.label,
        inlineX,
        inlineY,
        useLeader: false,
        fontSize,
        visible: false,
        textAnchor: "middle",
      };
      continue;
    }

    if (pct >= 0.10) {
      // Large segment: inline label
      const bbox = estimateTextBBox(seg.label, fontSize, inlineX, inlineY, "middle");
      const collides = placedBBoxes.some((b) => rectsOverlap(bbox, b, 2));
      if (!collides) {
        placedBBoxes.push(bbox);
        visibleCount++;
        results[i] = {
          text: seg.label,
          inlineX,
          inlineY,
          useLeader: false,
          fontSize,
          visible: true,
          textAnchor: "middle",
        };
        continue;
      }
    }

    // Medium segment or collision: use leader line
    const x1 = cx + leaderStart * Math.cos(angleRad);
    const y1 = cy + leaderStart * Math.sin(angleRad);
    const x2 = cx + leaderElbow * Math.cos(angleRad);
    const y2 = cy + leaderElbow * Math.sin(angleRad);
    const isRight = Math.cos(angleRad) >= 0;
    const x3 = isRight ? cx + leaderEnd : cx - leaderEnd;
    const y3 = y2;
    const textAnchor = isRight ? "start" as const : "end" as const;

    const externalX = x3 + (isRight ? 4 : -4);
    const externalY = y3;
    const bbox = estimateTextBBox(seg.label, fontSize, externalX, externalY, textAnchor);
    const collides = placedBBoxes.some((b) => rectsOverlap(bbox, b, 2));

    if (!collides) {
      placedBBoxes.push(bbox);
      visibleCount++;
      results[i] = {
        text: seg.label,
        inlineX,
        inlineY,
        leaderLine: { x1, y1, x2, y2, x3, y3 },
        externalX,
        externalY,
        useLeader: true,
        fontSize,
        visible: true,
        textAnchor,
      };
    } else {
      results[i] = {
        text: seg.label,
        inlineX,
        inlineY,
        useLeader: false,
        fontSize,
        visible: false,
        textAnchor: "middle",
      };
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Line Chart: Peak/Valley Detection
// ---------------------------------------------------------------------------

export interface LinePointLabel {
  idx: number;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  visible: boolean;
  type: "peak" | "valley" | "first" | "last" | "regular";
}

/**
 * Select which points on a line chart deserve labels.
 *
 * Strategy:
 * - Always label first and last points.
 * - Label local peaks (higher than both neighbors).
 * - Label local valleys (lower than both neighbors).
 * - Enforce minimum distance between labeled points.
 * - Respect maxLabels for responsive density.
 */
export function computeLineLabels(
  values: number[],
  points: Array<{ x: number; y: number }>,
  chartWidth: number,
  formatValue: (v: number) => string,
  config?: PlacementConfig,
): LinePointLabel[] {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) {
    return [{
      idx: 0,
      text: formatValue(values[0]),
      x: points[0].x,
      y: points[0].y - 10,
      fontSize: getResponsiveFontSize(chartWidth, config?.baseFontSize),
      visible: true,
      type: "first",
    }];
  }

  const fontSize = getResponsiveFontSize(chartWidth, config?.baseFontSize, config?.minFontSize);
  // For line charts, maxLabels is how many labels we can physically fit
  // rather than a fraction of total data points. Use label width as the constraint.
  const avgLabelWidth = 4 * fontSize * DEFAULT_CHAR_WIDTH_RATIO; // ~4 chars typical
  const maxLabels = Math.max(3, Math.floor(chartWidth / (avgLabelWidth * 2)));
  // Minimum distance: avoid overlapping adjacent labels
  const minPixelDist = avgLabelWidth * 1.8;

  // Identify peaks and valleys
  const candidates: LinePointLabel[] = [];

  // First point
  candidates.push({
    idx: 0,
    text: formatValue(values[0]),
    x: points[0].x,
    y: points[0].y - 10,
    fontSize,
    visible: true,
    type: "first",
  });

  for (let i = 1; i < n - 1; i++) {
    const prev = values[i - 1];
    const curr = values[i];
    const next = values[i + 1];

    if (curr > prev && curr > next) {
      candidates.push({
        idx: i,
        text: formatValue(curr),
        x: points[i].x,
        y: points[i].y - 10,
        fontSize,
        visible: true,
        type: "peak",
      });
    } else if (curr < prev && curr < next) {
      candidates.push({
        idx: i,
        text: formatValue(curr),
        x: points[i].x,
        y: points[i].y + 14,
        fontSize,
        visible: true,
        type: "valley",
      });
    }
  }

  // Last point
  candidates.push({
    idx: n - 1,
    text: formatValue(values[n - 1]),
    x: points[n - 1].x,
    y: points[n - 1].y - 10,
    fontSize,
    visible: true,
    type: "last",
  });

  // Sort by importance: first/last > peaks > valleys
  const priorityOrder = { first: 0, last: 0, peak: 1, valley: 2, regular: 3 };
  candidates.sort((a, b) => priorityOrder[a.type] - priorityOrder[b.type]);

  // Greedy selection with minimum distance enforcement
  const selected: LinePointLabel[] = [];
  for (const c of candidates) {
    if (selected.length >= maxLabels) {
      c.visible = false;
      selected.push(c);
      continue;
    }
    const tooClose = selected.some(
      (s) => s.visible && Math.abs(s.x - c.x) < minPixelDist,
    );
    if (tooClose) {
      c.visible = false;
    }
    selected.push(c);
  }

  return selected;
}

// ---------------------------------------------------------------------------
// Scatter: Force-Directed Label Resolver
// ---------------------------------------------------------------------------

export interface ScatterLabelResult {
  idx: number;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  visible: boolean;
  textAnchor: "start" | "middle" | "end";
  /** Leader line from anchor to label position */
  leaderLine?: { x1: number; y1: number; x2: number; y2: number };
}

/**
 * Compute scatter chart labels using force-directed placement.
 *
 * Strategy:
 * 1. Start labels offset from their anchor point.
 * 2. Run force simulation to resolve overlaps.
 * 3. Hide labels that still overlap after simulation.
 * 4. Draw leader lines from anchor to displaced labels.
 */
export function computeScatterLabels(
  data: Array<{ label: string; px: number; py: number; radius: number }>,
  bounds: Rect,
  chartWidth: number,
  config?: PlacementConfig,
): ScatterLabelResult[] {
  const fontSize = getResponsiveFontSize(chartWidth, config?.baseFontSize, config?.minFontSize);
  const charW = fontSize * (config?.charWidthRatio ?? DEFAULT_CHAR_WIDTH_RATIO);
  const maxLabels = getMaxLabels(chartWidth, data.length, "scatter");

  // Sort by some importance metric (we use label length as proxy for readability)
  const indexed = data.map((d, i) => ({ ...d, originalIdx: i }));
  // Show all, but priority = index (first items are more important)

  const forceLabels: ForceLabel[] = indexed.slice(0, maxLabels).map((d) => {
    const width = d.label.length * charW;
    const height = fontSize * 1.2;
    return {
      id: `scatter-${d.originalIdx}`,
      text: d.label,
      anchorX: d.px,
      anchorY: d.py,
      x: d.px + d.radius + 6,
      y: d.py - 2,
      width,
      height,
      fontSize,
      priority: d.originalIdx,
    };
  });

  const resolved = forceDirectedPlacement(forceLabels, bounds, 25, 0.25, 1.8);

  // Final collision check: hide any remaining overlaps
  const results: ScatterLabelResult[] = new Array(data.length);
  const placedBBoxes: Rect[] = [];

  // Initialize all as hidden
  for (let i = 0; i < data.length; i++) {
    results[i] = {
      idx: i,
      text: data[i].label,
      x: data[i].px + data[i].radius + 6,
      y: data[i].py,
      fontSize,
      visible: false,
      textAnchor: "start",
    };
  }

  for (const rl of resolved) {
    const i = indexed.find((d) => `scatter-${d.originalIdx}` === rl.id)?.originalIdx;
    if (i === undefined) continue;

    const bbox: Rect = {
      x: rl.x - rl.width / 2,
      y: rl.y - rl.height / 2,
      width: rl.width,
      height: rl.height,
    };

    const collides = placedBBoxes.some((b) => rectsOverlap(bbox, b, 3));
    if (!collides && rectInBounds(bbox, bounds)) {
      placedBBoxes.push(bbox);
      const isLeft = rl.x < rl.anchorX;
      const dist = Math.sqrt((rl.x - rl.anchorX) ** 2 + (rl.y - rl.anchorY) ** 2);
      results[i] = {
        idx: i,
        text: data[i].label,
        x: rl.x,
        y: rl.y,
        fontSize,
        visible: true,
        textAnchor: isLeft ? "end" : "start",
        leaderLine: dist > 12 ? {
          x1: rl.anchorX + (isLeft ? -data[i].radius - 2 : data[i].radius + 2),
          y1: rl.anchorY,
          x2: rl.x + (isLeft ? rl.width / 2 + 2 : -rl.width / 2 - 2),
          y2: rl.y,
        } : undefined,
      };
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Treemap: Fit Text Inside Rectangles
// ---------------------------------------------------------------------------

export interface TreemapLabelResult {
  text: string;
  pctText: string;
  fontSize: number;
  pctFontSize: number;
  showName: boolean;
  showPct: boolean;
  x: number;
  y: number;
  maxWidth: number;
}

/**
 * Compute treemap label sizing.
 *
 * Strategy:
 * - Scale font size with cell area (sqrt scaling).
 * - Hide name if cell width < 4 chars at min font size.
 * - Hide pct if cell height < 2 lines at computed font size.
 * - Truncate name to fit cell width.
 */
export function computeTreemapLabels(
  cells: Array<{ x: number; y: number; w: number; h: number; label: string; pct: number }>,
  _chartWidth: number,
  config?: PlacementConfig,
): TreemapLabelResult[] {
  const baseFontSize = config?.baseFontSize ?? 11;
  const minFontSize = config?.minFontSize ?? 8;
  const charWidthRatio = config?.charWidthRatio ?? DEFAULT_CHAR_WIDTH_RATIO;

  // Reference area: the largest cell
  const maxArea = Math.max(...cells.map((c) => c.w * c.h), 1);

  return cells.map((cell) => {
    const area = cell.w * cell.h;
    // sqrt scaling: small cells get smaller fonts proportionally
    const areaRatio = Math.sqrt(area / maxArea);
    const fontSize = Math.max(minFontSize, Math.round(baseFontSize * areaRatio));
    const pctFontSize = Math.max(minFontSize, Math.round((baseFontSize + 1) * areaRatio));
    const charW = fontSize * charWidthRatio;
    const lineH = fontSize * 1.4;

    // Available space (with internal padding)
    const padX = 6;
    const padY = 4;
    const availW = Math.max(cell.w - padX * 2, 0);
    const availH = Math.max(cell.h - padY * 2, 0);

    const maxChars = Math.floor(availW / charW);
    const maxLines = Math.floor(availH / lineH);

    const showName = maxChars >= 3 && maxLines >= 1;
    const showPct = maxLines >= 2 && cell.w > 28;

    // Truncate
    let text = cell.label;
    if (text.length > maxChars && maxChars > 3) {
      text = text.slice(0, maxChars - 1) + "…";
    } else if (text.length > maxChars) {
      text = text.slice(0, maxChars);
    }

    return {
      text,
      pctText: `${cell.pct}%`,
      fontSize,
      pctFontSize,
      showName,
      showPct,
      x: cell.x + padX,
      y: cell.y + padY + fontSize,
      maxWidth: availW,
    };
  });
}

// ---------------------------------------------------------------------------
// Lollipop: Value Label Positioning
// ---------------------------------------------------------------------------

export interface LollipopLabelResult {
  text: string;
  truncatedLabel: string;
  x: number;
  y: number;
  fontSize: number;
  visible: boolean;
  valuePlacement: "right" | "left";
  valueX: number;
}

/**
 * Compute lollipop chart label positions.
 *
 * Strategy:
 * - Truncate category labels to fit allocated label width.
 * - Place value labels to the right of the dot; if too close to edge, place inside (left).
 */
export function computeLollipopLabels(
  data: Array<{ label: string; value: number; barEndX: number; y: number }>,
  labelWidth: number,
  chartWidth: number,
  formatValue: (v: number) => string,
  config?: PlacementConfig,
): LollipopLabelResult[] {
  const fontSize = getResponsiveFontSize(chartWidth, config?.baseFontSize, config?.minFontSize);
  const charW = fontSize * (config?.charWidthRatio ?? DEFAULT_CHAR_WIDTH_RATIO);
  const maxChars = Math.max(3, Math.floor((labelWidth - 8) / charW));
  const valueMargin = 10;
  const rightEdge = chartWidth - 8;

  return data.map((d) => {
    const truncated = d.label.length > maxChars
      ? d.label.slice(0, maxChars - 1) + "…"
      : d.label;
    const valueText = formatValue(d.value);
    const valueWidth = valueText.length * charW;
    const valueFitsRight = d.barEndX + valueMargin + valueWidth < rightEdge;

    return {
      text: d.label,
      truncatedLabel: truncated,
      x: labelWidth - 6,
      y: d.y + 3,
      fontSize,
      visible: true,
      valuePlacement: valueFitsRight ? "right" as const : "left" as const,
      valueX: valueFitsRight ? d.barEndX + valueMargin : d.barEndX - valueMargin,
    };
  });
}

// ---------------------------------------------------------------------------
// Accessibility: Generate aria-label for hidden labels
// ---------------------------------------------------------------------------

/**
 * Generate a complete accessible description for a chart,
 * including all data points (even those whose visual labels are hidden).
 */
export function generateChartAriaLabel(
  chartType: string,
  title: string,
  dataPoints: Array<{ label: string; value: number | string }>,
): string {
  const summary = `${chartType} chart: ${title}. ${dataPoints.length} data points.`;
  const details = dataPoints
    .map((d) => `${d.label}: ${d.value}`)
    .join("; ");
  return `${summary} Data: ${details}`;
}

/**
 * Generate aria-label attributes for individual hidden labels
 * so screen readers can still access them.
 */
export function hiddenLabelAriaProps(text: string, value?: string): Record<string, string> {
  return {
    "aria-label": value ? `${text}: ${value}` : text,
    role: "img",
  };
}
