import { render, screen } from "@testing-library/react";
import HighwaySidePanelContent from "./HighwaySidePanelContent";
import type { HighwayRow } from "../../hooks/useHighwayRankings";

const baseRow: HighwayRow = {
  route_number: "I-5",
  crash_count: 1234,
  total_killed: 56,
  total_injured: 789,
  fatality_rate: 0.045,
  miles: 796,
  crashes_per_mile: 1.55,
};

it("renders the route id and formatted stats", () => {
  render(<HighwaySidePanelContent row={baseRow} />);
  expect(screen.getByText("I-5")).toBeInTheDocument();
  expect(screen.getByText("1,234")).toBeInTheDocument(); // crash_count
  expect(screen.getByText("56")).toBeInTheDocument(); // total_killed
  expect(screen.getByText("789")).toBeInTheDocument(); // total_injured
  expect(screen.getByText("4.5%")).toBeInTheDocument(); // fatality_rate
  expect(screen.getByText("1.55")).toBeInTheDocument(); // crashes_per_mile
});

it("shows an em dash when crashes_per_mile is null", () => {
  render(<HighwaySidePanelContent row={{ ...baseRow, crashes_per_mile: null }} />);
  expect(screen.getByText("—")).toBeInTheDocument();
});
