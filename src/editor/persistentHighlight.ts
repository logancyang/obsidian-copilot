import { StateEffect, StateEffectType, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";

export interface PersistentHighlightRange {
  from: number;
  to: number;
}

export interface PersistentHighlightInstance {
  readonly field: StateField<PersistentHighlightRange | null>;
  readonly effect: StateEffectType<PersistentHighlightRange | null>;
  readonly extension: Extension;

  show(view: EditorView, from: number, to: number): void;

  hide(view: EditorView): void;

  buildEffects(
    view: EditorView,
    range: { from: number; to: number } | null
  ): StateEffect<unknown>[];

  getRange(view: EditorView): PersistentHighlightRange | null;
}

export function createPersistentHighlight(className: string): PersistentHighlightInstance {
  const setEffect = StateEffect.define<PersistentHighlightRange | null>();

  const mark = Decoration.mark({ class: className });

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

  const field = StateField.define<PersistentHighlightRange | null>({
    create: () => null,

    update(value, tr) {
      let next = value;

      if (next && !tr.changes.empty) {
        const mappedFrom = tr.changes.mapPos(next.from, 1);
        const mappedTo = tr.changes.mapPos(next.to, -1);
        next = normalizeRange(tr.state.doc.length, mappedFrom, mappedTo);
      }

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

  const theme = EditorView.baseTheme({
    [`.${className}`]: {
      backgroundColor: "var(--text-selection)",
      borderRadius: "2px",
    },
  });

  const extension: Extension = [field, theme];

  function isInstalled(view: EditorView): boolean {
    return view.state.field(field, false) !== undefined;
  }

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

  function show(view: EditorView, from: number, to: number): void {
    const effects = buildEffects(view, { from, to });
    if (effects.length > 0) {
      view.dispatch({ effects });
    }
  }

  function hide(view: EditorView): void {
    const effects = buildEffects(view, null);
    if (effects.length > 0) {
      view.dispatch({ effects });
    }
  }

  function getRange(view: EditorView): PersistentHighlightRange | null {
    return view.state.field(field, false) ?? null;
  }

  return { field, effect: setEffect, extension, show, hide, buildEffects, getRange };
}
