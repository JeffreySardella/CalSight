import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import ReservoirCard from "./ReservoirCard";
import {
  formatAcreFeet,
  type ReservoirCondition,
} from "../../hooks/useWaterData";

const FOLSOM: ReservoirCondition = {
  station_id: "FOL",
  name: "Folsom Lake",
  capacity_af: 977_000,
  county_code: 34,
  lat: 38.683,
  lon: -121.183,
  latest_date: "2026-07-09",
  storage_af: 800_000,
  pct_of_capacity: 81.9,
  avg_storage_af: 700_000,
  pct_of_average: 114.3,
};

function renderCard(reservoir: ReservoirCondition) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<ReservoirCard reservoir={reservoir} />, { wrapper });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ReservoirCard", () => {
  it("shows percent of capacity and of average", () => {
    renderCard(FOLSOM);
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(screen.getByText("114%")).toBeInTheDocument();
    expect(screen.getByText(/800K of 977K/)).toBeInTheDocument();
  });

  it("places the historical-average tick at avg/capacity", () => {
    renderCard(FOLSOM);
    const tick = screen.getByTestId("avg-tick");
    // 700K / 977K ≈ 71.6%
    expect(tick.style.left).toMatch(/^71\./);
  });

  it("omits average UI when there is no history", () => {
    renderCard({ ...FOLSOM, avg_storage_af: null, pct_of_average: null });
    expect(screen.queryByTestId("avg-tick")).toBeNull();
    expect(screen.queryByText(/of avg for today/i)).toBeNull();
  });

  it("caps the bar width at 100% even above capacity", () => {
    renderCard({ ...FOLSOM, storage_af: 1_100_000, pct_of_capacity: 112.6 });
    const bar = screen.getByRole("progressbar");
    const fill = bar.firstElementChild as HTMLElement;
    expect(fill.style.width).toBe("100%");
    // The stated percentage still tells the truth.
    expect(screen.getByText("113")).toBeInTheDocument();
  });

  it("fetches the series only after expanding", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            station_id: "FOL",
            name: "Folsom Lake",
            capacity_af: 977_000,
            points: [
              { date: "2026-07-01", storage_af: 790_000 },
              { date: "2026-07-02", storage_af: 800_000 },
            ],
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      );
    renderCard(FOLSOM);
    expect(fetchSpy).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /show past year/i }));

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(String(fetchSpy.mock.calls[0][0])).toContain(
      "/api/water/reservoirs/FOL/series",
    );
    expect(
      await screen.findByLabelText(/storage over the past year/i),
    ).toBeInTheDocument();
  });
});

describe("formatAcreFeet", () => {
  it("formats millions with two decimals", () => {
    expect(formatAcreFeet(4_552_000)).toBe("4.55M");
  });

  it("formats thousands as rounded K", () => {
    expect(formatAcreFeet(977_000)).toBe("977K");
  });

  it("passes small values through", () => {
    expect(formatAcreFeet(950)).toBe("950");
  });
});
