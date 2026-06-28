import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StoryReportView from "./StoryReportView";
import type { CanvasBlock } from "../../hooks/useStoryCanvas";

const blocks: CanvasBlock[] = [
  { id: "a", kind: "answer", question: "Q", content: "Peak at 2am.", chart: null, sourceTimestamp: 1 },
  { id: "n", kind: "note", text: "My takeaway." },
];

describe("StoryReportView", () => {
  it("renders title, filter summary, and block content", () => {
    render(<StoryReportView title="DUI Story" blocks={blocks} filterSummary="Kern · 2023" />);
    expect(screen.getByText("DUI Story")).toBeTruthy();
    expect(screen.getByText((content) => content.includes("Kern · 2023"))).toBeTruthy();
    expect(screen.getByText("Peak at 2am.")).toBeTruthy();
    expect(screen.getByText("My takeaway.")).toBeTruthy();
  });

  it("falls back to a default title when none is set", () => {
    render(<StoryReportView title="" blocks={[]} filterSummary="All California data" />);
    expect(screen.getByText("Untitled Story")).toBeTruthy();
  });
});
