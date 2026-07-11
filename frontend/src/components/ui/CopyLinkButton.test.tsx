import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ToastProvider from "./ToastProvider";
import CopyLinkButton from "./CopyLinkButton";

function setClipboard(writeText: ((text: string) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, "clipboard", {
    value: writeText ? { writeText } : undefined,
    configurable: true,
  });
}

function renderButton(props: React.ComponentProps<typeof CopyLinkButton> = {}) {
  return render(
    <ToastProvider>
      <CopyLinkButton {...props} />
    </ToastProvider>,
  );
}

afterEach(() => {
  setClipboard(undefined);
});

describe("CopyLinkButton", () => {
  it("copies the current URL and confirms with a toast", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);

    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /copy link to this view/i }));

    expect(await screen.findByText("Link copied to clipboard")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(window.location.href);
  });

  it("runs onBeforeCopy before reading the URL", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    const onBeforeCopy = vi.fn();

    renderButton({ onBeforeCopy });
    fireEvent.click(screen.getByRole("button", { name: /copy link to this view/i }));

    await screen.findByText("Link copied to clipboard");
    expect(onBeforeCopy).toHaveBeenCalledTimes(1);
    expect(onBeforeCopy.mock.invocationCallOrder[0]).toBeLessThan(
      writeText.mock.invocationCallOrder[0],
    );
  });

  it("shows an error toast when the clipboard is unavailable", async () => {
    // No clipboard API, and jsdom has no execCommand — both paths fail.
    setClipboard(undefined);

    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /copy link to this view/i }));

    expect(await screen.findByText("Couldn't copy the link")).toBeInTheDocument();
  });
});
