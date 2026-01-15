/**
 * QuickAskOverlay - Manages the DOM overlay for Quick Ask panel.
 * Handles positioning, scroll tracking, drag/resize state, and React root lifecycle.
 */

import { EditorView } from "@codemirror/view";
import type { Editor } from "obsidian";
import React from "react";
import { createRoot, Root } from "react-dom/client";
import { updateDynamicStyleClass, clearDynamicStyleClass } from "@/utils/dom/dynamicStyleManager";
import { QuickAskPanel } from "./QuickAskPanel";
import type CopilotPlugin from "@/main";

interface QuickAskOverlayOptions {
  plugin: CopilotPlugin;
  editor: Editor;
  view: EditorView;
  selectedText: string;
  selectionFrom: number;
  selectionTo: number;
  onClose: () => void;
}

/**
 * Overlay class that manages the Quick Ask panel DOM and positioning.
 */
export class QuickAskOverlay {
  private static overlayRoot: HTMLElement | null = null;
  private static currentInstance: QuickAskOverlay | null = null;

  private root: Root | null = null;
  private overlayContainer: HTMLDivElement | null = null;
  private cleanupCallbacks: (() => void)[] = [];
  private overlayHost: HTMLElement | null = null;
  private rafId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private isClosing = false;
  private closeAnimationTimeout: number | null = null;
  private hasBlockingOverlay = false;

  // Drag state
  private dragPosition: { x: number; y: number } | null = null;
  // Resize state
  private resizeSize: { width: number; height: number } | null = null;
  // Anchor position
  private pos: number | null = null;
  // Current selection range (updated via mapPos)
  private currentSelectionFrom: number;
  private currentSelectionTo: number;

  constructor(private readonly options: QuickAskOverlayOptions) {
    this.currentSelectionFrom = options.selectionFrom;
    this.currentSelectionTo = options.selectionTo;
  }

  /**
   * Mounts the overlay at the specified position.
   */
  mount(pos: number): void {
    this.pos = pos;
    QuickAskOverlay.currentInstance = this;
    this.mountOverlay();
    this.setupGlobalListeners();
    this.schedulePositionUpdate();
  }

  /**
   * Destroys the overlay and cleans up resources.
   */
  destroy(): void {
    // Clear current instance reference
    if (QuickAskOverlay.currentInstance === this) {
      QuickAskOverlay.currentInstance = null;
    }

    if (this.closeAnimationTimeout !== null) {
      window.clearTimeout(this.closeAnimationTimeout);
      this.closeAnimationTimeout = null;
    }

    // Run cleanup callbacks
    for (const cleanup of this.cleanupCallbacks) {
      try {
        cleanup();
      } catch {
        // Ignore cleanup errors
      }
    }
    this.cleanupCallbacks = [];

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    this.root?.unmount();
    this.root = null;

    if (this.overlayContainer?.parentNode) {
      this.overlayContainer.parentNode.removeChild(this.overlayContainer);
    }
    if (this.overlayContainer) {
      clearDynamicStyleClass(this.overlayContainer);
    }
    this.overlayContainer = null;

    const overlayRoot = QuickAskOverlay.overlayRoot;
    if (overlayRoot && overlayRoot.childElementCount === 0) {
      const host = overlayRoot.parentElement;
      overlayRoot.remove();
      QuickAskOverlay.overlayRoot = null;
      host?.classList.remove("copilot-quick-ask-overlay-host");
    }
    this.pos = null;
  }

  /**
   * Updates the anchor position.
   */
  updatePosition(pos?: number): void {
    if (typeof pos === "number") {
      this.pos = pos;
    }
    this.schedulePositionUpdate();
  }

  /**
   * Updates the selection range (called when document changes).
   */
  updateSelectionRange(from: number, to: number): void {
    this.currentSelectionFrom = from;
    this.currentSelectionTo = to;
  }

  /**
   * Triggers close animation from outside.
   */
  static closeCurrentWithAnimation(): boolean {
    if (QuickAskOverlay.currentInstance) {
      QuickAskOverlay.currentInstance.closeWithAnimation();
      return true;
    }
    return false;
  }

  private closeWithAnimation = () => {
    if (this.isClosing) return;
    this.isClosing = true;
    this.hasBlockingOverlay = false;

    // Add closing animation class
    if (this.overlayContainer) {
      this.overlayContainer.classList.add("closing");
    }

    // Wait for animation to complete before actually closing
    this.closeAnimationTimeout = window.setTimeout(() => {
      this.closeAnimationTimeout = null;
      this.options.onClose();
    }, 200); // Match CSS animation duration
  };

  private static getOverlayRoot(host: HTMLElement): HTMLElement {
    if (QuickAskOverlay.overlayRoot && QuickAskOverlay.overlayRoot.parentElement !== host) {
      QuickAskOverlay.overlayRoot.parentElement?.classList.remove("copilot-quick-ask-overlay-host");
      QuickAskOverlay.overlayRoot.remove();
      QuickAskOverlay.overlayRoot = null;
    }

    if (QuickAskOverlay.overlayRoot) return QuickAskOverlay.overlayRoot;

    const root = document.createElement("div");
    root.className = "copilot-quick-ask-overlay-root";
    host.appendChild(root);
    host.classList.add("copilot-quick-ask-overlay-host");
    QuickAskOverlay.overlayRoot = root;
    return root;
  }

  private mountOverlay(): void {
    // Mount overlay inside editor DOM for proper layering
    const overlayHost = this.options.view.dom ?? document.body;
    this.overlayHost = overlayHost;

    const overlayRoot = QuickAskOverlay.getOverlayRoot(overlayHost);
    const overlayContainer = document.createElement("div");
    overlayContainer.className = "copilot-quick-ask-overlay";
    overlayRoot.appendChild(overlayContainer);
    this.overlayContainer = overlayContainer;

    this.root = createRoot(overlayContainer);
    this.root.render(
      <QuickAskPanel
        plugin={this.options.plugin}
        editor={this.options.editor}
        view={this.options.view}
        selectedText={this.options.selectedText}
        selectionFrom={this.currentSelectionFrom}
        selectionTo={this.currentSelectionTo}
        onClose={this.closeWithAnimation}
        onDragOffset={this.handleDragOffset}
        onResize={this.handleResize}
      />
    );

    // Setup scroll listeners
    const handleScroll = () => this.schedulePositionUpdate();
    window.addEventListener("scroll", handleScroll, true);
    this.cleanupCallbacks.push(() => window.removeEventListener("scroll", handleScroll, true));

    const handleResize = () => this.schedulePositionUpdate();
    window.addEventListener("resize", handleResize);
    this.cleanupCallbacks.push(() => window.removeEventListener("resize", handleResize));

    const scrollDom = this.options.view?.scrollDOM;
    if (scrollDom) {
      scrollDom.addEventListener("scroll", handleScroll);
      this.cleanupCallbacks.push(() => scrollDom.removeEventListener("scroll", handleScroll));
    }

    // Setup resize observer
    this.resizeObserver = new ResizeObserver(() => this.schedulePositionUpdate());
    if (scrollDom) this.resizeObserver.observe(scrollDom);
    this.resizeObserver.observe(overlayContainer);
  }

  private setupGlobalListeners(): void {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (this.hasBlockingOverlay) return;
      event.preventDefault();
      event.stopPropagation();
      this.closeWithAnimation();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    this.cleanupCallbacks.push(() => window.removeEventListener("keydown", handleKeyDown, true));
  }

  private schedulePositionUpdate(): void {
    if (this.rafId !== null) return;
    this.rafId = window.requestAnimationFrame(() => {
      this.rafId = null;
      this.updateOverlayPosition();
    });
  }

  private updateOverlayPosition(): void {
    if (!this.overlayContainer || this.pos === null) return;

    // If panel has been dragged, use drag position
    if (this.dragPosition) {
      this.updateDragPosition();
      return;
    }

    const anchorRect = this.options.view.coordsAtPos(this.pos);
    if (!anchorRect) return;

    const hostRect =
      this.overlayHost?.getBoundingClientRect() ?? document.body.getBoundingClientRect();

    const viewportWidth = hostRect.width;
    const margin = 12;
    const offsetY = 6;

    const scrollDom = this.options.view.scrollDOM;
    const scrollRect = scrollDom?.getBoundingClientRect();
    const sizer = scrollDom?.querySelector(".cm-sizer");
    const sizerRect = sizer?.getBoundingClientRect();

    // YOLO default: min(420px, 83vw), max: min(560px, 90vw)
    const defaultWidth = Math.min(420, viewportWidth * 0.83);
    const maxWidth = Math.min(560, viewportWidth * 0.9);
    const panelWidth = Math.max(300, Math.min(defaultWidth, maxWidth));

    const contentLeft =
      (sizerRect?.left ?? scrollRect?.left ?? hostRect.left + margin) - hostRect.left;
    const editorContentWidth = sizerRect?.width ?? scrollRect?.width ?? viewportWidth - margin * 2;
    const contentRight = contentLeft + editorContentWidth;

    let left = anchorRect.left - hostRect.left;
    left = Math.min(left, contentRight - panelWidth);
    left = Math.max(left, contentLeft);
    left = Math.min(left, viewportWidth - margin - panelWidth);
    left = Math.max(left, margin);

    const top = anchorRect.bottom - hostRect.top + offsetY;

    updateDynamicStyleClass(this.overlayContainer, "copilot-quick-ask-overlay-pos", {
      width: panelWidth,
      left: Math.round(left),
      top: Math.round(top),
    });
  }

  private handleDragOffset = (offset: { x: number; y: number }): void => {
    this.dragPosition = offset;
    this.updateDragPosition();
  };

  private handleResize = (size: { width: number; height: number }): void => {
    this.resizeSize = size;
    this.updateDragPosition();
  };

  private updateDragPosition(): void {
    if (!this.overlayContainer || !this.dragPosition) return;

    const hostRect =
      this.overlayHost?.getBoundingClientRect() ?? document.body.getBoundingClientRect();

    const viewportWidth = hostRect.width;

    // YOLO default: min(420px, 83vw), max: min(560px, 90vw)
    const defaultWidth = Math.min(420, viewportWidth * 0.83);
    const maxWidth = Math.min(560, viewportWidth * 0.9);

    // Use resized width if available, otherwise use YOLO default
    const panelWidth = this.resizeSize?.width ?? Math.max(300, Math.min(defaultWidth, maxWidth));
    const panelHeight = this.resizeSize?.height;

    updateDynamicStyleClass(this.overlayContainer, "copilot-quick-ask-overlay-pos", {
      width: panelWidth,
      ...(panelHeight ? { height: panelHeight } : {}),
      left: Math.round(this.dragPosition.x - hostRect.left),
      top: Math.round(this.dragPosition.y - hostRect.top),
    });
  }
}
