/**
 * QuickAskOverlay - Manages the DOM overlay for Quick Ask panel.
 * Handles positioning, scroll tracking, drag/resize state, and React root lifecycle.
 *
 * This is the single source of truth for panel position and size.
 * QuickAskPanel fills its container and delegates resize events here.
 */

import { EditorView } from "@codemirror/view";
import type { Editor } from "obsidian";
import React from "react";
import { createRoot, Root } from "react-dom/client";
import { updateDynamicStyleClass, clearDynamicStyleClass } from "@/utils/dom/dynamicStyleManager";
import { QuickAskPanel } from "./QuickAskPanel";
import type CopilotPlugin from "@/main";
import type { ReplaceGuard } from "@/editor/replaceGuard";
import type { ResizeDirection } from "@/hooks/use-resizable";

// Layout constants for Quick Ask panel positioning
const PANEL_MARGIN = 12;
const PANEL_OFFSET_Y = 6;
const PANEL_DEFAULT_WIDTH_RATIO = 0.83; // 83% of viewport
const PANEL_MAX_WIDTH_RATIO = 0.9; // 90% of viewport
const PANEL_DEFAULT_WIDTH_MAX = 420;
const PANEL_MAX_WIDTH_MAX = 560;
const PANEL_MIN_WIDTH = 300;
const PANEL_MIN_HEIGHT = 200;

interface AnchorRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface QuickAskOverlayOptions {
  plugin: CopilotPlugin;
  editor: Editor;
  view: EditorView;
  selectedText: string;
  selectionFrom: number;
  selectionTo: number;
  replaceGuard: ReplaceGuard;
  onClose: () => void;
}

/**
 * Overlay class that manages the Quick Ask panel DOM and positioning.
 * Single source of truth for position and size.
 */
export class QuickAskOverlay {
  private static overlayRoot: HTMLElement | null = null;
  private static currentInstance: QuickAskOverlay | null = null;

  private root: Root | null = null;
  private overlayContainer: HTMLDivElement | null = null;
  private cleanupCallbacks: (() => void)[] = [];
  private overlayHost: HTMLElement | null = null;
  private ownerDocument: Document | null = null;
  private ownerWindow: Window | null = null;
  private rafId: number | null = null;
  private panelRerenderRafId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private isClosing = false;
  private closeAnimationTimeout: number | null = null;

  // Drag state
  private dragPosition: { x: number; y: number } | null = null;
  // Resize state (single source of truth; height is optional — only set when user resizes vertically)
  private resizeSize: { width: number; height?: number } | null = null;
  // Reason: Track whether the user has intentionally resized the height
  // (vs width-only resize which shouldn't remove the chat area max-height).
  private hasUserResizedHeight = false;
  // Anchor position
  private pos: number | null = null;
  private fallbackPos: number | null = null;

  // Resize interaction state
  private isResizing = false;
  private resizeDirection: ResizeDirection | null = null;
  private resizeStartRect: DOMRect | null = null;
  private resizeStartMouse: { x: number; y: number } | null = null;
  private resizeRafId: number | null = null;
  // Save original body styles to restore after resize
  private savedBodyUserSelect: string = "";
  private savedBodyCursor: string = "";

  constructor(private readonly options: QuickAskOverlayOptions) {}

  /**
   * Mounts the overlay at the specified anchor positions.
   * @param pos - Primary anchor position (typically selection head)
   * @param fallbackPos - Fallback anchor position (typically selection anchor)
   */
  mount(pos: number, fallbackPos?: number | null): void {
    this.pos = pos;
    this.fallbackPos = typeof fallbackPos === "number" ? fallbackPos : null;
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

    const win = this.ownerWindow ?? window;

    if (this.closeAnimationTimeout !== null) {
      win.clearTimeout(this.closeAnimationTimeout);
      this.closeAnimationTimeout = null;
    }

    // Clean up resize state
    this.cleanupResize();

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
      win.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.panelRerenderRafId !== null) {
      win.cancelAnimationFrame(this.panelRerenderRafId);
      this.panelRerenderRafId = null;
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
    this.fallbackPos = null;
    this.ownerDocument = null;
    this.ownerWindow = null;
  }

  /**
   * Updates the anchor position.
   */
  updatePosition(pos?: number, fallbackPos?: number | null): void {
    if (typeof pos === "number") {
      this.pos = pos;
    }
    if (typeof fallbackPos === "number") {
      this.fallbackPos = fallbackPos;
    } else if (fallbackPos === null) {
      this.fallbackPos = null;
    }
    this.schedulePositionUpdate();
  }

  /**
   * Gets the ReplaceGuard instance (for quickAskExtension to call onDocChanged).
   */
  getReplaceGuard() {
    return this.options.replaceGuard;
  }

  /**
   * Schedules a React re-render of the QuickAskPanel (coalesced per animation frame).
   * Called when document changes to update Replace button disabled state.
   */
  schedulePanelRerender(): void {
    if (this.panelRerenderRafId !== null) {
      return;
    }

    const win = this.ownerWindow ?? window;
    this.panelRerenderRafId = win.requestAnimationFrame(() => {
      this.panelRerenderRafId = null;
      this.renderPanel();
    });
  }

  /**
   * Re-renders the QuickAskPanel with current props.
   * React preserves component state across renders.
   */
  private renderPanel(): void {
    if (!this.root) {
      return;
    }

    this.root.render(
      <QuickAskPanel
        plugin={this.options.plugin}
        editor={this.options.editor}
        view={this.options.view}
        selectedText={this.options.selectedText}
        replaceGuard={this.options.replaceGuard}
        onClose={this.closeWithAnimation}
        onDragOffset={this.handleDragOffset}
        onResizeStart={this.handleResizeStart}
        hasCustomHeight={this.hasUserResizedHeight}
      />
    );
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

    // Add closing animation class
    if (this.overlayContainer) {
      this.overlayContainer.classList.add("closing");

      // Listen for animation end instead of hardcoded timeout
      // Filter by target and animation name to avoid child element animations triggering close
      const handleAnimationEnd = (event: AnimationEvent) => {
        if (
          event.target !== this.overlayContainer ||
          event.animationName !== "copilot-quick-ask-fade-out"
        ) {
          return;
        }
        this.overlayContainer?.removeEventListener("animationend", handleAnimationEnd);
        if (this.closeAnimationTimeout !== null) {
          window.clearTimeout(this.closeAnimationTimeout);
          this.closeAnimationTimeout = null;
        }
        this.options.onClose();
      };

      this.overlayContainer.addEventListener("animationend", handleAnimationEnd);

      // Fallback timeout in case animationend doesn't fire (e.g., reduced motion)
      const win = this.ownerWindow ?? window;
      this.closeAnimationTimeout = win.setTimeout(() => {
        this.overlayContainer?.removeEventListener("animationend", handleAnimationEnd);
        this.closeAnimationTimeout = null;
        this.options.onClose();
      }, 300); // Slightly longer than animation as fallback
    } else {
      this.options.onClose();
    }
  };

  private static getOverlayRoot(host: HTMLElement): HTMLElement {
    if (QuickAskOverlay.overlayRoot && QuickAskOverlay.overlayRoot.parentElement !== host) {
      QuickAskOverlay.overlayRoot.parentElement?.classList.remove("copilot-quick-ask-overlay-host");
      QuickAskOverlay.overlayRoot.remove();
      QuickAskOverlay.overlayRoot = null;
    }

    if (QuickAskOverlay.overlayRoot) return QuickAskOverlay.overlayRoot;

    const doc = host.ownerDocument ?? document;
    const root = doc.createElement("div");
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

    // Capture owner document/window for popout window compatibility
    const doc = overlayHost.ownerDocument ?? document;
    const win = doc.defaultView ?? window;
    this.ownerDocument = doc;
    this.ownerWindow = win;

    const overlayRoot = QuickAskOverlay.getOverlayRoot(overlayHost);
    const overlayContainer = doc.createElement("div");
    overlayContainer.className = "copilot-quick-ask-overlay";
    overlayRoot.appendChild(overlayContainer);
    this.overlayContainer = overlayContainer;

    this.root = createRoot(overlayContainer);
    this.renderPanel();

    // Setup scroll listeners
    const handleScroll = () => this.schedulePositionUpdate();
    win.addEventListener("scroll", handleScroll, true);
    this.cleanupCallbacks.push(() => win.removeEventListener("scroll", handleScroll, true));

    const handleResize = () => this.schedulePositionUpdate();
    win.addEventListener("resize", handleResize);
    this.cleanupCallbacks.push(() => win.removeEventListener("resize", handleResize));

    const scrollDom = this.options.view?.scrollDOM;
    if (scrollDom) {
      scrollDom.addEventListener("scroll", handleScroll);
      this.cleanupCallbacks.push(() => scrollDom.removeEventListener("scroll", handleScroll));
    }

    // Setup resize observer with availability check
    // Reason: Only observe scrollDom (editor viewport changes). Do NOT observe
    // overlayContainer — its height changes during AI streaming would trigger
    // position recalculation and cause the panel to jump up/down.
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.schedulePositionUpdate());
      if (scrollDom) this.resizeObserver.observe(scrollDom);
    }
  }

  private setupGlobalListeners(): void {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (event.defaultPrevented) return;

      const doc = this.ownerDocument ?? document;
      const activeEl = doc.activeElement;
      const isFocusInsidePanel = !!(activeEl && this.overlayContainer?.contains(activeEl));

      // If focus is inside the panel, let QuickAskPanel / Lexical consume Escape first.
      if (isFocusInsidePanel) return;

      event.preventDefault();
      event.stopPropagation();
      this.closeWithAnimation();
    };

    // Bubble-phase so inner handlers (Lexical menus, etc.) can run first.
    const win = this.ownerWindow ?? window;
    win.addEventListener("keydown", handleKeyDown);
    this.cleanupCallbacks.push(() => win.removeEventListener("keydown", handleKeyDown));
  }

  private schedulePositionUpdate(): void {
    if (this.rafId !== null) return;
    const win = this.ownerWindow ?? window;
    this.rafId = win.requestAnimationFrame(() => {
      this.rafId = null;
      this.updateOverlayPosition();
    });
  }

  /**
   * Returns true if the anchor rect intersects the visible editor viewport.
   * Mirrors CustomCommandChatModal's visibility check.
   */
  private isAnchorRectVisible(coords: AnchorRect, visibleRect: DOMRect): boolean {
    return (
      coords.bottom >= visibleRect.top &&
      coords.top <= visibleRect.bottom &&
      coords.right >= visibleRect.left &&
      coords.left <= visibleRect.right
    );
  }

  /**
   * Try selection head first, then anchor - use whichever is visible.
   * If neither is visible, return null so the caller can fall back to centering.
   */
  private resolveVisibleAnchorRect(
    hostRect: DOMRect,
    scrollRect: DOMRect | undefined
  ): AnchorRect | null {
    const visibleRect = scrollRect ?? hostRect;
    const positionsToTry: Array<number | null> = [this.pos, this.fallbackPos];

    for (const pos of positionsToTry) {
      if (typeof pos !== "number") continue;
      const coords = this.options.view.coordsAtPos(pos) as AnchorRect | null;
      if (!coords) continue;
      if (this.isAnchorRectVisible(coords, visibleRect)) return coords;
    }

    return null;
  }

  private updateOverlayPosition(): void {
    if (!this.overlayContainer || this.pos === null) return;

    // If panel has been dragged, use drag position
    if (this.dragPosition) {
      this.updateDragPosition();
      return;
    }

    const doc = this.ownerDocument ?? document;
    const hostRect = this.overlayHost?.getBoundingClientRect() ?? doc.body.getBoundingClientRect();

    const viewportWidth = hostRect.width;

    const scrollDom = this.options.view.scrollDOM;
    const scrollRect = scrollDom?.getBoundingClientRect();
    const sizer = scrollDom?.querySelector(".cm-sizer");
    const sizerRect = sizer?.getBoundingClientRect();

    // Try to find a visible anchor position (head first, then anchor)
    const anchorRect = this.resolveVisibleAnchorRect(hostRect, scrollRect);

    // Calculate panel dimensions using constants
    const defaultWidth = Math.min(
      PANEL_DEFAULT_WIDTH_MAX,
      viewportWidth * PANEL_DEFAULT_WIDTH_RATIO
    );
    const maxWidth = Math.min(PANEL_MAX_WIDTH_MAX, viewportWidth * PANEL_MAX_WIDTH_RATIO);
    // Minimum width adapts to viewport to prevent overflow in narrow panes
    const minWidth = Math.min(PANEL_MIN_WIDTH, viewportWidth - PANEL_MARGIN * 2);
    // Respect resizeSize even when not dragged
    const panelWidth =
      this.resizeSize?.width ?? Math.max(minWidth, Math.min(defaultWidth, maxWidth));
    const panelHeight = this.resizeSize?.height;

    const contentLeft =
      (sizerRect?.left ?? scrollRect?.left ?? hostRect.left + PANEL_MARGIN) - hostRect.left;
    const editorContentWidth =
      sizerRect?.width ?? scrollRect?.width ?? viewportWidth - PANEL_MARGIN * 2;
    const contentRight = contentLeft + editorContentWidth;

    // Calculate left position: anchor to selection if visible, otherwise center
    let left = anchorRect
      ? anchorRect.left - hostRect.left
      : contentLeft + (editorContentWidth - panelWidth) / 2;
    left = Math.min(left, contentRight - panelWidth);
    left = Math.max(left, contentLeft);
    left = Math.min(left, viewportWidth - PANEL_MARGIN - panelWidth);
    left = Math.max(left, PANEL_MARGIN);

    // Calculate visible area bounds for top positioning
    const visibleTop = (scrollRect?.top ?? hostRect.top) - hostRect.top;
    const visibleBottom = (scrollRect?.bottom ?? hostRect.bottom) - hostRect.top;
    const visibleHeight = visibleBottom - visibleTop;
    const minTop = visibleTop + PANEL_MARGIN;

    // First pass: apply width/left so we can measure actual height for centering
    updateDynamicStyleClass(this.overlayContainer, "copilot-quick-ask-overlay-pos", {
      width: panelWidth,
      ...(typeof panelHeight === "number" ? { height: panelHeight } : {}),
      left: Math.round(left),
      top: Math.round(minTop), // Temporary top for measurement
    });

    // Measure height for centering and clamping
    const heightForClamp =
      typeof panelHeight === "number"
        ? panelHeight
        : this.overlayContainer.getBoundingClientRect().height || PANEL_MIN_HEIGHT;

    // Calculate top position: anchor below selection if visible, otherwise center in viewport
    let top = anchorRect
      ? anchorRect.bottom - hostRect.top + PANEL_OFFSET_Y
      : visibleTop + (visibleHeight - heightForClamp) / 2; // True center
    top = Math.max(top, minTop);

    // Clamp top to keep panel within viewport
    const maxTop = visibleBottom - PANEL_MARGIN - heightForClamp;
    const effectiveMaxTop = Math.max(minTop, maxTop);
    const clampedTop = Math.max(minTop, Math.min(top, effectiveMaxTop));

    // Final pass: apply the correct top position
    updateDynamicStyleClass(this.overlayContainer, "copilot-quick-ask-overlay-pos", {
      width: panelWidth,
      ...(typeof panelHeight === "number" ? { height: panelHeight } : {}),
      left: Math.round(left),
      top: Math.round(clampedTop),
    });
  }

  private handleDragOffset = (offset: { x: number; y: number }): void => {
    this.dragPosition = offset;
    this.updateDragPosition();
  };

  /**
   * Called by Panel when user starts resizing.
   * Overlay takes over and handles the entire resize interaction.
   */
  private handleResizeStart = (
    direction: ResizeDirection,
    start: { x: number; y: number }
  ): void => {
    if (this.isResizing) return;

    const rect = this.overlayContainer?.getBoundingClientRect();
    if (!rect) return;

    this.isResizing = true;
    this.resizeDirection = direction;
    this.resizeStartRect = rect;
    this.resizeStartMouse = start;

    const doc = this.ownerDocument ?? document;
    const body = doc.body;

    // Prevent text selection and set resize cursor on body during drag
    // Save original values to restore later
    this.savedBodyUserSelect = body.style.userSelect;
    this.savedBodyCursor = body.style.cursor;
    body.classList.add("copilot-quick-ask-resizing");
    body.style.userSelect = "none";
    // Set cursor based on direction to ensure consistent feedback
    const cursorMap: Record<ResizeDirection, string> = {
      right: "ew-resize",
      bottom: "ns-resize",
      "bottom-left": "nesw-resize",
      "bottom-right": "nwse-resize",
    };
    body.style.cursor = cursorMap[direction] ?? "default";

    // Bind document-level listeners (use capture for consistency with useRafResizable/useDraggable)
    doc.addEventListener("mousemove", this.handleResizeMove, true);
    doc.addEventListener("mouseup", this.handleResizeEnd, true);
  };

  private handleResizeMove = (e: MouseEvent): void => {
    if (!this.isResizing || !this.resizeStartRect || !this.resizeStartMouse) return;

    const win = this.ownerWindow ?? window;

    // Cancel any pending RAF
    if (this.resizeRafId !== null) {
      win.cancelAnimationFrame(this.resizeRafId);
    }

    this.resizeRafId = win.requestAnimationFrame(() => {
      this.resizeRafId = null;
      this.applyResize(e.clientX, e.clientY);
    });
  };

  private handleResizeEnd = (): void => {
    this.cleanupResize();
    // Re-render panel to update hasCustomHeight
    this.renderPanel();
  };

  private cleanupResize(): void {
    const win = this.ownerWindow ?? window;

    if (this.resizeRafId !== null) {
      win.cancelAnimationFrame(this.resizeRafId);
      this.resizeRafId = null;
    }

    // Only restore body styles if we actually started resizing
    // This prevents polluting body styles when destroy() is called without resize
    if (this.isResizing) {
      const doc = this.ownerDocument ?? document;
      const body = doc.body;
      doc.removeEventListener("mousemove", this.handleResizeMove, true);
      doc.removeEventListener("mouseup", this.handleResizeEnd, true);
      body.classList.remove("copilot-quick-ask-resizing");
      // Restore original body styles
      body.style.userSelect = this.savedBodyUserSelect;
      body.style.cursor = this.savedBodyCursor;
    }

    this.isResizing = false;
    this.resizeDirection = null;
    this.resizeStartRect = null;
    this.resizeStartMouse = null;
  }

  private applyResize(clientX: number, clientY: number): void {
    if (!this.resizeStartRect || !this.resizeStartMouse || !this.resizeDirection) return;

    const doc = this.ownerDocument ?? document;
    const hostRect = this.overlayHost?.getBoundingClientRect() ?? doc.body.getBoundingClientRect();

    const deltaX = clientX - this.resizeStartMouse.x;
    const deltaY = clientY - this.resizeStartMouse.y;

    const startRect = this.resizeStartRect;
    const direction = this.resizeDirection;

    // Calculate constraints
    const viewportWidth = hostRect.width;
    const minWidth = Math.min(PANEL_MIN_WIDTH, viewportWidth - PANEL_MARGIN * 2);
    const minHeight = PANEL_MIN_HEIGHT;

    // Calculate max bounds based on direction
    const boundLeft = hostRect.left + PANEL_MARGIN;
    const boundRight = hostRect.right - PANEL_MARGIN;
    const boundBottom = hostRect.bottom - PANEL_MARGIN;

    let nextWidth = startRect.width;
    let nextHeight = startRect.height;
    let nextX: number | undefined;
    let nextY: number | undefined;

    // Handle different resize directions
    // For width-only resize (right), we don't touch height at all
    const involvesHeight = direction !== "right";

    switch (direction) {
      case "right":
        nextWidth = startRect.width + deltaX;
        break;

      case "bottom":
        nextHeight = startRect.height + deltaY;
        break;

      case "bottom-right":
        nextWidth = startRect.width + deltaX;
        nextHeight = startRect.height + deltaY;
        break;

      case "bottom-left":
        // Width grows to the left, so we need to adjust position
        nextWidth = startRect.width - deltaX;
        nextHeight = startRect.height + deltaY;
        // Calculate new left position
        nextX = startRect.left + deltaX;
        nextY = startRect.top;
        break;
    }

    // Apply constraints
    const maxWidthRight = boundRight - startRect.left;
    const maxWidthLeft = startRect.right - boundLeft;
    const maxHeight = boundBottom - startRect.top;

    if (direction === "bottom-left") {
      // For bottom-left, constrain width based on how far left we can go
      nextWidth = Math.max(minWidth, Math.min(nextWidth, maxWidthLeft));
      // Recalculate X based on constrained width
      nextX = startRect.right - nextWidth;
      // Ensure X doesn't go past left bound
      if (nextX < boundLeft) {
        nextX = boundLeft;
        nextWidth = startRect.right - boundLeft;
      }
    } else {
      nextWidth = Math.max(minWidth, Math.min(nextWidth, maxWidthRight));
    }

    // Only apply height constraints when the direction involves vertical resizing
    if (involvesHeight) {
      nextHeight = Math.max(minHeight, Math.min(nextHeight, maxHeight));
    }

    // Reason: Only set explicit height when the resize direction involves vertical movement.
    // Width-only resize preserves any previous user-set height (or keeps it undefined
    // so the panel auto-sizes based on content).
    const prevHeight = this.resizeSize?.height;
    const nextSize: { width: number; height?: number } = { width: nextWidth };
    if (involvesHeight) {
      nextSize.height = nextHeight;
    } else if (this.hasUserResizedHeight && typeof prevHeight === "number") {
      nextSize.height = prevHeight;
    }
    this.resizeSize = nextSize;

    // Only mark as "user resized height" when the direction involves vertical resizing
    // and re-render panel immediately so hasCustomHeight takes effect during drag
    const prevHasUserResizedHeight = this.hasUserResizedHeight;
    if (involvesHeight) {
      this.hasUserResizedHeight = true;
    }

    // If hasUserResizedHeight changed, re-render panel to update max-height immediately
    if (this.hasUserResizedHeight !== prevHasUserResizedHeight) {
      this.renderPanel();
    }

    // If bottom-left, also update drag position to switch to drag mode
    if (direction === "bottom-left" && nextX !== undefined) {
      this.dragPosition = { x: nextX, y: nextY ?? startRect.top };
      this.updateDragPosition();
    } else if (this.dragPosition) {
      // Already in drag mode, just update position
      this.updateDragPosition();
    } else {
      // Not in drag mode, update anchor-based position
      this.schedulePositionUpdate();
    }
  }

  private updateDragPosition(): void {
    if (!this.overlayContainer || !this.dragPosition) return;

    const doc = this.ownerDocument ?? document;
    const hostRect = this.overlayHost?.getBoundingClientRect() ?? doc.body.getBoundingClientRect();

    const viewportWidth = hostRect.width;

    // Calculate panel dimensions using constants
    const defaultWidth = Math.min(
      PANEL_DEFAULT_WIDTH_MAX,
      viewportWidth * PANEL_DEFAULT_WIDTH_RATIO
    );
    const maxWidth = Math.min(PANEL_MAX_WIDTH_MAX, viewportWidth * PANEL_MAX_WIDTH_RATIO);
    // Minimum width adapts to viewport to prevent overflow in narrow panes
    const minWidth = Math.min(PANEL_MIN_WIDTH, viewportWidth - PANEL_MARGIN * 2);

    // Use resized width if available, otherwise use default
    const panelWidth =
      this.resizeSize?.width ?? Math.max(minWidth, Math.min(defaultWidth, maxWidth));
    const panelHeight = this.resizeSize?.height;

    updateDynamicStyleClass(this.overlayContainer, "copilot-quick-ask-overlay-pos", {
      width: panelWidth,
      ...(panelHeight ? { height: panelHeight } : {}),
      left: Math.round(this.dragPosition.x - hostRect.left),
      top: Math.round(this.dragPosition.y - hostRect.top),
    });
  }
}
