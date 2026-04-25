/**
 * commentHighlights.ts
 *
 * The singleton multi-range highlight instance used by the inline comments
 * feature. CSS classes are styled in `src/styles/tailwind.css`.
 */

import { EditorView } from "@codemirror/view";
import {
  createPersistentMultiHighlight,
  type PersistentMultiHighlightInstance,
} from "./persistentMultiHighlight";

export const COMMENT_HIGHLIGHT_CLASS = "copilot-comment-highlight";
export const COMMENT_HIGHLIGHT_FOCUSED_CLASS = "copilot-comment-highlight-focused";

export const commentHighlights: PersistentMultiHighlightInstance = createPersistentMultiHighlight(
  COMMENT_HIGHLIGHT_CLASS,
  COMMENT_HIGHLIGHT_FOCUSED_CLASS
);

/** Convenience wrapper for adding a highlight. */
export function addCommentHighlight(
  view: EditorView,
  id: string,
  from: number,
  to: number,
  focused = false
): void {
  commentHighlights.add(view, { id, from, to, focused });
}
