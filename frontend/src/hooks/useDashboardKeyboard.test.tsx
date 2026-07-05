// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { useDashboardKeyboard } from "./useDashboardKeyboard";
import { PRESET_KEYS } from "../lib/dashboard/presets";

type Props = Parameters<typeof useDashboardKeyboard>[0];
function Harness(props: Props) {
  useDashboardKeyboard(props);
  return <input data-testid="field" />;
}

const noop = () => {};

describe("useDashboardKeyboard", () => {
  it("maps number keys 1-8 to the preset at that index", () => {
    const onSetPreset = vi.fn();
    render(<Harness onSetMode={noop} onSetPreset={onSetPreset} onCloseConfig={noop} />);
    fireEvent.keyDown(document, { key: "1" });
    fireEvent.keyDown(document, { key: "3" });
    expect(onSetPreset).toHaveBeenNthCalledWith(1, PRESET_KEYS[0]);
    expect(onSetPreset).toHaveBeenNthCalledWith(2, PRESET_KEYS[2]);
  });

  it("B enters builder/advanced mode; Escape closes config", () => {
    const onSetMode = vi.fn();
    const onCloseConfig = vi.fn();
    render(<Harness onSetMode={onSetMode} onSetPreset={noop} onCloseConfig={onCloseConfig} />);
    fireEvent.keyDown(document, { key: "b" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onSetMode).toHaveBeenCalledWith("advanced");
    expect(onCloseConfig).toHaveBeenCalledOnce();
  });

  it("ignores shortcuts while an input is focused", () => {
    const onSetPreset = vi.fn();
    render(<Harness onSetMode={noop} onSetPreset={onSetPreset} onCloseConfig={noop} />);
    screen.getByTestId("field").focus();
    fireEvent.keyDown(document, { key: "1" });
    expect(onSetPreset).not.toHaveBeenCalled();
  });

  it("removes its listener on unmount", () => {
    const onSetPreset = vi.fn();
    const { unmount } = render(
      <Harness onSetMode={noop} onSetPreset={onSetPreset} onCloseConfig={noop} />,
    );
    unmount();
    fireEvent.keyDown(document, { key: "2" });
    expect(onSetPreset).not.toHaveBeenCalled();
  });

  it("does nothing when disabled", () => {
    const onSetPreset = vi.fn();
    render(<Harness onSetMode={noop} onSetPreset={onSetPreset} onCloseConfig={noop} enabled={false} />);
    fireEvent.keyDown(document, { key: "1" });
    expect(onSetPreset).not.toHaveBeenCalled();
  });
});
