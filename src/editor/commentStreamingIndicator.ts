/**
 * commentStreamingIndicator.ts
 *
 * CM6 extension that renders a pulsing dot at the end of a comment's
 * highlighted range while that comment's agent session is streaming.
 *
 * The field stores a Set<commentId> of streaming comments. Decorations are
 * computed from this field + `commentHighlights.field`, so the dot tracks
 * the highlight's current position through edits.
 */
import { type Range, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { commentHighlights } from "./commentHighlights";

export const COMMENT_STREAMING_DOT_CLASS = "copilot-comment-streaming-dot";

export const setCommentStreamingEffect = StateEffect.define<{ id: string; streaming: boolean }>();

export const clearAllCommentStreamingEffect = StateEffect.define<void>();

class StreamingDotWidget extends WidgetType {
  constructor(private readonly commentId: string) {
    super();
  }

  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = COMMENT_STREAMING_DOT_CLASS;
    el.setAttribute("aria-hidden", "true");
    el.dataset.commentId = this.commentId;
    return el;
  }

  eq(other: WidgetType): boolean {
    return other instanceof StreamingDotWidget && other.commentId === this.commentId;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

const streamingIdsField = StateField.define<ReadonlySet<string>>({
  create: () => new Set<string>(),
  update(value, tr) {
    let next: Set<string> | null = null;
    for (const effect of tr.effects) {
      if (effect.is(setCommentStreamingEffect)) {
        const { id, streaming } = effect.value;
        const currentlyStreaming = value.has(id);
        if (streaming === currentlyStreaming) continue;
        if (!next) next = new Set(value);
        if (streaming) next.add(id);
        else next.delete(id);
      } else if (effect.is(clearAllCommentStreamingEffect)) {
        if (value.size > 0) next = new Set();
      }
    }
    return next ?? value;
  },
});

export const commentStreamingIndicator: Extension = [
  streamingIdsField,
  EditorView.decorations.compute([streamingIdsField, commentHighlights.field], (state) => {
    const streamingIds = state.field(streamingIdsField, false);
    const highlights = state.field(commentHighlights.field, false);
    if (!streamingIds || !highlights || streamingIds.size === 0) return Decoration.none;
    const entries: Array<{ id: string; to: number }> = [];
    for (const id of streamingIds) {
      const entry = highlights.get(id);
      if (!entry) continue;
      entries.push({ id, to: entry.to });
    }
    entries.sort((a, b) => a.to - b.to);
    const ranges: Range<Decoration>[] = entries.map(({ id, to }) =>
      Decoration.widget({ widget: new StreamingDotWidget(id), side: 1 }).range(to)
    );
    return Decoration.set(ranges);
  }),
];

export function setCommentStreaming(view: EditorView, id: string, streaming: boolean): void {
  view.dispatch({ effects: setCommentStreamingEffect.of({ id, streaming }) });
}

export function clearAllCommentStreaming(view: EditorView): void {
  view.dispatch({ effects: clearAllCommentStreamingEffect.of() });
}
