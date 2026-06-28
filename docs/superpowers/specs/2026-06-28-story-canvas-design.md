# Story Canvas — Design

**Date:** 2026-06-28
**Status:** Approved (design); spec pending user review
**Feature area:** Ask AI (`/ask`)

## Summary

Let a user collect AI answers from the Ask AI chat into a session-scoped
**Story Canvas**: a reorderable vertical report they title, annotate with text
notes, and export to PNG or PDF. Fully client-side — no backend, no accounts,
no shareable link. The canvas clears when the tab closes, consistent with the
existing Ask AI privacy model ("conversations clear when you close this tab").

This is the "Story Canvas" cluster of the interactive AI storytelling vision,
re-specified from scratch (the original spec was lost). It deliberately reuses
the existing Ask AI chat primitives rather than the dashboard `StoryReader`,
because a pinned AI answer carries **literal** content + chart data, whereas
`StoryReader` re-fetches charts live by dimension+measure.

## Goals

- Pin any AI answer (markdown + optional chart) from the chat into a story.
- Arrange pinned answers as a reorderable vertical document.
- Add a story title and free-text notes between blocks so it reads as a
  narrative, not a dump.
- Export the finished story as a clean PNG or PDF that includes light CalSight
  branding, the active filter summary, and the date.

## Non-Goals (YAGNI)

- No backend persistence, saved stories, or shareable links.
- No cross-session persistence (session-scoped only).
- No freeform 2D canvas (vertical report only).
- No drag-and-drop library (reorder via move up/down buttons).
- No editing of captured answer text (notes are the only editable prose).

## Architecture

### State: `useStoryCanvas` + `StoryCanvasProvider`

New file `frontend/src/hooks/useStoryCanvas.tsx`. A React context provider holds
the canvas state and persists it to `sessionStorage` under
`calsight-story-canvas`, mirroring the load/save pattern already used by
`useAskAi`. Context (not a bare hook) is required because the Pin button lives
in `ChatMessage` and the panel lives in `StoryCanvasPanel` — two separate
subtrees that must share live state, which `sessionStorage` alone does not sync
within a tab.

State shape:

```ts
type CanvasBlock =
  | {
      id: string;          // crypto.randomUUID()
      kind: "answer";
      question: string;
      content: string;     // markdown
      chart: ChartData | null;  // literal data, from ChatMessage
      provider?: string;
      grounded?: boolean;
      sourceTimestamp: number;  // the chat message timestamp (dedupe key)
    }
  | {
      id: string;
      kind: "note";
      text: string;
    };

interface StoryCanvasState {
  title: string;
  blocks: CanvasBlock[];
}
```

Exposed API:

- `pinAnswer(message: ChatMessage)` — append an `answer` block snapshot. No-op
  if a block with the same `sourceTimestamp` already exists (idempotent pin).
- `isPinned(timestamp: number): boolean` — for the Pin button's state.
- `addNote()` — append an empty `note` block.
- `updateNote(id, text)` — edit a note's text.
- `setTitle(title)`.
- `moveBlock(id, "up" | "down")` — reorder; clamps at ends.
- `removeBlock(id)`.
- `clear()` — empty the canvas (title + blocks).
- `title`, `blocks`, `count` (number of blocks).

`ChartData` is imported from `useAskAi` (already exported there).

### Pin affordance: `ChatMessage.tsx` (modified)

Add a "Pin to story" icon button to the existing assistant-message action row
(currently the thumbs-up/down + provider line). It calls `pinAnswer(message)`
and reflects pinned state via `isPinned(message.timestamp)` (filled vs outline
push-pin icon, `aria-pressed`). Only rendered for assistant messages, like the
feedback controls. Reads the canvas via `useStoryCanvas()`.

### Panel: `StoryCanvasPanel.tsx` (new)

A right-side slide-over drawer, treated as a modal dialog:

- `role="dialog"`, `aria-modal="true"`, labeled; Escape closes; focus moves into
  the panel on open and is trapped; focus returns to the toggle button on close.
- Header: editable story **title** input + close button.
- Body: ordered list of blocks.
  - `answer` blocks render **read-only** via `ReactMarkdown` + the reused
    `InlineChart` component (same rendering as chat, minus the feedback row).
  - `note` blocks render an editable `<textarea>` bound to `updateNote`.
  - Each block has move-up / move-down / remove controls (icon buttons with
    aria-labels; disabled at list ends).
- An "Add note" button.
- Footer: **Export PNG**, **Export PDF**, **Clear** (Clear asks for confirm).
- Empty state: short instructions ("Pin answers from the chat to start building
  a shareable story").

Open/close state is local to `AskAiPage` (the panel is presentational +
canvas-context-driven).

### Export target: `StoryReportView.tsx` (new)

A clean, controls-free rendering of the story used solely as the export source.
Renders: a small CalSight header (wordmark + "Ask AI Story"), the active filter
summary (passed in from `AskAiPage`, reusing its existing `filterSummary`
logic), the date, the title, then the blocks (answers as prose + chart, notes as
prose). Rendered off-screen (e.g. fixed, `left: -9999px`, fixed export width
~720px) only during export, then removed. Light/dark: render on a forced light
surface for predictable print output.

### Export utility: `lib/story/exportCanvas.ts` (new)

- `exportPng(node: HTMLElement, filename: string): Promise<void>` — uses
  `html-to-image`'s `toPng`, triggers a download via an anchor.
- `exportPdf(node: HTMLElement, filename: string): Promise<void>` — `toPng` →
  `jsPDF` `addImage`, paginating across pages if the image is taller than one
  page, then `save`.
- Default filename `calsight-story-YYYY-MM-DD`.

Both `html-to-image` (^1.11.13) and `jspdf` (^4.2.1) are already in
`package.json` and currently unused; this feature establishes the first usage.

### Page wiring: `AskAiPage.tsx` (modified)

- Wrap the page contents in `<StoryCanvasProvider>`.
- Add a **"Story (N)"** toggle button to the sticky header (N = `count`), which
  opens `StoryCanvasPanel`.
- Own the panel open/close state and the offscreen-render-for-export flow,
  passing the existing `filterSummary` into `StoryReportView`.

## Data Flow

1. User asks a question → AI answer renders in chat (existing behavior).
2. User clicks **Pin** on an answer → a snapshot (content + literal chart +
   meta) is appended to canvas state and written to `sessionStorage`.
3. User opens the **Story (N)** panel → sets a title, reorders blocks, inserts
   notes, removes blocks.
4. User clicks **Export PNG/PDF** → `StoryReportView` renders offscreen → the
   export utility rasterizes it and downloads the file.

## Error Handling

- Pin is idempotent (dedupe on `sourceTimestamp`); pinning the same answer twice
  is a no-op.
- `sessionStorage` reads/writes are wrapped in try/catch (like `useAskAi`); a
  corrupt or unavailable store falls back to an empty canvas without throwing.
- Export failures (rasterization errors) are caught and surfaced as a small
  inline error in the panel footer; they never crash the page.
- Clear requires confirmation to avoid accidental loss of an assembled story.

## Testing (TDD)

- **`useStoryCanvas`**: pinAnswer appends + dedupes by `sourceTimestamp`;
  addNote/updateNote; setTitle; moveBlock up/down with end-clamping;
  removeBlock; clear; sessionStorage round-trip (persist on change, hydrate on
  mount); corrupt-store fallback.
- **`ChatMessage` Pin button**: clicking pins the message; `aria-pressed`
  reflects `isPinned`; only shown for assistant messages.
- **`StoryCanvasPanel`**: renders answer + note blocks; move up/down reorders;
  remove deletes; title edits propagate; empty-state shows instructions;
  Escape closes.
- **`exportCanvas`**: mock `html-to-image` and `jspdf`; assert `toPng` is called
  with the node and that a download (PNG) / `save` (PDF) is triggered; assert
  filename format.

Real rasterized output is not asserted (jsdom can't paint); the tests verify
orchestration and state, consistent with the existing frontend test approach.

## Accessibility

- Panel is a proper modal dialog: `aria-modal`, focus trap, Escape, focus
  return.
- Reorder/remove are real buttons with descriptive `aria-label`s and disabled
  states at list ends (keyboard-operable without drag-and-drop).
- Pin button uses `aria-pressed` for pinned state.
- "Story (N)" toggle has an accessible name reflecting the count.

## File Summary

New:
- `frontend/src/hooks/useStoryCanvas.tsx`
- `frontend/src/components/ask/StoryCanvasPanel.tsx`
- `frontend/src/components/ask/StoryReportView.tsx`
- `frontend/src/lib/story/exportCanvas.ts`
- Test files alongside each.

Modified:
- `frontend/src/components/ask/ChatMessage.tsx` (Pin button)
- `frontend/src/pages/AskAiPage.tsx` (provider + Story toggle + export flow)
