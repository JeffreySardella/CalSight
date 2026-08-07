import { describe, expect, it } from "vitest";

import { PngExportError, dataUrlToBlob } from "./png";

/**
 * Regression cover for the production PNG export failure: the old code did
 * `fetch(dataUrl)` to turn html-to-image's data: URL into a Blob, which the
 * site's own CSP (`connect-src` without `data:`) blocked, so every export
 * failed with "Export failed: Failed to fetch". Decoding in-process must work
 * without any network access at all.
 */
describe("dataUrlToBlob", () => {
  it("decodes a base64 png data URL", async () => {
    // "PNG!" in base64.
    const blob = dataUrlToBlob("data:image/png;base64,UE5HIQ==");

    expect(blob.type).toBe("image/png");
    expect(await blob.text()).toBe("PNG!");
  });

  it("preserves the declared mime type", () => {
    expect(dataUrlToBlob("data:image/jpeg;base64,UE5HIQ==").type).toBe("image/jpeg");
  });

  it("defaults to image/png when the header omits a mime type", () => {
    expect(dataUrlToBlob("data:;base64,UE5HIQ==").type).toBe("image/png");
  });

  it("handles non-base64 (percent-encoded) data URLs", async () => {
    const blob = dataUrlToBlob("data:text/plain,hello%20world");
    expect(await blob.text()).toBe("hello world");
  });

  it("produces byte-accurate output for binary payloads", async () => {
    // Bytes 0x00 0x01 0xFF — the charCodeAt loop must not mangle high bytes.
    const blob = dataUrlToBlob("data:application/octet-stream;base64,AAH/");
    const bytes = new Uint8Array(await blob.arrayBuffer());

    expect(Array.from(bytes)).toEqual([0x00, 0x01, 0xff]);
  });

  it("rejects a string that is not a data URL", () => {
    expect(() => dataUrlToBlob("https://example.com/x.png")).toThrow(PngExportError);
  });

  it("rejects a malformed data URL with no comma", () => {
    expect(() => dataUrlToBlob("data:image/png;base64")).toThrow(PngExportError);
  });
});
