import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// jsdom does not implement PromiseRejectionEvent, so synthesize an Event
// carrying a `reason` the way the browser event does.
function dispatchRejection(reason: unknown) {
  const event = new Event("unhandledrejection");
  (event as Event & { reason: unknown }).reason = reason;
  window.dispatchEvent(event);
}

describe("instrument — global unhandledrejection listener (#303)", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await import("./instrument");
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("logs unhandled promise rejections with a recognizable prefix", () => {
    const reason = new Error("boom from a floating promise");
    dispatchRejection(reason);

    expect(errorSpy).toHaveBeenCalledWith("[calsight:unhandledrejection]", reason);
  });

  it("logs non-Error rejection reasons too", () => {
    dispatchRejection("plain string rejection");
    expect(errorSpy).toHaveBeenCalledWith("[calsight:unhandledrejection]", "plain string rejection");
  });
});
