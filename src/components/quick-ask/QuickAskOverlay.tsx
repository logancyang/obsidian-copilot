import { logWarn } from "@/logger";
import { EditorView } from "@codemirror/view";
import type { Editor } from "obsidian";
import React from "react";
import { Root } from "react-dom/client";
import { updateDynamicStyleClass, clearDynamicStyleClass } from "@/utils/dom/dynamicStyleManager";
import { QuickAskPanel } from "./QuickAskPanel";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import type CopilotPlugin from "@/main";
import type { ReplaceGuard } from "@/editor/replaceGuard";
import type { ResizeDirection } from "@/hooks/use-resizable";

const PANEL_MARGIN = 12;
const PANEL_OFFSET_Y = 6;
const PANEL_DEFAULT_WIDTH_RATIO = 0.83;
const PANEL_MAX_WIDTH_RATIO = 0.9;
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

  private dragPosition: { x: number; y: number } | null = null;
  private resizeSize: { width: number; height?: number } | null = null;
  private hasUserResizedHeight = false;
  private bottomAnchorPos: number | null = null;
  private topAnchorPos: number | null = null;
  private focusAnchorPos: number | null = null;
  private placementSide: "below" | "above" | null = null;

  private isResizing = false;
  private resizeDirection: ResizeDirection | null = null;
  private resizeStartRect: DOMRect | null = null;
  private resizeStartMouse: { x: number; y: number } | null = null;
  private resizeRafId: number | null = null;

  constructor(private readonly options: QuickAskOverlayOptions) {}

  mount(
    bottomAnchorPos: number,
    topAnchorPos?: number | null,
    focusAnchorPos?: number | null
  ): void {
    this.bottomAnchorPos = bottomAnchorPos;
    this.topAnchorPos = typeof topAnchorPos === "number" ? topAnchorPos : null;
    this.focusAnchorPos = typeof focusAnchorPos === "number" ? focusAnchorPos : null;
    this.placementSide = null;
    QuickAskOverlay.currentInstance = this;
    this.mountOverlay();
    this.setupGlobalListeners();
    this.schedulePositionUpdate();
  }

  destroy(): void {
    if (QuickAskOverlay.currentInstance === this) {
      QuickAskOverlay.currentInstance = null;
    }

    const win = this.ownerWindow ?? window;

    if (this.closeAnimationTimeout !== null) {
      win.clearTimeout(this.closeAnimationTimeout);
      this.closeAnimationTimeout = null;
    }

    this.cleanupResize();

    for (const cleanup of this.cleanupCallbacks) {
      try {
        cleanup();
      } catch (error) {
        logWarn("[QuickAsk] A cleanup callback failed", error);
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
    this.bottomAnchorPos = null;
    this.topAnchorPos = null;
    this.focusAnchorPos = null;
    this.placementSide = null;
    this.ownerDocument = null;
    this.ownerWindow = null;
  }

  updatePosition(
    bottomAnchorPos?: number,
    topAnchorPos?: number | null,
    focusAnchorPos?: number | null
  ): void {
    if (typeof bottomAnchorPos === "number") {
      this.bottomAnchorPos = bottomAnchorPos;
    }
    if (typeof topAnchorPos === "number") {
      this.topAnchorPos = topAnchorPos;
    } else if (topAnchorPos === null) {
      this.topAnchorPos = null;
    }
    if (typeof focusAnchorPos === "number") {
      this.focusAnchorPos = focusAnchorPos;
    } else if (focusAnchorPos === null) {
      this.focusAnchorPos = null;
    }
    this.placementSide = null;
    this.schedulePositionUpdate();
  }

  getReplaceGuard() {
    return this.options.replaceGuard;
  }

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

    if (this.overlayContainer) {
      this.overlayContainer.classList.add("closing");

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

      const win = this.ownerWindow ?? window;
      this.closeAnimationTimeout = win.setTimeout(() => {
        this.overlayContainer?.removeEventListener("animationend", handleAnimationEnd);
        this.closeAnimationTimeout = null;
        this.options.onClose();
      }, 300);
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

    const root = host.createDiv("copilot-quick-ask-overlay-root");
    host.classList.add("copilot-quick-ask-overlay-host");
    QuickAskOverlay.overlayRoot = root;
    return root;
  }

  private mountOverlay(): void {
    const overlayHost = this.options.view.dom ?? activeDocument.body;
    this.overlayHost = overlayHost;

    const doc = overlayHost.doc;
    const win = doc.defaultView ?? window;
    this.ownerDocument = doc;
    this.ownerWindow = win;

    const overlayRoot = QuickAskOverlay.getOverlayRoot(overlayHost);
    const overlayContainer = overlayRoot.createDiv("copilot-quick-ask-overlay");
    this.overlayContainer = overlayContainer;

    this.root = createPluginRoot(overlayContainer, this.options.plugin.app);
    this.renderPanel();

    const handleScroll = () => {
      this.placementSide = null;
      this.schedulePositionUpdate();
    };
    win.addEventListener("scroll", handleScroll, true);
    this.cleanupCallbacks.push(() => win.removeEventListener("scroll", handleScroll, true));

    const handleResize = () => {
      this.placementSide = null;
      this.schedulePositionUpdate();
    };
    win.addEventListener("resize", handleResize);
    this.cleanupCallbacks.push(() => win.removeEventListener("resize", handleResize));

    const scrollDom = this.options.view?.scrollDOM;
    if (scrollDom) {
      scrollDom.addEventListener("scroll", handleScroll);
      this.cleanupCallbacks.push(() => scrollDom.removeEventListener("scroll", handleScroll));
    }

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        this.placementSide = null;
        this.schedulePositionUpdate();
      });
      if (scrollDom) this.resizeObserver.observe(scrollDom);
    }
  }

  private setupGlobalListeners(): void {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (event.defaultPrevented) return;

      const doc = this.ownerDocument ?? activeDocument;
      const activeEl = doc.activeElement;
      const isFocusInsidePanel = !!(activeEl && this.overlayContainer?.contains(activeEl));

      if (isFocusInsidePanel) return;

      event.preventDefault();
      event.stopPropagation();
      this.closeWithAnimation();
    };

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

  private isAnchorRectVisible(coords: AnchorRect, visibleRect: DOMRect): boolean {
    return (
      coords.bottom >= visibleRect.top &&
      coords.top <= visibleRect.bottom &&
      coords.right >= visibleRect.left &&
      coords.left <= visibleRect.right
    );
  }

  private resolveVisibleAnchors(
    hostRect: DOMRect,
    scrollRect: DOMRect | undefined
  ): { bottomRect: AnchorRect | null; topRect: AnchorRect | null; focusRect: AnchorRect | null } {
    const visibleRect = scrollRect ?? hostRect;

    const getVisibleRect = (pos: number | null): AnchorRect | null => {
      if (typeof pos !== "number") return null;
      const coords = this.options.view.coordsAtPos(pos);
      if (!coords) return null;
      return this.isAnchorRectVisible(coords, visibleRect) ? coords : null;
    };

    return {
      bottomRect: getVisibleRect(this.bottomAnchorPos),
      topRect: getVisibleRect(this.topAnchorPos),
      focusRect: getVisibleRect(this.focusAnchorPos),
    };
  }

  private computeVerticalPlacement(
    bottomRect: AnchorRect | null,
    topRect: AnchorRect | null,
    hostRect: DOMRect,
    visibleTop: number,
    visibleBottom: number,
    visibleHeight: number,
    heightForClamp: number,
    minTop: number
  ): number {
    let top: number;

    if (this.placementSide === "below" && bottomRect) {
      top = bottomRect.bottom - hostRect.top + PANEL_OFFSET_Y;
    } else if (this.placementSide === "above" && topRect) {
      top = topRect.top - hostRect.top - PANEL_OFFSET_Y - heightForClamp;
    } else if (bottomRect) {
      const belowY = bottomRect.bottom - hostRect.top + PANEL_OFFSET_Y;
      const spaceBelow = visibleBottom - (bottomRect.bottom - hostRect.top) - PANEL_OFFSET_Y;

      if (spaceBelow >= heightForClamp + PANEL_MARGIN) {
        top = belowY;
        this.placementSide = "below";
      } else if (topRect) {
        const aboveY = topRect.top - hostRect.top - PANEL_OFFSET_Y - heightForClamp;
        const spaceAbove = topRect.top - hostRect.top - PANEL_OFFSET_Y - visibleTop;

        if (spaceAbove >= heightForClamp + PANEL_MARGIN) {
          top = aboveY;
          this.placementSide = "above";
        } else {
          top = visibleTop + (visibleHeight - heightForClamp) / 2;
          this.placementSide = null;
        }
      } else {
        top = visibleTop + (visibleHeight - heightForClamp) / 2;
        this.placementSide = null;
      }
    } else if (topRect) {
      const aboveY = topRect.top - hostRect.top - PANEL_OFFSET_Y - heightForClamp;
      const spaceAbove = topRect.top - hostRect.top - PANEL_OFFSET_Y - visibleTop;

      if (spaceAbove >= heightForClamp + PANEL_MARGIN) {
        top = aboveY;
        this.placementSide = "above";
      } else {
        top = visibleTop + (visibleHeight - heightForClamp) / 2;
        this.placementSide = null;
      }
    } else {
      top = visibleTop + (visibleHeight - heightForClamp) / 2;
      this.placementSide = null;
    }

    const maxTop = visibleBottom - PANEL_MARGIN - heightForClamp;
    const effectiveMaxTop = Math.max(minTop, maxTop);
    return Math.max(minTop, Math.min(top, effectiveMaxTop));
  }

  private updateOverlayPosition(): void {
    if (!this.overlayContainer || this.bottomAnchorPos === null) return;

    if (this.dragPosition) {
      this.updateDragPosition();
      return;
    }

    const doc = this.ownerDocument ?? activeDocument;
    const hostRect = this.overlayHost?.getBoundingClientRect() ?? doc.body.getBoundingClientRect();

    const viewportWidth = hostRect.width;

    const scrollDom = this.options.view.scrollDOM;
    const scrollRect = scrollDom?.getBoundingClientRect();
    const sizer = scrollDom?.querySelector(".cm-sizer");
    const sizerRect = sizer?.getBoundingClientRect();

    const { bottomRect, topRect, focusRect } = this.resolveVisibleAnchors(hostRect, scrollRect);

    const defaultWidth = Math.min(
      PANEL_DEFAULT_WIDTH_MAX,
      viewportWidth * PANEL_DEFAULT_WIDTH_RATIO
    );
    const maxWidth = Math.min(PANEL_MAX_WIDTH_MAX, viewportWidth * PANEL_MAX_WIDTH_RATIO);
    const minWidth = Math.min(PANEL_MIN_WIDTH, viewportWidth - PANEL_MARGIN * 2);
    const panelWidth =
      this.resizeSize?.width ?? Math.max(minWidth, Math.min(defaultWidth, maxWidth));
    const panelHeight = this.resizeSize?.height;

    const contentLeft =
      (sizerRect?.left ?? scrollRect?.left ?? hostRect.left + PANEL_MARGIN) - hostRect.left;
    const editorContentWidth =
      sizerRect?.width ?? scrollRect?.width ?? viewportWidth - PANEL_MARGIN * 2;
    const contentRight = contentLeft + editorContentWidth;

    const isCursor =
      this.topAnchorPos !== null &&
      this.bottomAnchorPos !== null &&
      this.topAnchorPos === this.bottomAnchorPos;
    const topCoords =
      typeof this.topAnchorPos === "number"
        ? this.options.view.coordsAtPos(this.topAnchorPos)
        : null;
    const bottomCoords =
      typeof this.bottomAnchorPos === "number"
        ? this.options.view.coordsAtPos(this.bottomAnchorPos)
        : null;
    const caretHeight = Math.min(
      (topCoords?.bottom ?? 0) - (topCoords?.top ?? 0),
      (bottomCoords?.bottom ?? 0) - (bottomCoords?.top ?? 0)
    );
    const isVisualMultiLine =
      !isCursor &&
      !!topCoords &&
      !!bottomCoords &&
      Math.abs(topCoords.top - bottomCoords.top) > Math.max(caretHeight / 2, 2);

    const horizontalAnchor = focusRect ?? bottomRect ?? topRect;
    let left = isVisualMultiLine
      ? contentLeft + (editorContentWidth - panelWidth) / 2
      : horizontalAnchor
        ? horizontalAnchor.left - hostRect.left
        : contentLeft + (editorContentWidth - panelWidth) / 2;
    left = Math.min(left, contentRight - panelWidth);
    left = Math.max(left, contentLeft);
    left = Math.min(left, viewportWidth - PANEL_MARGIN - panelWidth);
    left = Math.max(left, PANEL_MARGIN);

    const visibleTop = (scrollRect?.top ?? hostRect.top) - hostRect.top;
    const visibleBottom = (scrollRect?.bottom ?? hostRect.bottom) - hostRect.top;
    const visibleHeight = visibleBottom - visibleTop;
    const minTop = visibleTop + PANEL_MARGIN;

    updateDynamicStyleClass(this.overlayContainer, "copilot-quick-ask-overlay-pos", {
      width: panelWidth,
      ...(typeof panelHeight === "number" ? { height: panelHeight } : {}),
      left: Math.round(left),
      top: Math.round(minTop),
    });

    const heightForClamp =
      typeof panelHeight === "number"
        ? panelHeight
        : this.overlayContainer.getBoundingClientRect().height || PANEL_MIN_HEIGHT;

    const clampedTop = this.computeVerticalPlacement(
      bottomRect,
      topRect,
      hostRect,
      visibleTop,
      visibleBottom,
      visibleHeight,
      heightForClamp,
      minTop
    );

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

    const doc = this.ownerDocument ?? activeDocument;
    const body = doc.body;

    const cursorMap: Record<ResizeDirection, string> = {
      right: "ew-resize",
      bottom: "ns-resize",
      "bottom-left": "nesw-resize",
      "bottom-right": "nwse-resize",
    };
    body.setCssProps({ "--copilot-resize-cursor": cursorMap[direction] ?? "default" });
    body.classList.add("tw-select-none", "tw-cursor-[var(--copilot-resize-cursor)]");

    doc.addEventListener("mousemove", this.handleResizeMove, true);
    doc.addEventListener("mouseup", this.handleResizeEnd, true);
  };

  private handleResizeMove = (e: MouseEvent): void => {
    if (!this.isResizing || !this.resizeStartRect || !this.resizeStartMouse) return;

    const win = this.ownerWindow ?? window;

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
    this.renderPanel();
  };

  private cleanupResize(): void {
    const win = this.ownerWindow ?? window;

    if (this.resizeRafId !== null) {
      win.cancelAnimationFrame(this.resizeRafId);
      this.resizeRafId = null;
    }

    if (this.isResizing) {
      const doc = this.ownerDocument ?? activeDocument;
      const body = doc.body;
      doc.removeEventListener("mousemove", this.handleResizeMove, true);
      doc.removeEventListener("mouseup", this.handleResizeEnd, true);
      body.classList.remove("tw-select-none", "tw-cursor-[var(--copilot-resize-cursor)]");
      body.setCssProps({ "--copilot-resize-cursor": "" });
    }

    this.isResizing = false;
    this.resizeDirection = null;
    this.resizeStartRect = null;
    this.resizeStartMouse = null;
  }

  private applyResize(clientX: number, clientY: number): void {
    if (!this.resizeStartRect || !this.resizeStartMouse || !this.resizeDirection) return;

    const doc = this.ownerDocument ?? activeDocument;
    const hostRect = this.overlayHost?.getBoundingClientRect() ?? doc.body.getBoundingClientRect();

    const deltaX = clientX - this.resizeStartMouse.x;
    const deltaY = clientY - this.resizeStartMouse.y;

    const startRect = this.resizeStartRect;
    const direction = this.resizeDirection;

    const viewportWidth = hostRect.width;
    const minWidth = Math.min(PANEL_MIN_WIDTH, viewportWidth - PANEL_MARGIN * 2);
    const minHeight = PANEL_MIN_HEIGHT;

    const boundLeft = hostRect.left + PANEL_MARGIN;
    const boundRight = hostRect.right - PANEL_MARGIN;
    const boundBottom = hostRect.bottom - PANEL_MARGIN;

    let nextWidth = startRect.width;
    let nextHeight = startRect.height;
    let nextX: number | undefined;
    let nextY: number | undefined;

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
        nextWidth = startRect.width - deltaX;
        nextHeight = startRect.height + deltaY;
        nextX = startRect.left + deltaX;
        nextY = startRect.top;
        break;
    }

    const maxWidthRight = boundRight - startRect.left;
    const maxWidthLeft = startRect.right - boundLeft;
    const maxHeight = boundBottom - startRect.top;

    if (direction === "bottom-left") {
      nextWidth = Math.max(minWidth, Math.min(nextWidth, maxWidthLeft));
      nextX = startRect.right - nextWidth;
      if (nextX < boundLeft) {
        nextX = boundLeft;
        nextWidth = startRect.right - boundLeft;
      }
    } else {
      nextWidth = Math.max(minWidth, Math.min(nextWidth, maxWidthRight));
    }

    if (involvesHeight) {
      nextHeight = Math.max(minHeight, Math.min(nextHeight, maxHeight));
    }

    const prevHeight = this.resizeSize?.height;
    const nextSize: { width: number; height?: number } = { width: nextWidth };
    if (involvesHeight) {
      nextSize.height = nextHeight;
    } else if (this.hasUserResizedHeight && typeof prevHeight === "number") {
      nextSize.height = prevHeight;
    }
    this.resizeSize = nextSize;

    const prevHasUserResizedHeight = this.hasUserResizedHeight;
    if (involvesHeight) {
      this.hasUserResizedHeight = true;
    }

    if (this.hasUserResizedHeight !== prevHasUserResizedHeight) {
      this.renderPanel();
    }

    if (direction === "bottom-left" && nextX !== undefined) {
      this.dragPosition = { x: nextX, y: nextY ?? startRect.top };
      this.updateDragPosition();
    } else if (this.dragPosition) {
      this.updateDragPosition();
    } else {
      this.schedulePositionUpdate();
    }
  }

  private updateDragPosition(): void {
    if (!this.overlayContainer || !this.dragPosition) return;

    const doc = this.ownerDocument ?? activeDocument;
    const hostRect = this.overlayHost?.getBoundingClientRect() ?? doc.body.getBoundingClientRect();

    const viewportWidth = hostRect.width;

    const defaultWidth = Math.min(
      PANEL_DEFAULT_WIDTH_MAX,
      viewportWidth * PANEL_DEFAULT_WIDTH_RATIO
    );
    const maxWidth = Math.min(PANEL_MAX_WIDTH_MAX, viewportWidth * PANEL_MAX_WIDTH_RATIO);
    const minWidth = Math.min(PANEL_MIN_WIDTH, viewportWidth - PANEL_MARGIN * 2);

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
