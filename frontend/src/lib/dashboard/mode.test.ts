import { describe, it, expect } from "vitest";
import {
  DIMENSIONS,
  DIMENSION_LABELS,
  MODE_COVERAGE_NOTE,
  MODE_LABELS,
  defaultChartType,
} from "./types";
import { parseNlq } from "./nlqParser";

describe("mode dimension", () => {
  it("is a selectable dimension with a label", () => {
    expect(DIMENSIONS).toContain("mode");
    expect(DIMENSION_LABELS.mode).toBe("Mode of Travel");
  });

  it("defaults to a bar chart — four categorical buckets", () => {
    expect(defaultChartType("mode")).toBe("bar");
  });

  it("labels exactly the four road users the API returns", () => {
    expect(Object.keys(MODE_LABELS).sort()).toEqual([
      "cyclist", "motorcyclist", "occupant", "pedestrian",
    ]);
  });

  it("says the bars are people, and when the data starts", () => {
    expect(MODE_COVERAGE_NOTE).toBe(
      "* Counts people injured or killed, not crashes. Mode data starts in 2016 (CCRS).",
    );
  });

  it.each([
    "crashes by mode",
    "deaths by mode of travel",
    "fatalities by road user",
    "pedestrians vs cyclists",
    "motorcyclist deaths",
  ])("routes %o to the mode dimension", (query) => {
    expect(parseNlq(query).dimension).toBe("mode");
  });

  it("does not steal queries aimed at other dimensions", () => {
    expect(parseNlq("crashes by victim age").dimension).toBe("age_bracket");
    expect(parseNlq("crashes by driver gender").dimension).toBe("at_fault_gender");
    expect(parseNlq("crashes by collision type").dimension).toBe("collision_type");
  });
});
