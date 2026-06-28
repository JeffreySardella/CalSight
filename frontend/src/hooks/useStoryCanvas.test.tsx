import { describe, it, expect, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { StoryCanvasProvider, useStoryCanvas } from "./useStoryCanvas";
import type { ChatMessage } from "./useAskAi";

const wrapper = ({ children }: { children: ReactNode }) => (
  <StoryCanvasProvider>{children}</StoryCanvasProvider>
);

function answer(timestamp: number, content = "Hello"): ChatMessage {
  return { role: "assistant", content, timestamp, question: "Q?", provider: "groq", grounded: true };
}

describe("useStoryCanvas", () => {
  beforeEach(() => sessionStorage.clear());
  it("pins an answer as an answer block", () => {
    const { result } = renderHook(() => useStoryCanvas(), { wrapper });
    act(() => result.current.pinAnswer(answer(1)));
    expect(result.current.count).toBe(1);
    const block = result.current.blocks[0];
    expect(block.kind).toBe("answer");
    if (block.kind === "answer") {
      expect(block.content).toBe("Hello");
      expect(block.sourceTimestamp).toBe(1);
    }
  });

  it("does not pin the same answer twice (dedupe by timestamp)", () => {
    const { result } = renderHook(() => useStoryCanvas(), { wrapper });
    act(() => result.current.pinAnswer(answer(1)));
    act(() => result.current.pinAnswer(answer(1)));
    expect(result.current.count).toBe(1);
    expect(result.current.isPinned(1)).toBe(true);
    expect(result.current.isPinned(2)).toBe(false);
  });

  it("adds and edits notes", () => {
    const { result } = renderHook(() => useStoryCanvas(), { wrapper });
    act(() => result.current.addNote());
    const id = result.current.blocks[0].id;
    act(() => result.current.updateNote(id, "my note"));
    const block = result.current.blocks[0];
    expect(block.kind).toBe("note");
    if (block.kind === "note") expect(block.text).toBe("my note");
  });

  it("sets the title", () => {
    const { result } = renderHook(() => useStoryCanvas(), { wrapper });
    act(() => result.current.setTitle("Crashes in Kern"));
    expect(result.current.title).toBe("Crashes in Kern");
  });

  it("moves a block up and down, clamping at the ends", () => {
    const { result } = renderHook(() => useStoryCanvas(), { wrapper });
    act(() => result.current.pinAnswer(answer(1, "first")));
    act(() => result.current.pinAnswer(answer(2, "second")));
    const secondId = result.current.blocks[1].id;
    act(() => result.current.moveBlock(secondId, "up"));
    expect((result.current.blocks[0] as { content: string }).content).toBe("second");
    // moving the top block up again is a no-op
    act(() => result.current.moveBlock(result.current.blocks[0].id, "up"));
    expect((result.current.blocks[0] as { content: string }).content).toBe("second");
    // now move it back down and confirm the bottom-edge clamp
    act(() => result.current.moveBlock(result.current.blocks[0].id, "down"));
    expect((result.current.blocks[1] as { content: string }).content).toBe("second");
    act(() => result.current.moveBlock(result.current.blocks[1].id, "down"));
    expect((result.current.blocks[1] as { content: string }).content).toBe("second");
  });

  it("removes a block and clears the canvas", () => {
    const { result } = renderHook(() => useStoryCanvas(), { wrapper });
    act(() => result.current.pinAnswer(answer(1)));
    act(() => result.current.addNote());
    act(() => result.current.removeBlock(result.current.blocks[0].id));
    expect(result.current.count).toBe(1);
    act(() => result.current.clear());
    expect(result.current.count).toBe(0);
    expect(result.current.title).toBe("");
  });

  it("persists to sessionStorage and hydrates a fresh provider", () => {
    const first = renderHook(() => useStoryCanvas(), { wrapper });
    act(() => first.result.current.setTitle("Persisted"));
    act(() => first.result.current.pinAnswer(answer(7)));
    // a brand-new provider instance should read the stored state
    const second = renderHook(() => useStoryCanvas(), { wrapper });
    expect(second.result.current.title).toBe("Persisted");
    expect(second.result.current.count).toBe(1);
  });

  it("falls back to an empty canvas when storage is corrupt", () => {
    sessionStorage.setItem("calsight-story-canvas", "{not json");
    const { result } = renderHook(() => useStoryCanvas(), { wrapper });
    expect(result.current.count).toBe(0);
    expect(result.current.title).toBe("");
  });

  it("throws when used outside the provider", () => {
    expect(() => renderHook(() => useStoryCanvas())).toThrow(/StoryCanvasProvider/);
  });
});
