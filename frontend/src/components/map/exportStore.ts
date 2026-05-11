/**
 * Module-scoped store for the data-export side panel. Both DataExportPanel
 * (which owns the format selection + scope display) and DataExportPanelFooter
 * (which owns the trigger button) need to read the same state — they're
 * rendered in different sub-trees of MapPage, so we share state via a
 * `useSyncExternalStore` subscription rather than props.
 *
 * The store stays a tiny mutable object on purpose — no Redux, no Zustand,
 * no React context. Two consumers, scoped to one panel.
 */

import { useSyncExternalStore } from "react";

export type FormatKey = "csv" | "pdf" | "png";

export type ExportPhase =
  | { kind: "idle" }
  | { kind: "running"; format: FormatKey; message: string; progress?: number }
  | { kind: "error"; format: FormatKey; message: string }
  | { kind: "success"; format: FormatKey };

export interface ExportState {
  activeFormat: FormatKey;
  phase: ExportPhase;
}

const initial: ExportState = {
  activeFormat: "csv",
  phase: { kind: "idle" },
};

let state: ExportState = initial;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ExportState {
  return state;
}

export function setActiveFormat(format: FormatKey) {
  if (state.activeFormat === format) return;
  state = { ...state, activeFormat: format };
  emit();
}

export function startExport(format: FormatKey, message: string) {
  state = { ...state, phase: { kind: "running", format, message } };
  emit();
}

export function updateProgress(format: FormatKey, message: string, progress?: number) {
  // Ignore stale progress events from a cancelled/superseded export.
  if (state.phase.kind !== "running" || state.phase.format !== format) return;
  state = { ...state, phase: { kind: "running", format, message, progress } };
  emit();
}

export function finishExport(format: FormatKey) {
  state = { ...state, phase: { kind: "success", format } };
  emit();
}

export function failExport(format: FormatKey, message: string) {
  state = { ...state, phase: { kind: "error", format, message } };
  emit();
}

export function resetExport() {
  state = { ...state, phase: { kind: "idle" } };
  emit();
}

export function useExportState(): ExportState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
