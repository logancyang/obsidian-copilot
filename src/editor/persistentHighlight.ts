/**
 * persistentHighlight.ts
 *
 * Generic CM6 primitive factory for a single persistent highlight range.
 * Each call to `createPersistentHighlight` returns fully isolated
 * StateField / StateEffect instances, so multiple highlight systems
 * (e.g. QuickAsk and Chat) can coexist without state conflicts.
 */

import { StateEffect, StateEffectType, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";

// ============================================================================
// Types
// ============================================================================

/**
 * A persistent highlight range in CM6 document offsets.
 */
export interface PersistentHighlightRange {
  from: number;
  to: number;
}

/**
 * The public API surface returned by `createPersistentHighlight`.
 */
export interface PersistentHighlightInstance {
  /** The CM6 StateField storing the current highlight range. */
  readonly field: StateField<PersistentHighlightRange | null>;
  /** The CM6 StateEffectType used to set/clear the highlight. */
  readonly effect: StateEffectType<PersistentHighlightRange | null>;
  /** The CM6 extension bundle (field + baseTheme) to install into a view. */
  readonly extension: Extension;

  /**
   * Show or update the persistent highlight.
   * Automatically installs the extension on first use.
   * @throws If the EditorView is destroyed (callers should catch as needed).
   */
  show(view: EditorView, from: number, to: number): void;

  /**
   * Hide (clear) the persistent highlight.
   * No-op if the extension is not installed.
   * @throws If the EditorView is destroyed (callers should catch as needed).
   */
  hide(view: EditorView): void;

  /**
   * Build effects without dispatching.
   * Useful for batching multiple effects into a single `view.dispatch()`.
   */
  buildEffects(
    view: EditorView,
    range: { from: number; to: number } | null
  ): StateEffect<unknown>[];

  /**
   * Read the current highlight range.
   * Returns null when the extension is not installed or the highlight is hidden.
   */
  getRange(view: EditorView): PersistentHighlightRange | null;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an isolated persistent-highlight instance bound to a CSS class.
 *
 * Each call produces independent StateField/StateEffect objects so that
 * multiple highlight systems can coexist in the same EditorView without
 * interfering with each other.
 *
 * @param className - CSS class applied to the mark decoration and baseTheme rule
 * @returns Isolated highlight primitives and helpers
 */
export function createPersistentHighlight(className: string): PersistentHighlightInstance {
  // -- Effect -----------------------------------------------------------------

  const setEffect = StateEffect.define<PersistentHighlightRange | null>();

  // -- Decoration -------------------------------------------------------------

  const mark = Decoration.mark({ class: className });

  // -- Helpers ----------------------------------------------------------------

  /**
   * Normalize and clamp a range to the current document.
   * Returns null when the range is empty or fully out of bounds.
   */
  function normalizeRange(
    docLength: number,
    from: number,
    to: number
  ): PersistentHighlightRange | null {
    const clampedFrom = Math.max(0, Math.min(from, docLength));
    const clampedTo = Math.max(0, Math.min(to, docLength));
    if (clampedFrom === clampedTo) return null;
    return {
      from: Math.min(clampedFrom, clampedTo),
      to: Math.max(clampedFrom, clampedTo),
    };
  }

  // -- StateField -------------------------------------------------------------

  const field = StateField.define<PersistentHighlightRange | null>({
    create: () => null,

    update(value, tr) {
      let next = value;

      // Remap existing range through document changes
      if (next && !tr.changes.empty) {
        const mappedFrom = tr.changes.mapPos(next.from, 1);
        const mappedTo = tr.changes.mapPos(next.to, -1);
        next = normalizeRange(tr.state.doc.length, mappedFrom, mappedTo);
      }

      // Apply set/clear effects
      for (const effect of tr.effects) {
        if (!effect.is(setEffect)) continue;
        next = effect.value
          ? normalizeRange(tr.state.doc.length, effect.value.from, effect.value.to)
          : null;
      }

      return next;
    },

    provide: (f) =>
      EditorView.decorations.from(f, (range) =>
        range ? Decoration.set([mark.range(range.from, range.to)]) : Decoration.none
      ),
  });

  // -- Theme ------------------------------------------------------------------

  const theme = EditorView.baseTheme({
    [`.${className}`]: {
      backgroundColor: "var(--text-selection)",
      borderRadius: "2px",
    },
  });

  // -- Extension bundle -------------------------------------------------------

  const extension: Extension = [field, theme];

  // -- Utilities --------------------------------------------------------------

  /** Whether the field is installed in a given view. */
  function isInstalled(view: EditorView): boolean {
    return view.state.field(field, false) !== undefined;
  }

  /**
   * Build effects for showing/hiding highlight without dispatching.
   * Returns an empty array when there is nothing to do.
   */
  function buildEffects(
    view: EditorView,
    range: { from: number; to: number } | null
  ): StateEffect<unknown>[] {
    const effects: StateEffect<unknown>[] = [];

    if (!range) {
      if (isInstalled(view)) {
        effects.push(setEffect.of(null));
      }
      return effects;
    }

    const normalized = normalizeRange(view.state.doc.length, range.from, range.to);
    if (!normalized) {
      // Invalid range — treat as "hide"
      if (isInstalled(view)) {
        effects.push(setEffect.of(null));
      }
      return effects;
    }

    if (!isInstalled(view)) {
      effects.push(StateEffect.appendConfig.of(extension));
    }
    effects.push(setEffect.of(normalized));
    return effects;
  }

  /**
   * Dispatch a show. Throws on destroyed views — callers decide how to log.
   */
  function show(view: EditorView, from: number, to: number): void {
    const effects = buildEffects(view, { from, to });
    if (effects.length > 0) {
      view.dispatch({ effects });
    }
  }

  /**
   * Dispatch a hide. Throws on destroyed views — callers decide how to log.
   */
  function hide(view: EditorView): void {
    const effects = buildEffects(view, null);
    if (effects.length > 0) {
      view.dispatch({ effects });
    }
  }

  /** Read the current highlight range (null = not installed / hidden). */
  function getRange(view: EditorView): PersistentHighlightRange | null {
    return view.state.field(field, false) ?? null;
  }

  return { field, effect: setEffect, extension, show, hide, buildEffects, getRange };
}
