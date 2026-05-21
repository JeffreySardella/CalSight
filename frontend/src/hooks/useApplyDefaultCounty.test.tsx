import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import type { ReactNode } from "react";
import { useApplyDefaultCounty } from "./useApplyDefaultCounty";
import {
  __resetPreferencesForTests,
  setPreferences,
} from "./useUserPreferences";

function withRouter(initialEntries: string[] = ["/"]) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
  );
}

/** Composite harness: returns both the hook's redirect string and current URL params. */
function useHarness() {
  const redirect = useApplyDefaultCounty();
  const [params] = useSearchParams();
  return { redirect, params };
}

describe("useApplyDefaultCounty", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetPreferencesForTests();
  });

  describe("page-mount redirect", () => {
    it("returns null when no default is set", () => {
      const { result } = renderHook(useApplyDefaultCounty, { wrapper: withRouter(["/"]) });
      expect(result.current).toBeNull();
    });

    it("returns a redirect search string when no county is in the URL", () => {
      setPreferences({ defaultCounty: "Los Angeles" });
      const { result } = renderHook(useApplyDefaultCounty, { wrapper: withRouter(["/"]) });
      expect(result.current).toBe("?county=los-angeles");
    });

    it("returns null when the URL already has a county", () => {
      setPreferences({ defaultCounty: "Los Angeles" });
      const { result } = renderHook(useApplyDefaultCounty, {
        wrapper: withRouter(["/?county=fresno"]),
      });
      expect(result.current).toBeNull();
    });

    it("returns null when the saved default is not a real county", () => {
      setPreferences({ defaultCounty: "Atlantis" });
      const { result } = renderHook(useApplyDefaultCounty, { wrapper: withRouter(["/"]) });
      expect(result.current).toBeNull();
    });

    it("preserves unrelated URL params in the redirect", () => {
      setPreferences({ defaultCounty: "Orange" });
      const { result } = renderHook(useApplyDefaultCounty, {
        wrapper: withRouter(["/?severity=fatal&start=2023-01"]),
      });
      expect(result.current).not.toBeNull();
      const params = new URLSearchParams(result.current!);
      expect(params.get("county")).toBe("orange");
      expect(params.get("severity")).toBe("fatal");
      expect(params.get("start")).toBe("2023-01");
    });

    it("only computes the redirect on the first render of a mount", () => {
      setPreferences({ defaultCounty: "Los Angeles" });
      const { result, rerender } = renderHook(useApplyDefaultCounty, {
        wrapper: withRouter(["/"]),
      });
      expect(result.current).toBe("?county=los-angeles");
      rerender();
      expect(result.current).toBeNull();
    });
  });

  describe("mid-session default change", () => {
    it("writes the new default to the URL when no county is selected", async () => {
      const { result } = renderHook(useHarness, { wrapper: withRouter(["/"]) });
      // Initial: no default, no county.
      expect(result.current.params.get("county")).toBeNull();

      await act(async () => {
        setPreferences({ defaultCounty: "Los Angeles" });
      });

      await waitFor(() => {
        expect(result.current.params.get("county")).toBe("los-angeles");
      });
    });

    it("does not override an explicit county already in the URL", async () => {
      const { result } = renderHook(useHarness, {
        wrapper: withRouter(["/?county=fresno"]),
      });
      expect(result.current.params.get("county")).toBe("fresno");

      await act(async () => {
        setPreferences({ defaultCounty: "Los Angeles" });
      });

      // The explicit Fresno selection wins.
      expect(result.current.params.get("county")).toBe("fresno");
    });

    it("preserves unrelated URL params when applying a newly set default", async () => {
      const { result } = renderHook(useHarness, {
        wrapper: withRouter(["/?severity=fatal"]),
      });

      await act(async () => {
        setPreferences({ defaultCounty: "Orange" });
      });

      await waitFor(() => {
        expect(result.current.params.get("county")).toBe("orange");
        expect(result.current.params.get("severity")).toBe("fatal");
      });
    });

    it("replaces the auto-applied county when the default changes", async () => {
      const { result } = renderHook(useHarness, { wrapper: withRouter(["/"]) });

      // First change: statewide → LA (URL gets county set).
      await act(async () => {
        setPreferences({ defaultCounty: "Los Angeles" });
      });
      await waitFor(() => {
        expect(result.current.params.get("county")).toBe("los-angeles");
      });

      // Second change: LA → Placer. URL still holds the prior default, so we
      // recognize it as auto-applied and swap it.
      await act(async () => {
        setPreferences({ defaultCounty: "Placer" });
      });
      await waitFor(() => {
        expect(result.current.params.get("county")).toBe("placer");
      });
    });

    it("clears the URL county when the default is removed and county was auto-applied", async () => {
      // Seed preferences before mount so the page-mount redirect sets the URL.
      setPreferences({ defaultCounty: "Los Angeles" });
      const { result } = renderHook(useHarness, {
        wrapper: withRouter(["/?county=los-angeles"]),
      });
      expect(result.current.params.get("county")).toBe("los-angeles");

      await act(async () => {
        setPreferences({ defaultCounty: null });
      });

      await waitFor(() => {
        expect(result.current.params.get("county")).toBeNull();
      });
    });

    it("leaves an explicit selection alone when the default changes to null", async () => {
      setPreferences({ defaultCounty: "Los Angeles" });
      const { result } = renderHook(useHarness, {
        wrapper: withRouter(["/?county=fresno"]),
      });
      expect(result.current.params.get("county")).toBe("fresno");

      await act(async () => {
        setPreferences({ defaultCounty: null });
      });

      // Fresno is explicit (not the prior default of LA), so it stays.
      expect(result.current.params.get("county")).toBe("fresno");
    });

    it("leaves a multi-county selection alone even if it contains the prior default", async () => {
      setPreferences({ defaultCounty: "Los Angeles" });
      const { result } = renderHook(useHarness, {
        wrapper: withRouter(["/?county=los-angeles,fresno"]),
      });

      await act(async () => {
        setPreferences({ defaultCounty: "Placer" });
      });

      // Multi-county is unambiguously explicit; don't second-guess it.
      expect(result.current.params.get("county")).toBe("los-angeles,fresno");
    });
  });
});
