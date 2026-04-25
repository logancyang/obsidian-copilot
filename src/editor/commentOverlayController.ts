/**
 * CommentOverlayController - orchestrates the inline comment overlay lifecycle.
 *
 * Responsibilities:
 *   - Open/close the overlay for a given (view, commentId)
 *   - Wire the focused-highlight effect so the active comment is styled
 *   - Dispatch mount effects into the ViewPlugin via `commentOverlayEffect`
 *
 * This does NOT own the comment store or anchor resolution — those live in
 * `CommentsController`. This class is the thin bridge between store mutations
 * and the CM6 extension.
 */

import { EditorView } from "@codemirror/view";
import { logWarn } from "@/logger";
import type { Comment } from "@/comments/types";
import { commentHighlights } from "./commentHighlights";
import { commentOverlayEffect } from "./commentOverlayExtension";
import type { CommentThreadPanelOptions } from "@/components/comments/types";

interface OpenOptions {
  view: EditorView;
  comment: Comment;
  notePath: string;
  panelOptions: Omit<CommentThreadPanelOptions, "view" | "onClose">;
}

export class CommentOverlayController {
  private openView: EditorView | null = null;
  private openCommentId: string | null = null;

  open(opts: OpenOptions): void {
    this.close();
    const { view, comment, notePath, panelOptions } = opts;
    const entry = commentHighlights.get(view, comment.id);
    if (!entry) {
      logWarn(`CommentOverlayController: no highlight found for comment ${comment.id}`);
      return;
    }

    try {
      commentHighlights.focus(view, comment.id);
      view.dispatch({
        effects: commentOverlayEffect.of({
          anchorPos: entry.to,
          options: {
            ...panelOptions,
            view,
            notePath,
            onClose: () => this.close(),
          },
        }),
      });
      this.openView = view;
      this.openCommentId = comment.id;
    } catch (error) {
      logWarn("CommentOverlayController: open failed", error);
    }
  }

  close(): void {
    const view = this.openView;
    if (!view) return;
    try {
      commentHighlights.focus(view, null);
      view.dispatch({ effects: commentOverlayEffect.of(null) });
    } catch (error) {
      logWarn("CommentOverlayController: close failed", error);
    }
    this.openView = null;
    this.openCommentId = null;
  }

  isOpen(): boolean {
    return this.openCommentId !== null;
  }

  getOpenCommentId(): string | null {
    return this.openCommentId;
  }

  getOpenView(): EditorView | null {
    return this.openView;
  }
}
