/**
 * CommentThreadOverlay - lightweight DOM host + React root for the comment
 * thread popover. Positions below the anchor offset and reflows on scroll /
 * resize / doc change.
 *
 * Intentionally simpler than `QuickAskOverlay`: no drag, no resize, no dual-
 * anchor flipping. One overlay per editor at a time.
 */

import { EditorView } from "@codemirror/view";
import React from "react";
import { createRoot, Root } from "react-dom/client";
import { logWarn } from "@/logger";
import { CommentThreadPanel } from "./CommentThreadPanel";
import type { CommentThreadPanelOptions } from "./types";

const PANEL_WIDTH = 360;
const PANEL_MARGIN = 8;
const VIEWPORT_MARGIN = 12;

export class CommentThreadOverlay {
  private static activeInstance: CommentThreadOverlay | null = null;

  private container: HTMLDivElement | null = null;
  private root: Root | null = null;
  private ownerDocument: Document | null = null;
  private ownerWindow: Window | null = null;
  private cleanups: Array<() => void> = [];

  constructor(private readonly options: CommentThreadPanelOptions) {}

  mount(view: EditorView, anchorPos: number): void {
    // Only one overlay at a time.
    if (CommentThreadOverlay.activeInstance && CommentThreadOverlay.activeInstance !== this) {
      CommentThreadOverlay.activeInstance.destroy();
    }
    CommentThreadOverlay.activeInstance = this;

    const doc = view.dom.ownerDocument;
    this.ownerDocument = doc;
    this.ownerWindow = doc.defaultView;

    const container = doc.createElement("div");
    container.className = "copilot-comment-overlay";
    container.style.width = `${PANEL_WIDTH}px`;
    doc.body.appendChild(container);
    this.container = container;

    this.root = createRoot(container);
    this.root.render(<CommentThreadPanel {...this.options} />);

    const schedulePosition = () => {
      this.ownerWindow?.requestAnimationFrame(() => this.updatePosition(view, anchorPos));
    };
    const onScroll = () => schedulePosition();
    const onResize = () => schedulePosition();
    const onMousedown = (ev: MouseEvent) => {
      if (!container.contains(ev.target as Node)) {
        // Allow clicks on highlights themselves to re-open (handled by the
        // extension), but close on any other outside click.
        this.options.onClose();
      }
    };

    view.scrollDOM.addEventListener("scroll", onScroll, true);
    this.ownerWindow?.addEventListener("resize", onResize);
    this.ownerWindow?.addEventListener("scroll", onScroll, true);
    this.ownerDocument?.addEventListener("mousedown", onMousedown, true);

    this.cleanups.push(() => view.scrollDOM.removeEventListener("scroll", onScroll, true));
    this.cleanups.push(() => this.ownerWindow?.removeEventListener("resize", onResize));
    this.cleanups.push(() => this.ownerWindow?.removeEventListener("scroll", onScroll, true));
    this.cleanups.push(() =>
      this.ownerDocument?.removeEventListener("mousedown", onMousedown, true)
    );

    // Defer initial positioning past the CM6 transaction + React render so
    // layout is settled and `view.coordsAtPos` returns valid rects. Without
    // this, the overlay mounts with coords=null and only becomes visible
    // after a scroll/resize triggers a re-position.
    schedulePosition();
    // Also run a second pass after the React tree mounts, in case measured
    // content height changed the desired placement (above vs below).
    this.ownerWindow?.requestAnimationFrame(() => {
      this.ownerWindow?.requestAnimationFrame(() => this.updatePosition(view, anchorPos));
    });
  }

  updatePosition(view: EditorView, anchorPos: number): void {
    if (!this.container || !this.ownerWindow) return;
    try {
      const coords = view.coordsAtPos(anchorPos);
      if (!coords) return;
      const vw = this.ownerWindow.innerWidth;
      const vh = this.ownerWindow.innerHeight;

      let left = coords.left;
      const panelW = this.container.offsetWidth || PANEL_WIDTH;
      if (left + panelW + VIEWPORT_MARGIN > vw) {
        left = Math.max(VIEWPORT_MARGIN, vw - panelW - VIEWPORT_MARGIN);
      }
      left = Math.max(VIEWPORT_MARGIN, left);

      const belowTop = coords.bottom + PANEL_MARGIN;
      const panelH = this.container.offsetHeight || 160;
      let top = belowTop;
      if (belowTop + panelH + VIEWPORT_MARGIN > vh) {
        const aboveTop = coords.top - PANEL_MARGIN - panelH;
        if (aboveTop >= VIEWPORT_MARGIN) top = aboveTop;
      }

      this.container.style.left = `${Math.round(left)}px`;
      this.container.style.top = `${Math.round(top)}px`;
    } catch (error) {
      logWarn("CommentThreadOverlay: updatePosition failed", error);
    }
  }

  /** Re-render the panel (e.g., after the comment changed in the store). */
  rerender(options?: Partial<CommentThreadPanelOptions>): void {
    if (!this.root) return;
    const merged = { ...this.options, ...options };
    this.root.render(<CommentThreadPanel {...merged} />);
  }

  destroy(): void {
    if (CommentThreadOverlay.activeInstance === this) {
      CommentThreadOverlay.activeInstance = null;
    }
    for (const cleanup of this.cleanups.splice(0)) {
      try {
        cleanup();
      } catch {
        /* ignore */
      }
    }
    try {
      this.root?.unmount();
    } catch {
      /* ignore */
    }
    this.root = null;
    if (this.container?.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
  }
}
