import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import type { ChartSlot } from "../../lib/dashboard/types";

/**
 * H-F8 regression: inline arrow props (onEdit/onRemove/onMoveUp/onMoveDown) and
 * per-call drag props previously handed every ChartCard fresh references on each
 * grid render, defeating React.memo(ChartCard). These tests replace ChartCard
 * with a render-counting React.memo mock and assert that:
 *  - an unrelated grid re-render does NOT re-render the memoized cards, and
 *  - the handler props are referentially stable across a real re-render.
 */

const hoisted = vi.hoisted(() => ({
  renderCounts: {} as Record<string, number>,
  lastProps: {} as Record<string, Record<string, unknown>>,
}));

vi.mock("./ChartCard", async () => {
  const ReactMod = await import("react");
  const Mock = (props: Record<string, unknown>) => {
    const id = (props.slot as ChartSlot).id;
    hoisted.renderCounts[id] = (hoisted.renderCounts[id] ?? 0) + 1;
    hoisted.lastProps[id] = props;
    return ReactMod.createElement("div", { "data-testid": `chart-${id}` });
  };
  return { default: ReactMod.memo(Mock) };
});

import DashboardGrid from "./DashboardGrid";

const CHARTS: ChartSlot[] = [
  { id: "a", dimension: "year", measure: "count", chartType: "bar", order: 0 },
  { id: "b", dimension: "county", measure: "count", chartType: "bar", order: 1 },
  { id: "c", dimension: "severity", measure: "count", chartType: "bar", order: 2 },
];

// Stable references shared across rerenders — mimics a parent that memoizes them.
const DATA_BY_SLOT = {};
const onAddChart = vi.fn();
const onRemoveChart = vi.fn();
const onUpdateChart = vi.fn();
const onMoveChart = vi.fn();
const onReorderChart = vi.fn();

type GridProps = ComponentProps<typeof DashboardGrid>;

function baseProps(overrides: Partial<GridProps> = {}): GridProps {
  return {
    charts: CHARTS,
    dataBySlot: DATA_BY_SLOT,
    mode: "advanced",
    loading: false,
    onAddChart,
    onRemoveChart,
    onUpdateChart,
    onMoveChart,
    onReorderChart,
    closeConfigTrigger: 0,
    ...overrides,
  };
}

function renderGrid(props: GridProps) {
  return render(
    <MemoryRouter>
      <DashboardGrid {...props} />
    </MemoryRouter>,
  );
}

describe("DashboardGrid ChartCard memoization", () => {
  beforeEach(() => {
    for (const k of Object.keys(hoisted.renderCounts)) delete hoisted.renderCounts[k];
    for (const k of Object.keys(hoisted.lastProps)) delete hoisted.lastProps[k];
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("does not re-render memoized ChartCards when the grid re-renders for an unrelated reason", () => {
    const { rerender } = renderGrid(baseProps());

    expect(hoisted.renderCounts.a).toBe(1);
    expect(hoisted.renderCounts.b).toBe(1);
    expect(hoisted.renderCounts.c).toBe(1);

    // Re-render the grid with an unrelated prop change (same charts / callbacks).
    rerender(
      <MemoryRouter>
        <DashboardGrid {...baseProps({ closeConfigTrigger: 1 })} />
      </MemoryRouter>,
    );

    // Memoized cards must not have re-rendered — their props stayed stable.
    expect(hoisted.renderCounts.a).toBe(1);
    expect(hoisted.renderCounts.b).toBe(1);
    expect(hoisted.renderCounts.c).toBe(1);
  });

  it("keeps handler props referentially stable across a real re-render", () => {
    const { rerender } = renderGrid(baseProps());

    const first = hoisted.lastProps.a;
    const firstOnEdit = first.onEdit;
    const firstOnRemove = first.onRemove;
    const firstOnMoveUp = first.onMoveUp;
    const firstOnMoveDown = first.onMoveDown;

    // Change a prop that IS forwarded to every card (loading) so the cards
    // genuinely re-render, then confirm the handler identities are unchanged.
    rerender(
      <MemoryRouter>
        <DashboardGrid {...baseProps({ loading: true })} />
      </MemoryRouter>,
    );

    expect(hoisted.renderCounts.a).toBe(2); // re-rendered because `loading` changed
    const second = hoisted.lastProps.a;
    expect(second.onEdit).toBe(firstOnEdit);
    expect(second.onRemove).toBe(firstOnRemove);
    expect(second.onMoveUp).toBe(firstOnMoveUp);
    expect(second.onMoveDown).toBe(firstOnMoveDown);
  });
});
