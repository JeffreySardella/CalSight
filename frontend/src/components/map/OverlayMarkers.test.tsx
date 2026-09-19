import type { ReactNode } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

vi.mock("leaflet", () => import("../../__mocks__/leaflet"));
vi.mock("react-leaflet", () => import("../../__mocks__/react-leaflet"));
vi.mock("react-leaflet-cluster", () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

import OverlayMarkers from "./OverlayMarkers";
import type { School } from "../../hooks/useMapOverlays";
import {
  SCHOOL_CRASH_COLORS,
  SCHOOL_NO_DATA_COLOR,
  type SchoolCrashCountsResponse,
} from "../../lib/map/schoolCrashRamp";

afterEach(cleanup);

function school(cds: string, county = 19): School {
  return {
    cds_code: cds,
    school_name: `School ${cds}`,
    county_code: county,
    city: "Los Angeles",
    latitude: 34,
    longitude: -118,
    school_type: "High",
    status: "Active",
  };
}

const SCHOOLS = [school("a"), school("b"), school("c"), school("d"), school("quiet")];

const COUNTS: SchoolCrashCountsResponse = {
  years: [2022, 2023],
  schools: [
    { cds_code: "a", crashes: 1, killed: 0, injured: 1, severe_injured: 0 },
    { cds_code: "b", crashes: 4, killed: 0, injured: 3, severe_injured: 1 },
    { cds_code: "c", crashes: 9, killed: 1, injured: 7, severe_injured: 2 },
    { cds_code: "d", crashes: 30, killed: 3, injured: 22, severe_injured: 6 },
  ],
  coverage: [
    {
      county_code: 19,
      county_name: "Los Angeles",
      total_crashes: 1000,
      crashes_with_coords: 372,
      coords_pct: 37.2,
    },
  ],
};

function renderSchools(counts?: SchoolCrashCountsResponse) {
  return render(
    <OverlayMarkers
      hospitals={[]}
      schools={SCHOOLS}
      showHospitals={false}
      showSchools
      schoolCrashCounts={counts}
    />,
  );
}

function iconColors() {
  return screen
    .getAllByTestId("marker")
    .map((m) => /background:(#[0-9a-f]{6})/i.exec(m.getAttribute("data-icon-html") ?? "")?.[1]);
}

describe("school marker ramp", () => {
  it("colors markers across the ramp and greys the school with no crashes", () => {
    renderSchools(COUNTS);
    const colors = iconColors();
    expect(colors[0]).toBe(SCHOOL_CRASH_COLORS[0]);
    expect(colors[3]).toBe(SCHOOL_CRASH_COLORS[3]);
    expect(colors[4]).toBe(SCHOOL_NO_DATA_COLOR);
  });

  it("greys every marker when the counts haven't loaded", () => {
    // The matview is unpopulated right after a deploy, so this is a real
    // state, not just a loading flicker. It must not render as "all safe"
    // with a color from the ramp.
    renderSchools(undefined);
    expect(new Set(iconColors())).toEqual(new Set([SCHOOL_NO_DATA_COLOR]));
  });
});

describe("school popup", () => {
  it("shows the 500 ft totals for the filtered years", () => {
    renderSchools(COUNTS);
    const popup = screen.getAllByTestId("popup")[2];
    expect(within(popup).getByText("Within 500 ft (2022–2023)")).toBeInTheDocument();
    expect(within(popup).getByText("9 crashes")).toBeInTheDocument();
    expect(
      within(popup).getByText(/1 killed,\s*7 injured,\s*2 seriously injured/),
    ).toBeInTheDocument();
  });

  it("carries the coverage caveat for the school's county", () => {
    renderSchools(COUNTS);
    const popup = screen.getAllByTestId("popup")[0];
    expect(
      within(popup).getByText(
        "37% of crashes in Los Angeles have map coordinates; " +
          "schools in low-coverage counties look safer than they are.",
      ),
    ).toBeInTheDocument();
  });

  it("reads zero rather than blank for a school with no nearby crashes", () => {
    renderSchools(COUNTS);
    const popup = screen.getAllByTestId("popup")[4];
    expect(within(popup).getByText("0 crashes")).toBeInTheDocument();
  });

  it("says 'all years' when no year filter is active", () => {
    renderSchools({ ...COUNTS, years: [] });
    expect(screen.getAllByText("Within 500 ft (all years)").length).toBe(SCHOOLS.length);
  });
});
