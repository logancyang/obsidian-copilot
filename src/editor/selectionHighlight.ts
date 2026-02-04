/**
 * SelectionHighlight - Persistent selection highlight using CM6 Decoration.
 *
 * Provides a way to keep selection visible even when editor loses focus.
 * Automatically tracks document changes using mapPos.
 *
 * This module is a thin wrapper around the generic `createPersistentHighlight`
 * factory, preserving the original public API for backwards compatibility.
 */

import { StateEffect, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { logError } from "@/logger";
import {
  createPersistentHighlight,
  type PersistentHighlightRange,
} from "@/editor/persistentHighlight";

// ============================================================================
// Instance (isolated from Chat highlight)
// ============================================================================

const selectionHighlight = createPersistentHighlight("copilot-selection-highlight");

// ============================================================================
// Public Types
// ============================================================================

/**
 * A persistent highlight range in CM6 document offsets.
 * Re-exported for backwards compatibility.
 */
export type SelectionHighlightRange = PersistentHighlightRange;

// ============================================================================
// Public API (backwards-compatible)
// ============================================================================

/**
 * Extension that enables persistent selection highlight support.
 */
export const selectionHighlightExtension: Extension = selectionHighlight.extension;

/**
 * Dispatch helper with error isolation (e.g. view destroyed).
 */
function safeDispatch(view: EditorView, spec: Parameters<EditorView["dispatch"]>[0]): void {
  try {
    view.dispatch(spec);
  } catch (error) {
    logError("SelectionHighlight dispatch failed:", error);
  }
}

/**
 * Build effects for showing/hiding selection highlight without dispatching.
 * Use this when you need to combine highlight effects with other effects in a single dispatch.
 * @param view - The EditorView
 * @param range - The range to highlight, or null to hide
 * @returns Array of StateEffects to include in a dispatch call
 */
export function buildSelectionHighlightEffects(
  view: EditorView,
  range: { from: number; to: number } | null
): StateEffect<unknown>[] {
  return selectionHighlight.buildEffects(view, range);
}

/**
 * Show a persistent highlight in `view` for [from, to].
 * Automatically installs the extension in this view if missing.
 */
export function showSelectionHighlight(view: EditorView, from: number, to: number): void {
  const effects = selectionHighlight.buildEffects(view, { from, to });
  if (effects.length > 0) {
    safeDispatch(view, { effects });
  }
}

/**
 * Update the persistent highlight in `view` to [from, to].
 * Alias of `showSelectionHighlight` (semantic clarity).
 */
export function updateSelectionHighlight(view: EditorView, from: number, to: number): void {
  showSelectionHighlight(view, from, to);
}

/**
 * Hide (clear) the persistent highlight in `view`.
 * Does NOT install the extension if missing.
 */
export function hideSelectionHighlight(view: EditorView): void {
  const effects = selectionHighlight.buildEffects(view, null);
  if (effects.length > 0) {
    safeDispatch(view, { effects });
  }
}

/**
 * Get the current persistent highlight range in `view` after mapping through document changes.
 * Returns null when the extension isn't installed or the highlight is hidden.
 */
export function getSelectionHighlightRange(view: EditorView): SelectionHighlightRange | null {
  return selectionHighlight.getRange(view);
}

/**
 * Convenience object API:
 * - `SelectionHighlight.show(view, from, to)`
 * - `SelectionHighlight.update(view, from, to)`
 * - `SelectionHighlight.hide(view)`
 * - `SelectionHighlight.getRange(view)`
 * - `SelectionHighlight.buildEffects(view, range)` - Build effects without dispatching
 */
export const SelectionHighlight = {
  show: showSelectionHighlight,
  update: updateSelectionHighlight,
  hide: hideSelectionHighlight,
  getRange: getSelectionHighlightRange,
  buildEffects: buildSelectionHighlightEffects,
} as const;
