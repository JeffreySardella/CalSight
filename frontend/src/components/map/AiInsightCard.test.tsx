import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import AiInsightCard from "./AiInsightCard";

beforeAll(() => {
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
import type { ChoroplethPoint } from "../../hooks/useChoroplethData";

const POINT_A: ChoroplethPoint = {
  value: 487.2,
  rawCount: 48291,
  totalKilled: 412,
  totalInjured: 12847,
  hasEnoughData: true,
};

const POINT_B: ChoroplethPoint = {
  value: 256.8,
  rawCount: 8412,
  totalKilled: 67,
  totalInjured: 2103,
  hasEnoughData: true,
};

async function expandCard() {
  const bar = screen.getByText(/county/i).closest("[class*=cursor-pointer]");
  if (bar) await userEvent.click(bar);
}

describe("AiInsightCard", () => {
  it("renders county name in collapsed bar", () => {
    render(
      <MemoryRouter><AiInsightCard
        onClose={vi.fn()}
        countyName="Los Angeles"
        data={POINT_A}
        measureLabel="Per 100k"
        compareMode={false}
        onCompare={vi.fn()}
      /></MemoryRouter>,
    );
    expect(screen.getByText("Los Angeles County")).toBeInTheDocument();
  });

  it("shows stats when expanded", async () => {
    render(
      <MemoryRouter><AiInsightCard
        onClose={vi.fn()}
        countyName="Los Angeles"
        data={POINT_A}
        measureLabel="Per 100k"
        compareMode={false}
        onCompare={vi.fn()}
      /></MemoryRouter>,
    );
    await expandCard();
    expect(screen.getByText("48.3K")).toBeInTheDocument();
    expect(screen.getByText("412")).toBeInTheDocument();
    expect(screen.getByText("12.8K")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", async () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter><AiInsightCard
        onClose={onClose}
        countyName="Fresno"
        data={POINT_A}
        measureLabel="Per 100k"
        compareMode={false}
        onCompare={vi.fn()}
      /></MemoryRouter>,
    );
    await userEvent.click(screen.getByText("close").closest("button")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows Compare button when expanded", async () => {
    render(
      <MemoryRouter><AiInsightCard
        onClose={vi.fn()}
        countyName="Fresno"
        data={POINT_A}
        measureLabel="Per 100k"
        compareMode={false}
        onCompare={vi.fn()}
      /></MemoryRouter>,
    );
    await expandCard();
    expect(screen.getByRole("button", { name: /compare/i })).toBeInTheDocument();
  });

  it("shows compare layout with both counties", () => {
    render(
      <MemoryRouter><AiInsightCard
        onClose={vi.fn()}
        countyName="Los Angeles"
        data={POINT_A}
        measureLabel="Per 100k"
        compareMode={true}
        onCompare={vi.fn()}
        compareCountyName="Orange"
        compareData={POINT_B}
      /></MemoryRouter>,
    );
    expect(screen.getByText("Los Angeles vs Orange")).toBeInTheDocument();
  });

  it("shows N/A for measure value when hasEnoughData is false", async () => {
    const noData: ChoroplethPoint = { value: null, rawCount: 3, totalKilled: 0, totalInjured: 1, hasEnoughData: false };
    render(
      <MemoryRouter><AiInsightCard
        onClose={vi.fn()}
        countyName="Alpine"
        data={noData}
        measureLabel="Per 100k"
        compareMode={false}
        onCompare={vi.fn()}
      /></MemoryRouter>,
    );
    await expandCard();
    expect(screen.getByText("N/A")).toBeInTheDocument();
  });
});
