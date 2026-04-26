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

describe("AiInsightCard", () => {
  it("renders county name and real stats in single mode", () => {
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
    expect(screen.getByText("48,291")).toBeInTheDocument();
    expect(screen.getByText("412")).toBeInTheDocument();
    expect(screen.getByText("12,847")).toBeInTheDocument();
    expect(screen.getByText("487")).toBeInTheDocument();
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

  it("shows Compare button in single mode", () => {
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
    expect(screen.getByRole("button", { name: /compare/i })).toBeInTheDocument();
  });

  it("calls onCompare when Compare button is clicked", async () => {
    const onCompare = vi.fn();
    render(
      <AiInsightCard
        onClose={vi.fn()}
        countyName="Fresno"
        data={POINT_A}
        measureLabel="Per 100k"
        compareMode={false}
        onCompare={onCompare}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /compare/i }));
    expect(onCompare).toHaveBeenCalledTimes(1);
  });

  it("shows prompt text when in compare mode without second county", () => {
    render(
      <AiInsightCard
        onClose={vi.fn()}
        countyName="Fresno"
        data={POINT_A}
        measureLabel="Per 100k"
        compareMode={true}
        onCompare={vi.fn()}
      />,
    );
    expect(screen.getByText(/click a county to compare/i)).toBeInTheDocument();
  });

  it("shows compare layout with both counties and percent diff", () => {
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
    expect(screen.getByText("Los Angeles")).toBeInTheDocument();
    expect(screen.getByText("Orange")).toBeInTheDocument();
    expect(screen.getByText("48,291")).toBeInTheDocument();
    expect(screen.getByText("8,412")).toBeInTheDocument();
    expect(screen.getByText("-82.6%")).toBeInTheDocument();
  });

  it("shows N/A for measure value when hasEnoughData is false", () => {
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
    expect(screen.getByText("N/A")).toBeInTheDocument();
  });
});
