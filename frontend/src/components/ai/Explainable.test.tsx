import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AiCompanionProvider } from "./AiCompanion";
import { Explainable } from "./Explainable";
import type { DataContext } from "../../lib/ai/dataContext";

const filters = {
  years: [], severities: [], counties: [], causes: [],
  alcohol: null, distracted: null, pedestrian: null, cyclist: null, drug: null,
  driverAge: null, weather: [], lighting: [], collisionType: [], roadType: null, hitRun: null,
};
const ctx: DataContext = { kind: "chart", label: "Crashes by hour", series: [{ label: "5pm", value: 9 }], filters };

function setup() {
  render(
    <AiCompanionProvider>
      <Explainable context={ctx}><span>9</span></Explainable>
    </AiCompanionProvider>,
  );
}

describe("Explainable", () => {
  it("exposes an accessible explain button", () => {
    setup();
    expect(screen.getByRole("button", { name: "Explain: Crashes by hour" })).toBeTruthy();
  });

  it("opens the companion on Enter", () => {
    setup();
    fireEvent.keyDown(screen.getByRole("button", { name: "Explain: Crashes by hour" }), { key: "Enter" });
    expect(screen.getByRole("dialog", { name: "AI explanation" })).toBeTruthy();
  });
});
