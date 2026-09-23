import { describe, it, expect, vi, beforeEach } from "vitest";
import { dropHtmlPrecacheEntries, failedModuleUrl, healPrecache } from "./healPrecache";

/** A minimal in-memory CacheStorage holding [url, content-type] entries. */
function fakeCaches(entries: Record<string, [string, string][]>) {
  const stores = new Map(
    Object.entries(entries).map(([name, list]) => [
      name,
      new Map(list.map(([url, type]) => [url, new Response("x", { headers: { "content-type": type } })])),
    ]),
  );
  const storage = {
    keys: async () => [...stores.keys()],
    open: async (name: string) => {
      const store = stores.get(name)!;
      return {
        keys: async () => [...store.keys()].map((u) => new Request(u)),
        match: async (r: Request) => store.get(r.url),
        delete: async (r: Request) => store.delete(r.url),
      };
    },
  };
  return { storage: storage as unknown as CacheStorage, stores };
}

const PRECACHE = "workbox-precache-v2-https://calsight.org/";

describe("dropHtmlPrecacheEntries", () => {
  it("removes build files stored as HTML and keeps everything else", async () => {
    const { storage, stores } = fakeCaches({
      [PRECACHE]: [
        ["https://calsight.org/assets/index-DyBuCTMT.css", "text/html; charset=utf-8"],
        ["https://calsight.org/assets/WaterPage-a.js", "text/html; charset=utf-8"],
        ["https://calsight.org/assets/index-B.js", "application/javascript"],
        ["https://calsight.org/index.html", "text/html; charset=utf-8"],
      ],
      "map-tiles": [["https://tile.example/1.js", "text/html"]],
    });
    expect(await dropHtmlPrecacheEntries(storage)).toEqual([
      "https://calsight.org/assets/index-DyBuCTMT.css",
      "https://calsight.org/assets/WaterPage-a.js",
    ]);
    expect([...stores.get(PRECACHE)!.keys()]).toEqual([
      "https://calsight.org/assets/index-B.js",
      "https://calsight.org/index.html",
    ]);
    // Only the Workbox precache is touched.
    expect(stores.get("map-tiles")!.size).toBe(1);
  });
});

describe("healPrecache", () => {
  beforeEach(() => sessionStorage.clear());

  it("refreshes the browser cache for what it removed, reloads once, and never loops", async () => {
    const reload = vi.fn();
    const fetchSpy = vi.fn(async () => new Response("body{}"));
    vi.stubGlobal("fetch", fetchSpy);
    const make = () =>
      fakeCaches({ [PRECACHE]: [["https://calsight.org/assets/a.css", "text/html"]] }).storage;
    vi.stubGlobal("caches", make());
    await healPrecache(reload);
    vi.stubGlobal("caches", make());
    await healPrecache(reload);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith("https://calsight.org/assets/a.css", { cache: "reload" });
    vi.unstubAllGlobals();
  });

  it("refreshes a module a failed load reported even when the precache is clean", async () => {
    const reload = vi.fn();
    const fetchSpy = vi.fn(async () => new Response("x"));
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("caches", fakeCaches({ [PRECACHE]: [] }).storage);
    const url = failedModuleUrl(
      new TypeError("Failed to fetch dynamically imported module: https://calsight.org/assets/AskAiPage-CWRmYvkt.js"),
    );
    expect(url).toBe("https://calsight.org/assets/AskAiPage-CWRmYvkt.js");
    await healPrecache(reload, [url!]);
    expect(fetchSpy).toHaveBeenCalledWith(url, { cache: "reload" });
    expect(reload).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("does nothing when the cache is healthy", async () => {
    const reload = vi.fn();
    vi.stubGlobal("caches", fakeCaches({ [PRECACHE]: [["https://calsight.org/assets/a.css", "text/css"]] }).storage);
    await healPrecache(reload);
    expect(reload).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
