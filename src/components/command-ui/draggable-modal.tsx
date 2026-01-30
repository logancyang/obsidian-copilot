import React, { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useDraggable } from "@/hooks/use-draggable";
import { useRafResizable } from "@/hooks/use-resizable";
import { DragHandle } from "./drag-handle";
import { CloseButton } from "./close-button";

const DRAGGABLE_MODAL_DATA_ATTRIBUTE = "data-copilot-draggable-modal";
const DRAGGABLE_MODAL_SELECTOR = `[${DRAGGABLE_MODAL_DATA_ATTRIBUTE}="true"]`;

interface DraggableModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  initialPosition?: { x: number; y: number };
  width?: string;
  /**
   * Enables QuickAsk-style resize handles (bottom edge + corners).
   * Affects both width and height (and may shift the modal horizontally when resizing from the left corner).
   */
  resizable?: boolean;
  /**
   * Minimum modal height in pixels when `resizable` is enabled.
   */
  minHeight?: number;
  /**
   * When true, pressing Escape can close the topmost DraggableModal even if focus is outside any DraggableModal.
   *
   * This keeps the "inner layer consumes Escape first" behavior via `event.defaultPrevented`,
   * while avoiding the "one Escape closes all open modals" issue when multiple DraggableModals are open.
   */
  closeOnEscapeFromOutside?: boolean;
}

/**
 * A draggable modal container with Flexbox layout.
 * Uses flex-none for header and flex-1 for content to ensure stable layout.
 */
export function DraggableModal({
  open,
  onClose,
  children,
  className,
  initialPosition,
  width = "min(500px, 90vw)",
  resizable = false,
  minHeight = 260,
  closeOnEscapeFromOutside = false,
}: DraggableModalProps) {
  const { position, setPosition, dragRef, handleMouseDown, isDragging } = useDraggable({
    initialPosition: initialPosition || {
      x: typeof window !== "undefined" ? (window.innerWidth - 500) / 2 : 100,
      y: typeof window !== "undefined" ? (window.innerHeight - 400) / 2 : 100,
    },
    // Allow dragging outside window bounds (like Quick Ask)
    bounds: null,
  });

  // Resize state (height and width)
  const [heightPx, setHeightPx] = useState<number | null>(null);
  const [widthPx, setWidthPx] = useState<number | null>(null);

  // When resizable, lock an initial height so streaming/content won't "push" the modal taller.
  useLayoutEffect(() => {
    if (!open || !resizable) return;
    if (heightPx !== null && widthPx !== null) return;
    const el = dragRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const maxHeight =
      typeof window !== "undefined" ? Math.floor(window.innerHeight * 0.85) : rect.height;

    if (heightPx === null) {
      setHeightPx(Math.min(maxHeight, Math.max(minHeight, rect.height)));
    }
    if (widthPx === null) {
      setWidthPx(rect.width);
    }
  }, [open, resizable, heightPx, widthPx, minHeight, dragRef]);

  // Auto-expand height when minHeight increases (e.g., ContentArea becomes visible)
  useEffect(() => {
    if (!resizable || heightPx === null) return;
    if (heightPx < minHeight) {
      setHeightPx(minHeight);
    }
  }, [resizable, minHeight, heightPx]);

  const getResizeRect = useCallback(() => {
    return dragRef.current?.getBoundingClientRect() ?? null;
  }, [dragRef]);

  const getResizeConstraints = useCallback(() => {
    const maxHeight =
      typeof window !== "undefined"
        ? Math.floor(window.innerHeight * 0.85)
        : Number.POSITIVE_INFINITY;
    return { minWidth: 300, minHeight, maxHeight };
  }, [minHeight]);

  const applyResize = useCallback(
    (next: { width: number; height: number; x?: number }) => {
      setHeightPx((prev) => (prev === next.height ? prev : next.height));
      setWidthPx((prev) => (prev === next.width ? prev : next.width));
      if (typeof next.x === "number") {
        setPosition((prev) => (prev.x === next.x ? prev : { ...prev, x: next.x as number }));
      }
    },
    [setPosition]
  );

  const { isResizing, handleResizeStart } = useRafResizable({
    enabled: resizable,
    getRect: getResizeRect,
    getConstraints: getResizeConstraints,
    onResize: applyResize,
  });

  // Handle Escape key
  useEffect(() => {
    if (!open) return;

    const ownerDocument = dragRef.current?.ownerDocument ?? document;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Respect defaultPrevented to let internal components (e.g., Lexical typeahead, Radix menus) consume Escape first
      if (e.key !== "Escape") return;
      if (e.defaultPrevented) return;

      const modalEl = dragRef.current;
      if (!modalEl) return;

      const activeEl = ownerDocument.activeElement;
      const activeModalEl =
        activeEl instanceof Element ? activeEl.closest(DRAGGABLE_MODAL_SELECTOR) : null;

      // If focus is inside some DraggableModal, only that modal should close.
      if (activeModalEl) {
        if (activeModalEl !== modalEl) return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      // Focus is not inside any DraggableModal. Optionally close the topmost DraggableModal.
      if (!closeOnEscapeFromOutside) return;

      const modals = Array.from(
        ownerDocument.querySelectorAll<HTMLElement>(DRAGGABLE_MODAL_SELECTOR)
      );
      const topmostModal = modals[modals.length - 1];
      if (topmostModal !== modalEl) return;

      e.preventDefault();
      e.stopPropagation();
      onClose();
    };

    ownerDocument.addEventListener("keydown", handleKeyDown);

    return () => {
      ownerDocument.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose, dragRef, closeOnEscapeFromOutside]);

  if (!open) return null;

  return (
    <div
      ref={dragRef}
      {...{ [DRAGGABLE_MODAL_DATA_ATTRIBUTE]: "true" }}
      className={cn(
        // Positioning and z-index
        "tw-fixed tw-z-popover",
        // Flexbox layout for stable structure
        "tw-flex tw-flex-col",
        // Visual styling
        "tw-border tw-border-solid tw-border-border tw-bg-primary",
        resizable ? "tw-rounded-t-lg tw-shadow-2xl" : "tw-rounded-lg tw-shadow-2xl",
        // Responsive constraints
        "tw-max-h-[85vh]",
        // Hover group for QuickAsk-style corner indicators
        resizable && "tw-group",
        // Interaction states
        isDragging && "tw-cursor-grabbing tw-select-none",
        isResizing && "tw-select-none",
        className
      )}
      style={{
        left: position.x,
        top: position.y,
        width: resizable && widthPx !== null ? widthPx : width,
        ...(resizable && heightPx !== null ? { height: heightPx } : {}),
      }}
    >
      {/* Header: drag handle + close button (flex-none) */}
      <div className="tw-relative tw-flex-none">
        <DragHandle onMouseDown={handleMouseDown} />
        <CloseButton onClose={onClose} />
      </div>

      {/* Main content container (flex-1 with overflow handling) */}
      {/* min-h-0 is critical: allows flex children to shrink below content size */}
      <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-overflow-hidden">{children}</div>

      {/* Resize handles - QuickAsk style */}
      {resizable && (
        <>
          <div
            className="tw-absolute tw-bottom-0 tw-left-0 tw-h-1 tw-w-full tw-cursor-ns-resize"
            onMouseDown={handleResizeStart("bottom")}
          />
          <div
            className="quick-ask-resize-indicator-left tw-absolute tw-bottom-0 tw-left-0 tw-size-3 tw-cursor-nesw-resize"
            onMouseDown={handleResizeStart("bottom-left")}
          />
          <div
            className="quick-ask-resize-indicator-right tw-absolute tw-bottom-0 tw-right-0 tw-z-[10] tw-size-3 tw-cursor-nwse-resize"
            onMouseDown={handleResizeStart("bottom-right")}
          />
        </>
      )}
    </div>
  );
}
