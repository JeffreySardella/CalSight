import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MaintenanceGate from "./MaintenanceGate";
import { useApiHealth, type ApiHealth } from "../hooks/useApiHealth";

vi.mock("../hooks/useApiHealth", () => ({ useApiHealth: vi.fn() }));

const mockHealth = (status: ApiHealth) =>
  (useApiHealth as unknown as ReturnType<typeof vi.fn>).mockReturnValue(status);

function renderGate() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MaintenanceGate />
    </QueryClientProvider>,
  );
}

describe("MaintenanceGate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders nothing when the API is healthy", () => {
    mockHealth("ok");
    const { container } = renderGate();
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the maintenance screen when in maintenance", () => {
    mockHealth("maintenance");
    renderGate();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/scheduled maintenance/i)).toBeInTheDocument();
  });

  it("shows the connection-lost screen when the API is down", () => {
    mockHealth("down");
    renderGate();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/reach CalSight/i)).toBeInTheDocument();
  });

  it("renders nothing while data is rebuilding (non-blocking bar handles it)", () => {
    mockHealth("rebuilding");
    const { container } = renderGate();
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
