import { describe, it, expect } from "vitest";
import { pageTitleFor, DEFAULT_PAGE_TITLE } from "./pageTitles";

describe("pageTitleFor", () => {
  it("titles the known routes", () => {
    expect(pageTitleFor("/")).toBe("Map Explorer — CalSight");
    expect(pageTitleFor("/stats")).toBe("Statistics Dashboard — CalSight");
    expect(pageTitleFor("/water")).toBe("Water — CalSight");
  });

  it("falls back to the site title for anything unrecognised", () => {
    expect(pageTitleFor("/nope")).toBe(DEFAULT_PAGE_TITLE);
    expect(pageTitleFor("/county")).toBe(DEFAULT_PAGE_TITLE);
    expect(pageTitleFor("/county/alpine")).toBe(DEFAULT_PAGE_TITLE);
  });

  it("stands aside for the county report card, which knows its own county", () => {
    // Null means "the page sets document.title" — Layout's effect runs after
    // the page's, so anything it returned here would win over the county name.
    expect(pageTitleFor("/county/alpine/report")).toBeNull();
    expect(pageTitleFor("/county/los-angeles/report")).toBeNull();
    expect(pageTitleFor("/county/alpine/report/")).toBeNull();
    // Including a slug that is not a county: the page titles that one too,
    // with its not-found title.
    expect(pageTitleFor("/county/atlantis/report")).toBeNull();
  });

  it("does not stand aside for neighbouring paths", () => {
    expect(pageTitleFor("/county/alpine/report/extra")).toBe(DEFAULT_PAGE_TITLE);
    expect(pageTitleFor("/county//report")).toBe(DEFAULT_PAGE_TITLE);
  });
});
