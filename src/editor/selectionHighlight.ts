/**
 * SelectionHighlight - Persistent selection highlight using CM6 Decoration.
 *
 * Provides a way to keep selection visible even when editor loses focus.
 * Automatically tracks document changes using mapPos.
 */

import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { logError } from "@/logger";

/**
 * A persistent highlight range in CM6 document offsets.
 */
export interface SelectionHighlightRange {
  from: number;
  to: number;
}

/**
 * Effect used to set or clear the persistent selection highlight.
 * - `null` means "hide".
 * - `{from,to}` means "show/update".
 */
const setSelectionHighlightEffect = StateEffect.define<SelectionHighlightRange | null>();

/**
 * Mark decoration used to render the persistent highlight.
 */
const selectionHighlightMark = Decoration.mark({ class: "copilot-selection-highlight" });

/**
 * Normalize and clamp a range to the current document.
 * Returns null when the range is empty or invalid after normalization.
 */
function normalizeRange(
  docLength: number,
  from: number,
  to: number
): SelectionHighlightRange | null {
  const clampedFrom = Math.max(0, Math.min(from, docLength));
  const clampedTo = Math.max(0, Math.min(to, docLength));
  if (clampedFrom === clampedTo) return null;
  return {
    from: Math.min(clampedFrom, clampedTo),
    to: Math.max(clampedFrom, clampedTo),
  };
}

/**
 * Build decorations for the given highlight range.
 */
function buildDecorations(range: SelectionHighlightRange) {
  return Decoration.set([selectionHighlightMark.range(range.from, range.to)]);
}

/**
 * StateField that stores a single persistent highlight range.
 * - On doc changes: maps the range using `mapPos`.
 * - On effects: updates/clears the range.
 * - Provides decorations via `EditorView.decorations`.
 */
const selectionHighlightField = StateField.define<SelectionHighlightRange | null>({
  /**
   * Initializes with no highlight.
   */
  create(): SelectionHighlightRange | null {
    return null;
  },

  /**
   * Updates highlight state:
   * - Maps existing range through document changes
   * - Applies set/clear effects
   */
  update(value: SelectionHighlightRange | null, tr): SelectionHighlightRange | null {
    let next: SelectionHighlightRange | null = value;

    // 1) Map existing range through doc changes.
    if (next && !tr.changes.empty) {
      const mappedFrom = tr.changes.mapPos(next.from, 1);
      const mappedTo = tr.changes.mapPos(next.to, -1);
      next = normalizeRange(tr.state.doc.length, mappedFrom, mappedTo);
    }

    // 2) Apply explicit effects (set/clear).
    for (const effect of tr.effects) {
      if (!effect.is(setSelectionHighlightEffect)) continue;
      if (!effect.value) {
        next = null;
        continue;
      }
      next = normalizeRange(tr.state.doc.length, effect.value.from, effect.value.to);
    }

    return next;
  },

  /**
   * Exposes mark decorations derived from the current range.
   */
  provide: (field) =>
    EditorView.decorations.from(field, (range) => {
      if (!range) return Decoration.none;
      return buildDecorations(range);
    }),
});

/**
 * Minimal default theme for the highlight.
 * You can override this in your plugin CSS if desired.
 */
const selectionHighlightTheme = EditorView.baseTheme({
  ".copilot-selection-highlight": {
    backgroundColor: "var(--text-selection)",
    borderRadius: "2px",
  },
});

/**
 * Extension that enables persistent selection highlight support.
 */
export const selectionHighlightExtension: Extension = [
  selectionHighlightField,
  selectionHighlightTheme,
];

/**
 * Returns true when the selection highlight field is installed in the view.
 */
function isInstalled(view: EditorView): boolean {
  return view.state.field(selectionHighlightField, false) !== undefined;
}

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
  const effects: StateEffect<unknown>[] = [];

  if (!range) {
    // Hide: only add effect if extension is installed
    if (isInstalled(view)) {
      effects.push(setSelectionHighlightEffect.of(null));
    }
    return effects;
  }

  // Show: normalize and build effects
  const normalized = normalizeRange(view.state.doc.length, range.from, range.to);
  if (!normalized) {
    // Invalid range, treat as hide
    if (isInstalled(view)) {
      effects.push(setSelectionHighlightEffect.of(null));
    }
    return effects;
  }

  if (!isInstalled(view)) {
    effects.push(StateEffect.appendConfig.of(selectionHighlightExtension));
  }
  effects.push(setSelectionHighlightEffect.of(normalized));

  return effects;
}

/**
 * Show a persistent highlight in `view` for [from, to].
 * Automatically installs the extension in this view if missing.
 */
export function showSelectionHighlight(view: EditorView, from: number, to: number): void {
  const effects = buildSelectionHighlightEffects(view, { from, to });
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
  const effects = buildSelectionHighlightEffects(view, null);
  if (effects.length > 0) {
    safeDispatch(view, { effects });
  }
}

/**
 * Get the current persistent highlight range in `view` after mapping through document changes.
 * Returns null when the extension isn't installed or the highlight is hidden.
 */
export function getSelectionHighlightRange(view: EditorView): SelectionHighlightRange | null {
  const range = view.state.field(selectionHighlightField, false);
  return range ?? null;
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
