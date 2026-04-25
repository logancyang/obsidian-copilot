/**
 * CM6 extension for the inline Copilot comment overlay.
 *
 * Exposes a `commentOverlayEffect` that opens/closes the thread popover, and a
 * `commentOverlayPlugin` that (a) manages the overlay's lifecycle and (b)
 * listens for mousedown on any highlighted range to reopen its thread.
 *
 * Patterned on `src/editor/quickAskExtension.ts` but simpler: no drag/resize,
 * no dual-anchor flipping, one overlay at a time per view.
 */

import { StateEffect } from "@codemirror/state";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { CommentThreadOverlay } from "@/components/comments/CommentThreadOverlay";
import type { CommentOverlayPayload } from "@/components/comments/types";
import { commentHighlights } from "./commentHighlights";

/**
 * Show (payload) or close (null) the comment overlay for the containing view.
 */
export const commentOverlayEffect = StateEffect.define<CommentOverlayPayload | null>();

export const commentOverlayPlugin = ViewPlugin.fromClass(
  class {
    private overlay: CommentThreadOverlay | null = null;
    private anchorPos: number | null = null;

    constructor(private readonly view: EditorView) {}

    update(update: ViewUpdate): void {
      for (const tr of update.transactions) {
        for (const effect of tr.effects) {
          if (!effect.is(commentOverlayEffect)) continue;
          const payload = effect.value;
          if (!payload) {
            this.overlay?.destroy();
            this.overlay = null;
            this.anchorPos = null;
            continue;
          }
          this.overlay?.destroy();
          this.anchorPos = payload.anchorPos;
          this.overlay = new CommentThreadOverlay(payload.options);
          this.overlay.mount(this.view, payload.anchorPos);
        }
      }

      // Remap anchor through document changes and reposition.
      if (this.overlay && this.anchorPos !== null) {
        if (update.docChanged) {
          this.anchorPos = update.changes.mapPos(this.anchorPos, 1);
        }
        if (update.docChanged || update.geometryChanged || update.viewportChanged) {
          this.overlay.updatePosition(this.view, this.anchorPos);
        }
      }
    }

    destroy(): void {
      this.overlay?.destroy();
      this.overlay = null;
      this.anchorPos = null;
    }
  },
  {
    eventHandlers: {
      mousedown(event: MouseEvent, view: EditorView) {
        if (event.button !== 0) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos == null) return false;
        const hit = commentHighlights.findByPos(view, pos);
        if (!hit) return false;
        // Dispatch a "request open" event; the controller owns state (store,
        // panel props) and will dispatch the actual overlay effect.
        view.dom.dispatchEvent(
          new CustomEvent("copilot-comment-highlight-click", {
            detail: { commentId: hit.id },
            bubbles: true,
          })
        );
        return false; // allow CM6 to handle selection/focus normally
      },
    },
  }
);
