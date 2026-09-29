import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
  resizable?: boolean;
  minHeight?: number;
  closeOnEscapeFromOutside?: boolean;
  anchorBottom?: number;
}

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
  anchorBottom,
}: DraggableModalProps) {
  const {
    position,
    setPosition,
    dragRef,
    handleMouseDown: rawHandleMouseDown,
    isDragging,
  } = useDraggable({
    initialPosition: initialPosition || {
      x: typeof window !== "undefined" ? (window.innerWidth - 500) / 2 : 100,
      y: typeof window !== "undefined" ? (window.innerHeight - 400) / 2 : 100,
    },
    bounds: null,
  });

  const isManualPositionRef = useRef(false);
  const pendingDragCleanupRef = useRef<(() => void) | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const ownerDoc = (e.currentTarget as HTMLElement).doc;
      const startX = e.clientX;
      const startY = e.clientY;

      pendingDragCleanupRef.current?.();

      const cleanup = () => {
        ownerDoc.removeEventListener("mousemove", onMove, true);
        ownerDoc.removeEventListener("mouseup", onUp, true);
        if (pendingDragCleanupRef.current === cleanup) {
          pendingDragCleanupRef.current = null;
        }
      };

      const onMove = (ev: MouseEvent) => {
        if (Math.abs(ev.clientX - startX) < 2 && Math.abs(ev.clientY - startY) < 2) return;
        isManualPositionRef.current = true;
        cleanup();
      };

      const onUp = () => cleanup();

      ownerDoc.addEventListener("mousemove", onMove, true);
      ownerDoc.addEventListener("mouseup", onUp, true);
      pendingDragCleanupRef.current = cleanup;

      rawHandleMouseDown(e);
    },
    [rawHandleMouseDown]
  );

  const [heightPx, setHeightPx] = useState<number | null>(null);
  const [widthPx, setWidthPx] = useState<number | null>(null);

  const [prevOpen, setPrevOpen] = useState(open);
  if (open && !prevOpen) {
    setPrevOpen(true);
    setHeightPx(null);
    setWidthPx(null);
  } else if (!open && prevOpen) {
    setPrevOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    pendingDragCleanupRef.current?.();
    pendingDragCleanupRef.current = null;
    isManualPositionRef.current = false;
    if (initialPosition) {
      setPosition(initialPosition);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally only on open transitions

  useEffect(() => {
    return () => {
      pendingDragCleanupRef.current?.();
      pendingDragCleanupRef.current = null;
    };
  }, []);

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

  const effectiveHeight = heightPx === null ? null : Math.max(heightPx, minHeight);

  useLayoutEffect(() => {
    if (anchorBottom === undefined || isManualPositionRef.current) return;
    if (effectiveHeight === null) return;

    const newY = Math.max(12, anchorBottom - effectiveHeight);
    if (Math.abs(position.y - newY) < 1) return;

    setPosition({ x: position.x, y: newY });
  }, [anchorBottom, effectiveHeight, position.x, position.y, setPosition]);

  useLayoutEffect(() => {
    if (anchorBottom !== undefined || isManualPositionRef.current) return;
    if (effectiveHeight === null) return;

    const ownerWindow = dragRef.current?.win ?? window;
    const maxY = ownerWindow.innerHeight - 12 - effectiveHeight;
    const newY = Math.max(12, Math.min(position.y, maxY));
    if (Math.abs(position.y - newY) < 1) return;

    setPosition({ x: position.x, y: newY });
  }, [anchorBottom, effectiveHeight, position.x, position.y, setPosition, dragRef]);

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
      isManualPositionRef.current = true;
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

  useEffect(() => {
    if (!open) return;

    const ownerDocument = dragRef.current?.doc ?? activeDocument;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (e.defaultPrevented) return;

      const modalEl = dragRef.current;
      if (!modalEl) return;

      const activeEl = ownerDocument.activeElement;
      const activeModalEl =
        activeEl instanceof Element ? activeEl.closest(DRAGGABLE_MODAL_SELECTOR) : null;

      if (activeModalEl) {
        if (activeModalEl !== modalEl) return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

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
        "tw-fixed tw-z-popover",
        "tw-left-[var(--copilot-drag-x,0px)] tw-top-[var(--copilot-drag-y,0px)]",
        "tw-flex tw-flex-col",
        "tw-border tw-border-solid tw-border-border tw-bg-primary",
        resizable ? "tw-rounded-t-lg tw-shadow-2xl" : "tw-rounded-lg tw-shadow-2xl",
        "tw-max-h-[85vh]",
        resizable && "tw-group",
        isDragging && "tw-cursor-grabbing tw-select-none",
        isResizing && "tw-select-none",
        className
      )}
      style={{
        width: resizable && widthPx !== null ? widthPx : width,
        ...(resizable && effectiveHeight !== null ? { height: effectiveHeight } : {}),
      }}
    >
      <div className="tw-relative tw-flex-none">
        <DragHandle onMouseDown={handleMouseDown} />
        <CloseButton onClose={onClose} />
      </div>

      <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-overflow-hidden">{children}</div>

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
