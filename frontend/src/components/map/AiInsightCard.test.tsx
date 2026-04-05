import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AiInsightCard from "./AiInsightCard";

describe("AiInsightCard", () => {
  it("renders default county name 'Fresno' when no prop provided", () => {
    render(<AiInsightCard onClose={vi.fn()} />);
    expect(screen.getByText("Fresno County")).toBeInTheDocument();
  });

  it("renders custom county name when provided", () => {
    render(<AiInsightCard onClose={vi.fn()} countyName="Los Angeles" />);
    expect(screen.getByText("Los Angeles County")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", async () => {
    const onClose = vi.fn();
    render(<AiInsightCard onClose={onClose} />);
    const closeButton = screen.getByText("close").closest("button")!;
    await userEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders metric cards", () => {
    render(<AiInsightCard onClose={vi.fn()} />);
    expect(screen.getByText("Total Crashes")).toBeInTheDocument();
    expect(screen.getByText("2,847")).toBeInTheDocument();
    expect(screen.getByText("YoY Trend")).toBeInTheDocument();
    expect(screen.getByText("-3.1%")).toBeInTheDocument();
  });
});
