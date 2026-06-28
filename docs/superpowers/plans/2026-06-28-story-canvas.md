# Story Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users pin Ask AI answers into a session-scoped, reorderable vertical "story", annotate it with notes, and export it to PNG or PDF — fully client-side.

**Architecture:** A `StoryCanvasProvider` React context (persisted to `sessionStorage`) holds the canvas state. A Pin button on each AI answer appends a literal snapshot. A slide-over panel on `/ask` reorders/annotates blocks and exports an offscreen `StoryReportView` via the already-installed `html-to-image` + `jspdf`.

**Tech Stack:** React + TypeScript, Vitest + @testing-library/react, `react-markdown` (existing), `html-to-image` (^1.11.13, already in package.json), `jspdf` (^4.2.1, already in package.json).

Spec: `docs/superpowers/specs/2026-06-28-story-canvas-design.md`

## Global Constraints

- Fully client-side. No backend, no network calls, no shareable link.
- Session-scoped only: persist to `sessionStorage` key `calsight-story-canvas`; never `localStorage`.
- No new npm dependencies. Use `html-to-image` and `jspdf` (already installed).
- No drag-and-drop library: reorder via move up/down buttons.
- All `sessionStorage` access wrapped in try/catch; failures fall back to an empty canvas, never throw.
- Reuse existing primitives: `InlineChart` (`components/ask/InlineChart.tsx`) and `ReactMarkdown` for rendering pinned answers; do not reimplement chart/markdown rendering.
- Test files live alongside source as `*.test.tsx` / `*.test.ts` (existing convention).
- Run frontend commands from the `frontend/` directory.

---

## File Structure

New:
- `frontend/src/hooks/useStoryCanvas.tsx` — context provider + hook + state types (Task 1)
- `frontend/src/lib/story/exportCanvas.ts` — PNG/PDF export utilities (Task 2)
- `frontend/src/components/ask/StoryReportView.tsx` — clean offscreen export render (Task 4)
- `frontend/src/components/ask/StoryCanvasPanel.tsx` — slide-over editor panel (Task 5)
- Test files alongside each of the above.

Modified:
- `frontend/src/components/ask/ChatMessage.tsx` — add Pin button (Task 3)
- `frontend/src/pages/AskAiPage.tsx` — provider wrap, Story toggle, offscreen report, export flow (Task 6)

---

## Task 1: Story canvas state (`useStoryCanvas` + `StoryCanvasProvider`)

**Files:**
- Create: `frontend/src/hooks/useStoryCanvas.tsx`
- Test: `frontend/src/hooks/useStoryCanvas.test.tsx`

**Interfaces:**
- Consumes: `ChatMessage`, `ChartData` types from `frontend/src/hooks/useAskAi.ts` (both already exported).
- Produces:
  - `type CanvasBlock` (discriminated union, `kind: "answer" | "note"`).
  - `StoryCanvasProvider({ children }): JSX.Element`
  - `useStoryCanvas(): StoryCanvasApi` where `StoryCanvasApi` =
    `{ title: string; blocks: CanvasBlock[]; count: number; pinAnswer(message: ChatMessage): void; isPinned(timestamp: number): boolean; addNote(): void; updateNote(id: string, text: string): void; setTitle(title: string): void; moveBlock(id: string, dir: "up" | "down"): void; removeBlock(id: string): void; clear(): void; }`

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/src/hooks/useStoryCanvas.test.tsx
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

beforeEach(() => sessionStorage.clear());

describe("useStoryCanvas", () => {
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/hooks/useStoryCanvas.test.tsx`
Expected: FAIL — cannot resolve `./useStoryCanvas` (module not created yet).

- [ ] **Step 3: Write minimal implementation**

```tsx
// frontend/src/hooks/useStoryCanvas.tsx
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from "react";
import type { ChartData, ChatMessage } from "./useAskAi";

const STORAGE_KEY = "calsight-story-canvas";

export type CanvasBlock =
  | {
      id: string;
      kind: "answer";
      question: string;
      content: string;
      chart: ChartData | null;
      provider?: string;
      grounded?: boolean;
      sourceTimestamp: number;
    }
  | {
      id: string;
      kind: "note";
      text: string;
    };

export interface StoryCanvasState {
  title: string;
  blocks: CanvasBlock[];
}

export interface StoryCanvasApi extends StoryCanvasState {
  count: number;
  pinAnswer: (message: ChatMessage) => void;
  isPinned: (timestamp: number) => boolean;
  addNote: () => void;
  updateNote: (id: string, text: string) => void;
  setTitle: (title: string) => void;
  moveBlock: (id: string, dir: "up" | "down") => void;
  removeBlock: (id: string) => void;
  clear: () => void;
}

const EMPTY: StoryCanvasState = { title: "", blocks: [] };

function loadState(): StoryCanvasState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.title === "string" && Array.isArray(parsed.blocks)) {
      return { title: parsed.title, blocks: parsed.blocks };
    }
    return EMPTY;
  } catch {
    return EMPTY;
  }
}

function saveState(state: StoryCanvasState) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }
}

function newId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `b-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const Ctx = createContext<StoryCanvasApi | null>(null);

export function StoryCanvasProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StoryCanvasState>(loadState);

  useEffect(() => { saveState(state); }, [state]);

  const pinAnswer = useCallback((message: ChatMessage) => {
    setState((prev) => {
      if (prev.blocks.some((b) => b.kind === "answer" && b.sourceTimestamp === message.timestamp)) {
        return prev;
      }
      const block: CanvasBlock = {
        id: newId(),
        kind: "answer",
        question: message.question ?? "",
        content: message.content,
        chart: message.chart ?? null,
        provider: message.provider,
        grounded: message.grounded,
        sourceTimestamp: message.timestamp,
      };
      return { ...prev, blocks: [...prev.blocks, block] };
    });
  }, []);

  const isPinned = useCallback(
    (timestamp: number) =>
      state.blocks.some((b) => b.kind === "answer" && b.sourceTimestamp === timestamp),
    [state.blocks],
  );

  const addNote = useCallback(() => {
    setState((prev) => ({
      ...prev,
      blocks: [...prev.blocks, { id: newId(), kind: "note", text: "" }],
    }));
  }, []);

  const updateNote = useCallback((id: string, text: string) => {
    setState((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b) => (b.id === id && b.kind === "note" ? { ...b, text } : b)),
    }));
  }, []);

  const setTitle = useCallback((title: string) => {
    setState((prev) => ({ ...prev, title }));
  }, []);

  const moveBlock = useCallback((id: string, dir: "up" | "down") => {
    setState((prev) => {
      const idx = prev.blocks.findIndex((b) => b.id === id);
      if (idx === -1) return prev;
      const target = dir === "up" ? idx - 1 : idx + 1;
      if (target < 0 || target >= prev.blocks.length) return prev;
      const blocks = [...prev.blocks];
      [blocks[idx], blocks[target]] = [blocks[target], blocks[idx]];
      return { ...prev, blocks };
    });
  }, []);

  const removeBlock = useCallback((id: string) => {
    setState((prev) => ({ ...prev, blocks: prev.blocks.filter((b) => b.id !== id) }));
  }, []);

  const clear = useCallback(() => setState(EMPTY), []);

  const api = useMemo<StoryCanvasApi>(() => ({
    title: state.title,
    blocks: state.blocks,
    count: state.blocks.length,
    pinAnswer, isPinned, addNote, updateNote, setTitle, moveBlock, removeBlock, clear,
  }), [state, pinAnswer, isPinned, addNote, updateNote, setTitle, moveBlock, removeBlock, clear]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useStoryCanvas(): StoryCanvasApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("useStoryCanvas must be used inside <StoryCanvasProvider>");
  return api;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/hooks/useStoryCanvas.test.tsx`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useStoryCanvas.tsx frontend/src/hooks/useStoryCanvas.test.tsx
git commit -m "feat(ask): story canvas state provider + hook"
```

---

## Task 2: Export utilities (`exportCanvas.ts`)

**Files:**
- Create: `frontend/src/lib/story/exportCanvas.ts`
- Test: `frontend/src/lib/story/exportCanvas.test.ts`

**Interfaces:**
- Produces:
  - `defaultFilename(date?: Date): string` → e.g. `"calsight-story-2026-06-28"`
  - `exportPng(node: HTMLElement, filename?: string): Promise<void>`
  - `exportPdf(node: HTMLElement, filename?: string): Promise<void>`

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/lib/story/exportCanvas.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const toPng = vi.fn(async () => "data:image/png;base64,AAAA");
vi.mock("html-to-image", () => ({ toPng }));

const save = vi.fn();
const addImage = vi.fn();
const addPage = vi.fn();
vi.mock("jspdf", () => ({
  jsPDF: vi.fn(() => ({
    internal: { pageSize: { getWidth: () => 100, getHeight: () => 200 } },
    addImage, addPage, save,
  })),
}));

import { defaultFilename, exportPng, exportPdf } from "./exportCanvas";

function fakeNode(): HTMLElement {
  const el = document.createElement("div");
  // jsdom returns 0s for layout; override so PDF math is finite
  el.getBoundingClientRect = () => ({ width: 100, height: 150, top: 0, left: 0, right: 100, bottom: 150, x: 0, y: 0, toJSON: () => ({}) });
  return el;
}

beforeEach(() => { toPng.mockClear(); save.mockClear(); addImage.mockClear(); addPage.mockClear(); });

describe("exportCanvas", () => {
  it("builds a dated filename", () => {
    expect(defaultFilename(new Date("2026-06-28T12:00:00Z"))).toBe("calsight-story-2026-06-28");
  });

  it("exportPng rasterizes the node and triggers a .png download", async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await exportPng(fakeNode(), "calsight-story-2026-06-28");
    expect(toPng).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });

  it("exportPdf rasterizes the node and saves a .pdf", async () => {
    await exportPdf(fakeNode(), "calsight-story-2026-06-28");
    expect(toPng).toHaveBeenCalledTimes(1);
    expect(addImage).toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith("calsight-story-2026-06-28.pdf");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/story/exportCanvas.test.ts`
Expected: FAIL — cannot resolve `./exportCanvas`.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/src/lib/story/exportCanvas.ts
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";

export function defaultFilename(date = new Date()): string {
  return `calsight-story-${date.toISOString().slice(0, 10)}`;
}

function triggerDownload(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

export async function exportPng(node: HTMLElement, filename = defaultFilename()): Promise<void> {
  const dataUrl = await toPng(node, { pixelRatio: 2, backgroundColor: "#ffffff" });
  triggerDownload(dataUrl, `${filename}.png`);
}

export async function exportPdf(node: HTMLElement, filename = defaultFilename()): Promise<void> {
  const rect = node.getBoundingClientRect();
  const dataUrl = await toPng(node, { pixelRatio: 2, backgroundColor: "#ffffff" });

  const pdf = new jsPDF({ unit: "px", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const imgW = pageW;
  const imgH = rect.width > 0 ? (rect.height / rect.width) * imgW : pageH;

  let position = 0;
  let remaining = imgH;
  pdf.addImage(dataUrl, "PNG", 0, position, imgW, imgH);
  remaining -= pageH;
  while (remaining > 0) {
    position -= pageH;
    pdf.addPage();
    pdf.addImage(dataUrl, "PNG", 0, position, imgW, imgH);
    remaining -= pageH;
  }
  pdf.save(`${filename}.pdf`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/story/exportCanvas.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/story/exportCanvas.ts frontend/src/lib/story/exportCanvas.test.ts
git commit -m "feat(ask): PNG/PDF export utilities for story canvas"
```

---

## Task 3: Pin button on AI answers (`ChatMessage.tsx`)

**Files:**
- Modify: `frontend/src/components/ask/ChatMessage.tsx`
- Test: `frontend/src/components/ask/ChatMessage.pin.test.tsx`

**Interfaces:**
- Consumes: `useStoryCanvas()` (Task 1) for `pinAnswer` + `isPinned`.

Note: `ChatMessage` must now render inside `StoryCanvasProvider`. If any pre-existing `ChatMessage` test renders it without the provider, wrap it. (At plan time the only ChatMessage test is the new one below; verify with `ls frontend/src/components/ask/` before implementing and wrap any others found.)

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/ask/ChatMessage.pin.test.tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChatMessage from "./ChatMessage";
import { StoryCanvasProvider } from "../../hooks/useStoryCanvas";
import type { ChatMessage as Msg } from "../../hooks/useAskAi";

const assistantMsg: Msg = {
  role: "assistant", content: "DUI crashes peak at 2am.", timestamp: 100,
  question: "When do DUI crashes peak?", provider: "groq", grounded: true,
};

beforeEach(() => sessionStorage.clear());

function renderWithProvider(msg: Msg) {
  return render(<StoryCanvasProvider><ChatMessage message={msg} /></StoryCanvasProvider>);
}

describe("ChatMessage pin button", () => {
  it("pins the answer and reflects pressed state", () => {
    renderWithProvider(assistantMsg);
    const btn = screen.getByRole("button", { name: "Pin to story" });
    expect(btn).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(btn);
    expect(screen.getByRole("button", { name: "Pinned to story" })).toHaveAttribute("aria-pressed", "true");
  });

  it("does not render a pin button on user messages", () => {
    renderWithProvider({ role: "user", content: "hi", timestamp: 1 });
    expect(screen.queryByRole("button", { name: /pin/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ask/ChatMessage.pin.test.tsx`
Expected: FAIL — no button named "Pin to story" (button not added yet).

- [ ] **Step 3: Add the pin button**

In `frontend/src/components/ask/ChatMessage.tsx`, add the import near the top:

```tsx
import { useStoryCanvas } from "../../hooks/useStoryCanvas";
```

Inside the component body, after the existing `const [feedback, setFeedback] = useState(...)` line, add:

```tsx
  const { pinAnswer, isPinned } = useStoryCanvas();
  const pinned = !isUser && isPinned(message.timestamp);
```

Then, inside the existing `{!isUser && message.provider && (...)}` action row, add the pin button immediately after the closing `</div>` of the thumbs-up/down `<div className="flex items-center gap-0.5">...</div>` group (i.e. as a sibling button before the provider `<p>`):

```tsx
            <button
              type="button"
              onClick={() => pinAnswer(message)}
              aria-label={pinned ? "Pinned to story" : "Pin to story"}
              aria-pressed={pinned}
              className={`p-1 rounded transition-colors ${pinned ? "text-primary" : "text-on-surface-variant/60 hover:text-on-surface-variant"}`}
            >
              <span
                className="material-symbols-outlined text-sm"
                style={pinned ? { fontVariationSettings: "'FILL' 1" } : undefined}
              >
                push_pin
              </span>
            </button>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/ask/ChatMessage.pin.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ask/ChatMessage.tsx frontend/src/components/ask/ChatMessage.pin.test.tsx
git commit -m "feat(ask): pin-to-story button on AI answers"
```

---

## Task 4: Offscreen export render (`StoryReportView.tsx`)

**Files:**
- Create: `frontend/src/components/ask/StoryReportView.tsx`
- Test: `frontend/src/components/ask/StoryReportView.test.tsx`

**Interfaces:**
- Consumes: `CanvasBlock` (Task 1), `InlineChart` (`components/ask/InlineChart.tsx`).
- Produces: `default function StoryReportView({ title, blocks, filterSummary }: { title: string; blocks: CanvasBlock[]; filterSummary: string }): JSX.Element`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/ask/StoryReportView.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StoryReportView from "./StoryReportView";
import type { CanvasBlock } from "../../hooks/useStoryCanvas";

const blocks: CanvasBlock[] = [
  { id: "a", kind: "answer", question: "Q", content: "Peak at 2am.", chart: null, sourceTimestamp: 1 },
  { id: "n", kind: "note", text: "My takeaway." },
];

describe("StoryReportView", () => {
  it("renders title, filter summary, and block content", () => {
    render(<StoryReportView title="DUI Story" blocks={blocks} filterSummary="Kern · 2023" />);
    expect(screen.getByText("DUI Story")).toBeTruthy();
    expect(screen.getByText("Kern · 2023")).toBeTruthy();
    expect(screen.getByText("Peak at 2am.")).toBeTruthy();
    expect(screen.getByText("My takeaway.")).toBeTruthy();
  });

  it("falls back to a default title when none is set", () => {
    render(<StoryReportView title="" blocks={[]} filterSummary="All California data" />);
    expect(screen.getByText("Untitled Story")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ask/StoryReportView.test.tsx`
Expected: FAIL — cannot resolve `./StoryReportView`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// frontend/src/components/ask/StoryReportView.tsx
import ReactMarkdown from "react-markdown";
import type { CanvasBlock } from "../../hooks/useStoryCanvas";
import InlineChart from "./InlineChart";

interface Props {
  title: string;
  blocks: CanvasBlock[];
  filterSummary: string;
}

export default function StoryReportView({ title, blocks, filterSummary }: Props) {
  return (
    <div className="bg-white text-gray-900 p-10 w-[720px] font-body">
      <header className="border-b border-gray-200 pb-4 mb-6">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-gray-500">CalSight · Ask AI Story</p>
        <h1 className="text-2xl font-headline font-bold mt-1">{title.trim() || "Untitled Story"}</h1>
        <p className="text-xs text-gray-500 mt-2">
          {filterSummary} · {new Date().toLocaleDateString()}
        </p>
      </header>

      <div className="space-y-6">
        {blocks.map((block) =>
          block.kind === "answer" ? (
            <article key={block.id} className="space-y-2">
              {block.question && (
                <p className="text-sm font-semibold text-gray-700">{block.question}</p>
              )}
              <div className="prose prose-sm max-w-none text-gray-900">
                <ReactMarkdown>{block.content}</ReactMarkdown>
              </div>
              {block.chart && <InlineChart chart={block.chart} />}
            </article>
          ) : (
            <p key={block.id} className="font-serif text-gray-800 leading-relaxed whitespace-pre-wrap">
              {block.text}
            </p>
          ),
        )}
      </div>

      <footer className="border-t border-gray-200 mt-8 pt-3 text-[10px] text-gray-400">
        Generated by CalSight Ask AI · AI can hallucinate — verify critical data.
      </footer>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/ask/StoryReportView.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ask/StoryReportView.tsx frontend/src/components/ask/StoryReportView.test.tsx
git commit -m "feat(ask): story report view for export"
```

---

## Task 5: Editor panel (`StoryCanvasPanel.tsx`)

**Files:**
- Create: `frontend/src/components/ask/StoryCanvasPanel.tsx`
- Test: `frontend/src/components/ask/StoryCanvasPanel.test.tsx`

**Interfaces:**
- Consumes: `useStoryCanvas()` (Task 1) for title/blocks/reorder/notes/remove/clear.
- Produces: `default function StoryCanvasPanel({ open, onClose, onExportPng, onExportPdf }: { open: boolean; onClose(): void; onExportPng(): void; onExportPdf(): void; }): JSX.Element | null`

Behavior: returns `null` when `!open`. Renders a `role="dialog" aria-modal="true"` slide-over. Title input bound to `setTitle`. Each block shows move-up/down + remove controls (disabled at ends). "Add note" appends a note. Footer has Export PNG / Export PDF / Clear (Clear calls `clear()` after `window.confirm`). Escape calls `onClose`. Empty state shown when `count === 0`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/ask/StoryCanvasPanel.test.tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { ReactNode } from "react";
import StoryCanvasPanel from "./StoryCanvasPanel";
import { StoryCanvasProvider, useStoryCanvas } from "../../hooks/useStoryCanvas";
import type { ChatMessage } from "../../hooks/useAskAi";

function answer(ts: number, content: string): ChatMessage {
  return { role: "assistant", content, timestamp: ts, question: "Q?", provider: "groq", grounded: true };
}

// Seed the canvas, then render the panel inside the same provider.
function Harness({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pinAnswer, count } = useStoryCanvas();
  return (
    <>
      <button onClick={() => pinAnswer(answer(Date.now() + count, `answer ${count + 1}`))}>seed</button>
      <StoryCanvasPanel open={open} onClose={onClose} onExportPng={() => {}} onExportPdf={() => {}} />
    </>
  );
}

const wrap = (ui: ReactNode) => render(<StoryCanvasProvider>{ui}</StoryCanvasProvider>);

beforeEach(() => sessionStorage.clear());

describe("StoryCanvasPanel", () => {
  it("renders nothing when closed", () => {
    wrap(<Harness open={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows an empty state when there are no blocks", () => {
    wrap(<Harness open onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: /story/i })).toBeTruthy();
    expect(screen.getByText(/pin answers from the chat/i)).toBeTruthy();
  });

  it("adds a note block from the panel", () => {
    wrap(<Harness open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /add note/i }));
    expect(screen.getByPlaceholderText(/note/i)).toBeTruthy();
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    wrap(<Harness open onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("clears the canvas after confirm", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    wrap(<Harness open onClose={() => {}} />);
    act(() => { fireEvent.click(screen.getByText("seed")); });
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(screen.getByText(/pin answers from the chat/i)).toBeTruthy();
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ask/StoryCanvasPanel.test.tsx`
Expected: FAIL — cannot resolve `./StoryCanvasPanel`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// frontend/src/components/ask/StoryCanvasPanel.tsx
import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { useStoryCanvas } from "../../hooks/useStoryCanvas";
import InlineChart from "./InlineChart";

interface Props {
  open: boolean;
  onClose: () => void;
  onExportPng: () => void;
  onExportPdf: () => void;
}

export default function StoryCanvasPanel({ open, onClose, onExportPng, onExportPdf }: Props) {
  const {
    title, blocks, count, setTitle, addNote, updateNote, moveBlock, removeBlock, clear,
  } = useStoryCanvas();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const handleClear = () => {
    if (count === 0 || window.confirm("Clear this story? This can't be undone.")) clear();
  };

  return (
    <div className="fixed inset-0 z-[1100] flex justify-end" >
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Your AI story"
        tabIndex={-1}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
        className="relative w-full max-w-md h-full bg-surface shadow-xl flex flex-col outline-none"
      >
        {/* Header */}
        <div className="flex-none flex items-center gap-2 px-4 py-3 border-b border-outline-variant">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Story title…"
            aria-label="Story title"
            className="flex-1 bg-transparent text-on-surface font-semibold text-base outline-none placeholder:text-outline"
          />
          <button type="button" onClick={onClose} aria-label="Close story panel" className="p-1 text-on-surface-variant hover:text-on-surface">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {count === 0 ? (
            <p className="text-sm text-on-surface-variant text-center py-12">
              Pin answers from the chat to start building a shareable story.
            </p>
          ) : (
            blocks.map((block, i) => (
              <div key={block.id} className="rounded-lg bg-surface-container-lowest ghost-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {block.kind === "answer" ? (
                      <>
                        <div className="prose prose-sm dark:prose-invert max-w-none text-on-surface">
                          <ReactMarkdown>{block.content}</ReactMarkdown>
                        </div>
                        {block.chart && <InlineChart chart={block.chart} />}
                      </>
                    ) : (
                      <textarea
                        value={block.text}
                        onChange={(e) => updateNote(block.id, e.target.value)}
                        placeholder="Write a note…"
                        aria-label="Story note"
                        className="w-full bg-transparent text-sm text-on-surface resize-none outline-none"
                        rows={2}
                      />
                    )}
                  </div>
                  <div className="flex-none flex flex-col gap-0.5">
                    <button type="button" onClick={() => moveBlock(block.id, "up")} disabled={i === 0} aria-label="Move up" className="p-0.5 text-on-surface-variant hover:text-on-surface disabled:opacity-30">
                      <span className="material-symbols-outlined text-base">arrow_upward</span>
                    </button>
                    <button type="button" onClick={() => moveBlock(block.id, "down")} disabled={i === blocks.length - 1} aria-label="Move down" className="p-0.5 text-on-surface-variant hover:text-on-surface disabled:opacity-30">
                      <span className="material-symbols-outlined text-base">arrow_downward</span>
                    </button>
                    <button type="button" onClick={() => removeBlock(block.id)} aria-label="Remove block" className="p-0.5 text-on-surface-variant hover:text-error">
                      <span className="material-symbols-outlined text-base">delete</span>
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
          <button type="button" onClick={addNote} className="w-full text-sm text-primary hover:underline py-2">
            + Add note
          </button>
        </div>

        {/* Footer */}
        <div className="flex-none flex items-center gap-2 px-4 py-3 border-t border-outline-variant">
          <button type="button" onClick={onExportPng} disabled={count === 0} className="flex-1 bg-primary text-on-primary rounded-lg py-2 text-sm font-medium disabled:opacity-40">
            Export PNG
          </button>
          <button type="button" onClick={onExportPdf} disabled={count === 0} className="flex-1 bg-surface-container-high text-on-surface rounded-lg py-2 text-sm font-medium disabled:opacity-40">
            Export PDF
          </button>
          <button type="button" onClick={handleClear} aria-label="Clear story" className="p-2 text-on-surface-variant hover:text-error">
            <span className="material-symbols-outlined">delete_sweep</span>
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/ask/StoryCanvasPanel.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ask/StoryCanvasPanel.tsx frontend/src/components/ask/StoryCanvasPanel.test.tsx
git commit -m "feat(ask): story canvas editor panel"
```

---

## Task 6: Wire into the Ask AI page (`AskAiPage.tsx`)

**Files:**
- Modify: `frontend/src/pages/AskAiPage.tsx`
- Test: `frontend/src/pages/AskAiPage.story.test.tsx`

**Interfaces:**
- Consumes: `StoryCanvasProvider` + `useStoryCanvas` (Task 1), `StoryCanvasPanel` (Task 5), `StoryReportView` (Task 4), `exportPng`/`exportPdf` (Task 2).

The current default export becomes an inner component wrapped by the provider, so both `ChatMessage` (pin button) and the new toggle/panel share one canvas context.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/pages/AskAiPage.story.test.tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AskAiPage from "./AskAiPage";

// Avoid real export side effects in jsdom.
vi.mock("../lib/story/exportCanvas", () => ({
  exportPng: vi.fn(), exportPdf: vi.fn(), defaultFilename: () => "calsight-story-test",
}));

beforeEach(() => sessionStorage.clear());

describe("AskAiPage story canvas integration", () => {
  it("shows a Story toggle that opens the panel", () => {
    render(<MemoryRouter><AskAiPage /></MemoryRouter>);
    const toggle = screen.getByRole("button", { name: /story/i });
    fireEvent.click(toggle);
    expect(screen.getByRole("dialog", { name: /story/i })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/AskAiPage.story.test.tsx`
Expected: FAIL — no button matching /story/.

- [ ] **Step 3: Modify `AskAiPage.tsx`**

Add imports near the existing imports:

```tsx
import { useState as useReactState } from "react";
import { StoryCanvasProvider, useStoryCanvas } from "../hooks/useStoryCanvas";
import StoryCanvasPanel from "../components/ask/StoryCanvasPanel";
import StoryReportView from "../components/ask/StoryReportView";
import { exportPng, exportPdf } from "../lib/story/exportCanvas";
```

(If `useState` is already imported, reuse it instead of `useReactState`; the alias is only to avoid a duplicate-import edit error — prefer the existing `useState`.)

Rename the current `export default function AskAiPage()` to `function AskAiPageInner()` (keep its entire body unchanged), and add a new wrapper export at the bottom of the file:

```tsx
export default function AskAiPage() {
  return (
    <StoryCanvasProvider>
      <AskAiPageInner />
    </StoryCanvasProvider>
  );
}
```

Inside `AskAiPageInner`, add canvas wiring near the other hooks (after the existing `useAskAi()` line):

```tsx
  const { title, blocks, count } = useStoryCanvas();
  const [storyOpen, setStoryOpen] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  const handleExportPng = () => { if (reportRef.current) void exportPng(reportRef.current); };
  const handleExportPdf = () => { if (reportRef.current) void exportPdf(reportRef.current); };
```

In the sticky header (the `<div ...>` containing the `<h1>Ask AI</h1>`), add a Story toggle button next to the existing "New Chat" button. Place it inside the header's right-hand area:

```tsx
        <button
          type="button"
          onClick={() => setStoryOpen(true)}
          className="flex-none flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container-high hover:bg-surface-container text-on-surface-variant hover:text-on-surface text-xs font-medium transition-colors whitespace-nowrap"
          aria-label={`Open story canvas (${count} ${count === 1 ? "item" : "items"})`}
        >
          <span className="material-symbols-outlined text-sm">auto_stories</span>
          Story{count > 0 ? ` (${count})` : ""}
        </button>
```

At the end of `AskAiPageInner`'s returned JSX, just before the closing `</div>` of the outermost container, add the panel plus the offscreen report:

```tsx
      <StoryCanvasPanel
        open={storyOpen}
        onClose={() => setStoryOpen(false)}
        onExportPng={handleExportPng}
        onExportPdf={handleExportPdf}
      />
      <div ref={reportRef} aria-hidden="true" style={{ position: "fixed", left: "-9999px", top: 0 }}>
        <StoryReportView title={title} blocks={blocks} filterSummary={filterSummary} />
      </div>
```

(`filterSummary` is the existing const already computed in the component.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pages/AskAiPage.story.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the full Ask AI test surface + typecheck**

Run: `npx vitest run src/components/ask src/hooks/useStoryCanvas.test.tsx src/lib/story src/pages/AskAiPage.story.test.tsx`
Expected: PASS (all).
Run: `npx tsc --noEmit`
Expected: clean (exit 0).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/AskAiPage.tsx frontend/src/pages/AskAiPage.story.test.tsx
git commit -m "feat(ask): mount story canvas (toggle + panel + export) on Ask AI page"
```

---

## Self-Review

**Spec coverage:**
- Pin from chat → Task 3. ✅
- `useStoryCanvas` context + sessionStorage + actions → Task 1. ✅
- Slide-over panel (title, reorder, notes, remove, clear, empty state, Escape/modal) → Task 5. ✅
- Export PNG/PDF via html-to-image + jspdf → Task 2; offscreen `StoryReportView` target → Task 4. ✅
- "Story (N)" toggle + provider wrap + export wiring → Task 6. ✅
- Branding + filter summary + date in export → Task 4 (`StoryReportView`). ✅
- A11y (aria-pressed pin, modal dialog, button-based reorder) → Tasks 3/5. ✅
- Idempotent pin / corrupt-store fallback / session scope → Task 1. ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✅

**Type consistency:** `CanvasBlock`, `StoryCanvasApi`, `pinAnswer`, `isPinned`, `moveBlock(id, "up"|"down")`, `addNote`, `updateNote`, `removeBlock`, `clear`, `setTitle` used identically across Tasks 1/3/4/5/6. `StoryReportView` props `{ title, blocks, filterSummary }` match Task 6's usage. `exportPng`/`exportPdf(node, filename?)` signatures match Task 6's calls. ✅

**Note for implementer:** Before Task 3, list `frontend/src/components/ask/` and wrap any pre-existing `ChatMessage` test that renders `<ChatMessage>` without a `StoryCanvasProvider` (the new `useStoryCanvas()` call throws outside the provider).
