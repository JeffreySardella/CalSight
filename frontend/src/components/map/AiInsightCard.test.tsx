import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AiInsightCard from "./AiInsightCard";
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
      <AiInsightCard
        onClose={vi.fn()}
        countyName="Los Angeles"
        data={POINT_A}
        measureLabel="Per 100k"
        compareMode={false}
        onCompare={vi.fn()}
      />,
    );
    expect(screen.getByText("Los Angeles County")).toBeInTheDocument();
  });

  it("shows stats when expanded", async () => {
    render(
      <AiInsightCard
        onClose={vi.fn()}
        countyName="Los Angeles"
        data={POINT_A}
        measureLabel="Per 100k"
        compareMode={false}
        onCompare={vi.fn()}
      />,
    );
    await expandCard();
    expect(screen.getByText("48,291")).toBeInTheDocument();
    expect(screen.getByText("412")).toBeInTheDocument();
    expect(screen.getByText("12,847")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", async () => {
    const onClose = vi.fn();
    render(
      <AiInsightCard
        onClose={onClose}
        countyName="Fresno"
        data={POINT_A}
        measureLabel="Per 100k"
        compareMode={false}
        onCompare={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByText("close").closest("button")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows Compare button when expanded", async () => {
    render(
      <AiInsightCard
        onClose={vi.fn()}
        countyName="Fresno"
        data={POINT_A}
        measureLabel="Per 100k"
        compareMode={false}
        onCompare={vi.fn()}
      />,
    );
    await expandCard();
    expect(screen.getByRole("button", { name: /compare/i })).toBeInTheDocument();
  });

  it("shows compare layout with both counties", () => {
    render(
      <AiInsightCard
        onClose={vi.fn()}
        countyName="Los Angeles"
        data={POINT_A}
        measureLabel="Per 100k"
        compareMode={true}
        onCompare={vi.fn()}
        compareCountyName="Orange"
        compareData={POINT_B}
      />,
    );
    expect(screen.getByText("Los Angeles vs Orange")).toBeInTheDocument();
  });

  it("shows N/A for measure value when hasEnoughData is false", async () => {
    const noData: ChoroplethPoint = { value: null, rawCount: 3, totalKilled: 0, totalInjured: 1, hasEnoughData: false };
    render(
      <AiInsightCard
        onClose={vi.fn()}
        countyName="Alpine"
        data={noData}
        measureLabel="Per 100k"
        compareMode={false}
        onCompare={vi.fn()}
      />,
    );
    await expandCard();
    expect(screen.getByText("N/A")).toBeInTheDocument();
  });
});
