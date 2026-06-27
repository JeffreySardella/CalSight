import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import RebuildingBanner from "./RebuildingBanner";
import { useApiHealth, type ApiHealth } from "../hooks/useApiHealth";

vi.mock("../hooks/useApiHealth", () => ({ useApiHealth: vi.fn() }));
const mockHealth = (status: ApiHealth) =>
  (useApiHealth as unknown as ReturnType<typeof vi.fn>).mockReturnValue(status);

describe("RebuildingBanner", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders nothing when healthy", () => {
    mockHealth("ok");
    const { container } = render(<RebuildingBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing during maintenance (MaintenanceGate owns that state)", () => {
    mockHealth("maintenance");
    const { container } = render(<RebuildingBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the API is down (MaintenanceGate owns that state)", () => {
    mockHealth("down");
    const { container } = render(<RebuildingBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the banner while rebuilding", () => {
    mockHealth("rebuilding");
    render(<RebuildingBanner />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/being rebuilt/i)).toBeInTheDocument();
  });
});
