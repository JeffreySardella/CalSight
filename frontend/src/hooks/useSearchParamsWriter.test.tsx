import { describe, it, expect, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useSearchParams, useLocation } from "react-router-dom";
import { useSearchParamsWriter, resetSearchParamsBuffer, formatSearch } from "./useSearchParamsWriter";

type Writer = ReturnType<typeof useSearchParamsWriter>[1];

/**
 * Mirrors the real map: a filter writer (county) and a viewport writer, each
 * living in its own hook, both merging into the same query string.
 */
function Harness({ onRender }: { onRender: (write: Writer, search: string) => void }) {
  const [searchParams, write] = useSearchParamsWriter();
  onRender(write, searchParams.toString());
  return null;
}

function Probe({ onSearch }: { onSearch: (search: string) => void }) {
  const [searchParams] = useSearchParams();
  onSearch(searchParams.toString());
  return null;
}

function setCounty(write: Writer, county: string) {
  write((prev) => {
    const next = new URLSearchParams(prev);
    next.set("county", county);
    return next;
  }, { replace: true });
}

function writeViewport(write: Writer, zoom: string) {
  write((prev) => {
    const next = new URLSearchParams(prev);
    next.set("zoom", zoom);
    return next;
  }, { replace: true });
}

describe("useSearchParamsWriter", () => {
  beforeEach(() => resetSearchParamsBuffer());

  it("keeps params added since a stale writer was captured", async () => {
    // The viewport sync debounces map movement, so it fires from a timer
    // holding the writer from an *earlier* render. React Router's own setter
    // would hand that callback the pre-click URL and drop `county=`, undoing
    // the selection a click had just made — the map then needed a second click.
    let writeAtMount: Writer | null = null;
    let latestWrite: Writer | null = null;
    let search = "";

    render(
      <MemoryRouter initialEntries={["/?zoom=6"]}>
        <Harness
          onRender={(write) => {
            if (!writeAtMount) writeAtMount = write;
            latestWrite = write;
          }}
        />
        <Probe onSearch={(s) => { search = s; }} />
      </MemoryRouter>,
    );

    await act(async () => setCounty(latestWrite!, "los-angeles"));
    expect(search).toContain("county=los-angeles");

    // Fire the writer captured before the county existed.
    await act(async () => writeViewport(writeAtMount!, "9"));

    const params = new URLSearchParams(search);
    expect(params.get("zoom")).toBe("9");
    expect(params.get("county")).toBe("los-angeles");
  });

  it("chains two writes issued in the same tick", async () => {
    // "Clear all" clears the filters and the county in one handler; without
    // chaining the second write restores what the first removed.
    let write: Writer | null = null;
    let search = "";

    render(
      <MemoryRouter initialEntries={["/?severity=fatal&county=kern"]}>
        <Harness onRender={(w) => { write = w; }} />
        <Probe onSearch={(s) => { search = s; }} />
      </MemoryRouter>,
    );

    await act(async () => {
      write!((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("severity");
        return next;
      }, { replace: true });
      write!((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("county");
        return next;
      }, { replace: true });
    });

    expect(search).toBe("");
  });

  it("reads the live URL again once the buffer is flushed", async () => {
    let write: Writer | null = null;
    let search = "";

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Harness onRender={(w) => { write = w; }} />
        <Probe onSearch={(s) => { search = s; }} />
      </MemoryRouter>,
    );

    await act(async () => setCounty(write!, "kern"));
    await act(async () => writeViewport(write!, "7"));

    const params = new URLSearchParams(search);
    expect(params.get("county")).toBe("kern");
    expect(params.get("zoom")).toBe("7");
  });
});

describe("formatSearch", () => {
  it("leaves comma-joined filters readable", () => {
    // URLSearchParams would render this as county=los-angeles%2Corange, which
    // is what turned shared links into a wall of escapes.
    const params = new URLSearchParams();
    params.set("county", "los-angeles,orange");
    params.set("cause", "dui,speeding");
    expect(formatSearch(params)).toBe("?county=los-angeles,orange&cause=dui,speeding");
  });

  it("still escapes characters that need it", () => {
    const params = new URLSearchParams();
    params.set("q", "a&b=c d");
    expect(formatSearch(params)).toBe("?q=a%26b%3Dc+d");
  });

  it("round-trips back to the same values", () => {
    const params = new URLSearchParams();
    params.set("county", "los-angeles,orange");
    const parsed = new URLSearchParams(formatSearch(params));
    expect(parsed.get("county")).toBe("los-angeles,orange");
  });

  it("returns an empty string rather than a dangling question mark", () => {
    expect(formatSearch(new URLSearchParams())).toBe("");
  });
});

describe("useSearchParamsWriter on a nested route", () => {
  beforeEach(() => resetSearchParamsBuffer());

  it("writes the query string without moving off the page", async () => {
    // Every page writes URL state through this hook, not just the map. A write
    // that dropped the pathname would throw Stats users back to the homepage.
    let write: Writer | null = null;
    let path = "";
    let search = "";

    function StatsProbe() {
      const [w] = [useSearchParamsWriter()[1]];
      write = w;
      const location = useLocation();
      path = location.pathname;
      search = location.search;
      return null;
    }

    render(
      <MemoryRouter initialEntries={["/stats?drill_county=kern"]}>
        <Routes>
          <Route path="/stats" element={<StatsProbe />} />
          <Route path="/" element={<div>home</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(path).toBe("/stats");

    await act(async () => {
      write!((prev) => {
        const next = new URLSearchParams(prev);
        next.set("severity", "fatal,injury");
        return next;
      }, { replace: true, preventScrollReset: true });
    });

    expect(path).toBe("/stats");
    expect(search).toContain("drill_county=kern");
    expect(search).toContain("severity=fatal,injury");
  });

  it("keeps the pathname when clearing the last param", async () => {
    let write: Writer | null = null;
    let path = "";
    let search = "";

    function Probe2() {
      write = useSearchParamsWriter()[1];
      const location = useLocation();
      path = location.pathname;
      search = location.search;
      return null;
    }

    render(
      <MemoryRouter initialEntries={["/water?x=1"]}>
        <Routes>
          <Route path="/water" element={<Probe2 />} />
        </Routes>
      </MemoryRouter>,
    );

    await act(async () => {
      write!((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("x");
        return next;
      }, { replace: true });
    });

    expect(path).toBe("/water");
    expect(search).toBe("");
  });
});
