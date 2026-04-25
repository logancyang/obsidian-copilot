/**
 * persistentMultiHighlight.ts
 *
 * CM6 primitive factory for managing MANY persistent highlight ranges keyed by id.
 * Each call produces isolated StateField / StateEffect instances. Ranges remap
 * automatically through document edits via `tr.changes.mapPos` and collapse/drop
 * when their text is deleted.
 *
 * Parallels `persistentHighlight.ts` but tracks a Map<id, Range> instead of a
 * single range, and supports a per-entry "focused" flag so callers can style
 * the currently-open range differently.
 */

import { StateEffect, StateEffectType, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";

export interface MultiHighlightEntry {
  from: number;
  to: number;
  focused: boolean;
}

export type MultiHighlightMap = ReadonlyMap<string, MultiHighlightEntry>;

export interface MultiHighlightAddPayload {
  id: string;
  from: number;
  to: number;
  focused?: boolean;
}

export interface MultiHighlightFocusPayload {
  /** Pass null to clear focus from all entries. */
  id: string | null;
}

export interface PersistentMultiHighlightInstance {
  readonly field: StateField<MultiHighlightMap>;
  readonly addEffect: StateEffectType<MultiHighlightAddPayload>;
  readonly removeEffect: StateEffectType<string>;
  readonly focusEffect: StateEffectType<MultiHighlightFocusPayload>;
  readonly orphanedEffect: StateEffectType<string>;
  readonly extension: Extension;

  add(view: EditorView, payload: MultiHighlightAddPayload): void;
  remove(view: EditorView, id: string): void;
  focus(view: EditorView, id: string | null): void;
  get(view: EditorView, id: string): MultiHighlightEntry | null;
  getAll(view: EditorView): MultiHighlightMap;
  findByPos(view: EditorView, pos: number): { id: string; entry: MultiHighlightEntry } | null;

  /**
   * Register a listener for "range collapsed due to edits" events. The listener
   * fires in response to orphanedEffect dispatches (the field emits them via the
   * returned extension's updateListener). Returns an unsubscribe function.
   */
  onOrphaned(listener: (id: string) => void): () => void;
}

/**
 * Create an isolated multi-range highlight instance.
 *
 * @param className - CSS class applied to every range
 * @param focusedClassName - additional class applied to the focused range
 */
export function createPersistentMultiHighlight(
  className: string,
  focusedClassName: string
): PersistentMultiHighlightInstance {
  const addEffect = StateEffect.define<MultiHighlightAddPayload>();
  const removeEffect = StateEffect.define<string>();
  const focusEffect = StateEffect.define<MultiHighlightFocusPayload>();
  const orphanedEffect = StateEffect.define<string>();

  const baseMark = Decoration.mark({ class: className });
  const focusedMark = Decoration.mark({ class: `${className} ${focusedClassName}` });

  const orphanedListeners = new Set<(id: string) => void>();

  function clamp(docLength: number, from: number, to: number): { from: number; to: number } | null {
    const f = Math.max(0, Math.min(from, docLength));
    const t = Math.max(0, Math.min(to, docLength));
    if (f === t) return null;
    return { from: Math.min(f, t), to: Math.max(f, t) };
  }

  const field = StateField.define<MultiHighlightMap>({
    create: () => new Map(),

    update(value, tr) {
      let next: Map<string, MultiHighlightEntry> | null = null;
      const orphansToEmit: string[] = [];

      // Remap through document changes.
      if (!tr.changes.empty && value.size > 0) {
        next = new Map();
        for (const [id, entry] of value) {
          const mappedFrom = tr.changes.mapPos(entry.from, 1);
          const mappedTo = tr.changes.mapPos(entry.to, -1);
          const clamped = clamp(tr.state.doc.length, mappedFrom, mappedTo);
          if (!clamped) {
            orphansToEmit.push(id);
            continue;
          }
          next.set(id, { from: clamped.from, to: clamped.to, focused: entry.focused });
        }
      }

      // Apply effects.
      for (const effect of tr.effects) {
        if (effect.is(addEffect)) {
          const { id, from, to, focused = false } = effect.value;
          const clamped = clamp(tr.state.doc.length, from, to);
          if (!clamped) continue;
          if (!next) next = new Map(value);
          next.set(id, { from: clamped.from, to: clamped.to, focused });
        } else if (effect.is(removeEffect)) {
          if (!next) next = new Map(value);
          next.delete(effect.value);
        } else if (effect.is(focusEffect)) {
          if (!next) next = new Map(value);
          const targetId = effect.value.id;
          for (const [id, entry] of next) {
            const shouldFocus = targetId === id;
            if (entry.focused !== shouldFocus) {
              next.set(id, { ...entry, focused: shouldFocus });
            }
          }
        }
      }

      // Orphan events are deferred until the transaction settles. We pipe them
      // through the orphanedEffect by scheduling them on the next microtask —
      // `update` must not dispatch. Listeners get notified via the update
      // listener below.
      if (orphansToEmit.length > 0) {
        queueMicrotask(() => {
          for (const id of orphansToEmit) {
            for (const listener of orphanedListeners) listener(id);
          }
        });
      }

      return next ?? value;
    },

    provide: (f) =>
      EditorView.decorations.from(f, (map) => {
        if (map.size === 0) return Decoration.none;
        const ranges: Array<ReturnType<typeof baseMark.range>> = [];
        const entries = Array.from(map.values()).sort((a, b) => a.from - b.from);
        for (const entry of entries) {
          const mark = entry.focused ? focusedMark : baseMark;
          ranges.push(mark.range(entry.from, entry.to));
        }
        return Decoration.set(ranges);
      }),
  });

  const extension: Extension = [field];

  function isInstalled(view: EditorView): boolean {
    return view.state.field(field, false) !== undefined;
  }

  function ensureInstalled(view: EditorView): StateEffect<unknown>[] {
    return isInstalled(view) ? [] : [StateEffect.appendConfig.of(extension)];
  }

  function add(view: EditorView, payload: MultiHighlightAddPayload): void {
    view.dispatch({ effects: [...ensureInstalled(view), addEffect.of(payload)] });
  }

  function remove(view: EditorView, id: string): void {
    if (!isInstalled(view)) return;
    view.dispatch({ effects: [removeEffect.of(id)] });
  }

  function focus(view: EditorView, id: string | null): void {
    if (!isInstalled(view)) return;
    view.dispatch({ effects: [focusEffect.of({ id })] });
  }

  function get(view: EditorView, id: string): MultiHighlightEntry | null {
    const map = view.state.field(field, false);
    if (!map) return null;
    return map.get(id) ?? null;
  }

  function getAll(view: EditorView): MultiHighlightMap {
    return view.state.field(field, false) ?? new Map();
  }

  function findByPos(
    view: EditorView,
    pos: number
  ): { id: string; entry: MultiHighlightEntry } | null {
    const map = view.state.field(field, false);
    if (!map) return null;
    for (const [id, entry] of map) {
      if (pos >= entry.from && pos <= entry.to) {
        return { id, entry };
      }
    }
    return null;
  }

  function onOrphaned(listener: (id: string) => void): () => void {
    orphanedListeners.add(listener);
    return () => {
      orphanedListeners.delete(listener);
    };
  }

  return {
    field,
    addEffect,
    removeEffect,
    focusEffect,
    orphanedEffect,
    extension,
    add,
    remove,
    focus,
    get,
    getAll,
    findByPos,
    onOrphaned,
  };
}
