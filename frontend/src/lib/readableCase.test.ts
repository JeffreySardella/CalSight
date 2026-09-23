import { toReadableCase, toRoadName } from "./readableCase";

describe("toRoadName", () => {
  it("title-cases every word of a road name", () => {
    expect(toRoadName("BLACKSTONE AVE")).toBe("Blackstone Ave");
    expect(toRoadName("MOUNT WHITNEY AVENUE")).toBe("Mount Whitney Avenue");
    expect(toRoadName("O'NEILL RD")).toBe("O'Neill Rd");
  });

  it("keeps route designations uppercase", () => {
    expect(toRoadName("SR-99")).toBe("SR-99");
    expect(toRoadName("I-5")).toBe("I-5");
    expect(toRoadName("US-101 N")).toBe("US-101 N");
  });

  it("handles empty input", () => {
    expect(toRoadName(null)).toBe("");
    expect(toRoadName("   ")).toBe("");
  });
});

describe("toReadableCase", () => {
  it("sentence-cases a category value", () => {
    expect(toReadableCase("CLEAR")).toBe("Clear");
    expect(toReadableCase("DARK-STREET LIGHTS")).toBe("Dark - street lights");
  });

  it("handles empty input", () => {
    expect(toReadableCase(null)).toBe("");
    expect(toReadableCase(undefined)).toBe("");
    expect(toReadableCase("")).toBe("");
  });
});
