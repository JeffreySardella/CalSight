import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DataQualityNotice from "./DataQualityNotice";
import type { DataQualityDisclaimers } from "../../hooks/useDataQualityDisclaimer";

const CLEAN: DataQualityDisclaimers = {
  preDataOnly: false,
  hasPreCcrsYears: false,
  hasPreAcsYears: false,
  agePct: 92,
  genderPct: 95,
  showAgeWarning: false,
  showGenderWarning: false,
};

describe("DataQualityNotice", () => {
  it("renders nothing when there is nothing to disclaim", () => {
    const { container } = render(<DataQualityNotice disclaimers={CLEAN} />);
    expect(container.innerHTML).toBe("");
  });

  it("warns when all selected years predate CCRS demographics", () => {
    render(<DataQualityNotice disclaimers={{ ...CLEAN, preDataOnly: true }} />);
    const note = screen.getByRole("note", { name: "Data quality notes" });
    expect(note).toHaveTextContent(/CCRS reporting starts in 2016/);
  });

  it("warns when the selection mixes pre-2016 years", () => {
    render(<DataQualityNotice disclaimers={{ ...CLEAN, hasPreCcrsYears: true }} />);
    expect(screen.getByRole("note")).toHaveTextContent(/before 2016/);
  });

  it("warns about missing per-capita coverage before 2009", () => {
    render(<DataQualityNotice disclaimers={{ ...CLEAN, hasPreAcsYears: true }} />);
    expect(screen.getByRole("note")).toHaveTextContent(/before 2009/);
  });

  it("warns about low age and gender completeness with the measured percentages", () => {
    render(
      <DataQualityNotice
        disclaimers={{
          ...CLEAN,
          agePct: 42.4,
          genderPct: 61.8,
          showAgeWarning: true,
          showGenderWarning: true,
        }}
      />,
    );
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent(/Driver age is recorded for only 42%/);
    expect(note).toHaveTextContent(/Gender is recorded for only 62%/);
  });

  it("stacks multiple applicable notes", () => {
    render(
      <DataQualityNotice
        disclaimers={{ ...CLEAN, hasPreCcrsYears: true, hasPreAcsYears: true }}
      />,
    );
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent(/before 2016/);
    expect(note).toHaveTextContent(/before 2009/);
  });
});
