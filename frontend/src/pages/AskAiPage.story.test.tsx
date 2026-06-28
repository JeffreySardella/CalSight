import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AskAiPage from "./AskAiPage";

// Avoid real export side effects in jsdom.
vi.mock("../lib/story/exportCanvas", () => ({
  exportPng: vi.fn(), exportPdf: vi.fn(), defaultFilename: () => "calsight-story-test",
}));

beforeEach(() => sessionStorage.clear());

describe("AskAiPage story canvas integration", () => {
  it("shows a Story toggle that opens the panel", () => {
    render(<MemoryRouter><AskAiPage /></MemoryRouter>);
    const toggle = screen.getByRole("button", { name: /story/i });
    fireEvent.click(toggle);
    expect(screen.getByRole("dialog", { name: /story/i })).toBeTruthy();
  });
});
