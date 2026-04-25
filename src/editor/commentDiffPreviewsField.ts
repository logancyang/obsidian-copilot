/**
 * commentDiffPreviewsField.ts
 *
 * CM6 StateField that tracks pending inline diff previews for comment
 * suggested-edits. When a preview is active for a comment, its highlighted
 * range is replaced (visually) by an `InlineDiffWidget` showing the word-level
 * diff and Accept/Reject controls.
 *
 * The field auto-remaps ranges through document edits and invalidates a preview
 * if the underlying text no longer matches the captured original.
 */

import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { InlineDiffWidget } from "./inlineDiffWidget";
import type { InlineDiffCallbacks } from "@/components/comments/InlineDiffCard";

export interface PreviewEntry {
  commentId: string;
  from: number;
  to: number;
  originalText: string;
  proposedText: string;
  callbacks: InlineDiffCallbacks;
}

export const setPreviewEffect = StateEffect.define<PreviewEntry>();
export const clearPreviewEffect = StateEffect.define<string>();

type PreviewMap = ReadonlyMap<string, PreviewEntry>;

const invalidationListeners = new Set<(commentId: string) => void>();

export function onPreviewInvalidated(listener: (commentId: string) => void): () => void {
  invalidationListeners.add(listener);
  return () => {
    invalidationListeners.delete(listener);
  };
}

export const commentDiffPreviewsField = StateField.define<PreviewMap>({
  create: () => new Map(),

  update(value, tr) {
    // Pre-scan effects so a same-transaction clear/set suppresses invalidation
    // (e.g., when Accept dispatches both the replacement change and a clear).
    const clearedIds = new Set<string>();
    const setEntries: PreviewEntry[] = [];
    for (const effect of tr.effects) {
      if (effect.is(clearPreviewEffect)) clearedIds.add(effect.value);
      else if (effect.is(setPreviewEffect)) setEntries.push(effect.value);
    }
    const suppressInvalidation = (id: string) =>
      clearedIds.has(id) || setEntries.some((e) => e.commentId === id);

    let next: Map<string, PreviewEntry> | null = null;
    const invalidated: string[] = [];

    if (!tr.changes.empty && value.size > 0) {
      next = new Map();
      for (const [id, entry] of value) {
        const mappedFrom = tr.changes.mapPos(entry.from, 1);
        const mappedTo = tr.changes.mapPos(entry.to, -1);
        if (mappedFrom >= mappedTo) {
          if (!suppressInvalidation(id)) invalidated.push(id);
          continue;
        }
        const currentText = tr.state.doc.sliceString(mappedFrom, mappedTo);
        if (currentText !== entry.originalText) {
          if (!suppressInvalidation(id)) invalidated.push(id);
          continue;
        }
        next.set(id, { ...entry, from: mappedFrom, to: mappedTo });
      }
    }

    if (clearedIds.size > 0 || setEntries.length > 0) {
      if (!next) next = new Map(value);
      for (const id of clearedIds) next.delete(id);
      for (const entry of setEntries) next.set(entry.commentId, entry);
    }

    if (invalidated.length > 0) {
      queueMicrotask(() => {
        for (const id of invalidated) {
          for (const listener of invalidationListeners) listener(id);
        }
      });
    }

    return next ?? value;
  },

  provide: (f) =>
    EditorView.decorations.from(f, (map) => {
      if (map.size === 0) return Decoration.none;
      const ranges = Array.from(map.values())
        .sort((a, b) => a.from - b.from)
        .map((entry) =>
          Decoration.replace({
            widget: new InlineDiffWidget({
              commentId: entry.commentId,
              originalText: entry.originalText,
              proposedText: entry.proposedText,
              callbacks: entry.callbacks,
            }),
          }).range(entry.from, entry.to)
        );
      return Decoration.set(ranges);
    }),
});

export const commentDiffPreviewsExtension: Extension = [commentDiffPreviewsField];
