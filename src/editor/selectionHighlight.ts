import { StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { logError } from "@/logger";
import {
  createPersistentHighlight,
  type PersistentHighlightRange,
} from "@/editor/persistentHighlight";

const selectionHighlight = createPersistentHighlight("copilot-selection-highlight");

type SelectionHighlightRange = PersistentHighlightRange;

function safeDispatch(view: EditorView, spec: Parameters<EditorView["dispatch"]>[0]): void {
  try {
    view.dispatch(spec);
  } catch (error) {
    logError("SelectionHighlight dispatch failed:", error);
  }
}

function buildSelectionHighlightEffects(
  view: EditorView,
  range: { from: number; to: number } | null
): StateEffect<unknown>[] {
  return selectionHighlight.buildEffects(view, range);
}

function showSelectionHighlight(view: EditorView, from: number, to: number): void {
  const effects = selectionHighlight.buildEffects(view, { from, to });
  if (effects.length > 0) {
    safeDispatch(view, { effects });
  }
}

function updateSelectionHighlight(view: EditorView, from: number, to: number): void {
  showSelectionHighlight(view, from, to);
}

function hideSelectionHighlight(view: EditorView): void {
  const effects = selectionHighlight.buildEffects(view, null);
  if (effects.length > 0) {
    safeDispatch(view, { effects });
  }
}

function getSelectionHighlightRange(view: EditorView): SelectionHighlightRange | null {
  return selectionHighlight.getRange(view);
}

export const SelectionHighlight = {
  show: showSelectionHighlight,
  update: updateSelectionHighlight,
  hide: hideSelectionHighlight,
  getRange: getSelectionHighlightRange,
  buildEffects: buildSelectionHighlightEffects,
} as const;
