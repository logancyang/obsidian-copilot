import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

export type ResizeDirection = "right" | "bottom" | "bottom-left" | "bottom-right";

export interface ResizeConstraints {
  minWidth: number;
  minHeight: number;
  maxWidth?: number;
  maxHeight?: number;
}

export interface ResizeUpdate {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

interface ResizeStartState {
  direction: ResizeDirection;
  startClientX: number;
  startClientY: number;
  width: number;
  height: number;
  left: number;
  top: number;
  right: number;
}

export interface UseRafResizableOptions {
  enabled?: boolean;
  getRect: () => DOMRect | null;
  getConstraints?: () => ResizeConstraints;
  onResize: (next: ResizeUpdate) => void;
}

export interface UseRafResizableResult {
  isResizing: boolean;
  handleResizeStart: (direction: ResizeDirection) => (e: React.MouseEvent) => void;
}

export function useRafResizable(options: UseRafResizableOptions): UseRafResizableResult {
  const { enabled = true, getRect, getConstraints, onResize } = options;

  const [isResizing, setIsResizing] = useState(false);
  const startRef = useRef<ResizeStartState | null>(null);
  const ownerDocumentRef = useRef<Document | null>(null);
  const ownerWindowRef = useRef<Window | null>(null);

  const rafIdRef = useRef<number | null>(null);
  const pendingRef = useRef<ResizeUpdate | null>(null);

  const onResizeRef = useRef(onResize);
  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  const getConstraintsRef = useRef(getConstraints);
  useEffect(() => {
    getConstraintsRef.current = getConstraints;
  }, [getConstraints]);

  const handleResizeStart = useCallback(
    (direction: ResizeDirection) =>
      (e: React.MouseEvent): void => {
        if (!enabled) return;

        const rect = getRect();
        if (!rect) return;

        const targetElement = e.currentTarget as HTMLElement | null;
        const ownerDoc = targetElement?.doc ?? activeDocument;
        ownerDocumentRef.current = ownerDoc;
        ownerWindowRef.current = ownerDoc.defaultView ?? window;

        startRef.current = {
          direction,
          startClientX: e.clientX,
          startClientY: e.clientY,
          width: rect.width,
          height: rect.height,
          left: rect.left,
          top: rect.top,
          right: rect.right,
        };

        setIsResizing(true);
        e.preventDefault();
        e.stopPropagation();
      },
    [enabled, getRect]
  );

  useEffect(() => {
    if (!isResizing) return;

    const start = startRef.current;
    if (!start) return;

    const direction = start.direction;
    const cursor =
      direction === "right"
        ? "ew-resize"
        : direction === "bottom"
          ? "ns-resize"
          : direction === "bottom-left"
            ? "nesw-resize"
            : "nwse-resize";

    const ownerDocument = ownerDocumentRef.current ?? activeDocument;
    const ownerWindow = ownerWindowRef.current ?? window;
    const body = ownerDocument.body;
    body.setCssProps({ "--copilot-resize-cursor": cursor });
    body.classList.add("tw-select-none", "tw-cursor-[var(--copilot-resize-cursor)]");

    const cancelRaf = (): void => {
      if (rafIdRef.current === null) return;
      ownerWindow.cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    };

    const flushPending = (): void => {
      const pending = pendingRef.current;
      if (!pending) return;
      pendingRef.current = null;
      onResizeRef.current(pending);
    };

    const scheduleFlush = (): void => {
      if (rafIdRef.current !== null) return;
      rafIdRef.current = ownerWindow.requestAnimationFrame(() => {
        rafIdRef.current = null;
        flushPending();
      });
    };

    const handleMouseMove = (event: MouseEvent): void => {
      const currentStart = startRef.current;
      if (!currentStart) return;

      const deltaX = event.clientX - currentStart.startClientX;
      const deltaY = event.clientY - currentStart.startClientY;

      const constraints = getConstraintsRef.current?.() ?? {
        minWidth: 0,
        minHeight: 0,
      };

      const minWidth = constraints.minWidth;
      const minHeight = constraints.minHeight;
      const maxWidth = constraints.maxWidth ?? Number.POSITIVE_INFINITY;
      const maxHeight = constraints.maxHeight ?? Number.POSITIVE_INFINITY;

      let nextWidth = currentStart.width;
      let nextHeight = currentStart.height;
      let nextX: number | undefined;
      let nextY: number | undefined;

      if (direction === "right" || direction === "bottom-right") {
        nextWidth = Math.min(maxWidth, Math.max(minWidth, currentStart.width + deltaX));
      }

      if (direction === "bottom-left") {
        nextWidth = Math.min(maxWidth, Math.max(minWidth, currentStart.width - deltaX));
        nextX = currentStart.right - nextWidth;
        nextY = currentStart.top;
      }

      if (direction === "bottom" || direction === "bottom-right" || direction === "bottom-left") {
        nextHeight = Math.min(maxHeight, Math.max(minHeight, currentStart.height + deltaY));
      }

      pendingRef.current =
        nextX === undefined
          ? { width: nextWidth, height: nextHeight }
          : { width: nextWidth, height: nextHeight, x: nextX, y: nextY };

      scheduleFlush();
    };

    const finish = (): void => {
      cancelRaf();
      flushPending();

      ownerDocument.removeEventListener("mousemove", handleMouseMove, true);
      ownerDocument.removeEventListener("mouseup", handleMouseUp, true);

      body.classList.remove("tw-select-none", "tw-cursor-[var(--copilot-resize-cursor)]");
      body.setCssProps({ "--copilot-resize-cursor": "" });

      startRef.current = null;
      setIsResizing(false);
    };

    const handleMouseUp = (): void => {
      finish();
    };

    ownerDocument.addEventListener("mousemove", handleMouseMove, true);
    ownerDocument.addEventListener("mouseup", handleMouseUp, true);

    return () => {
      cancelRaf();
      pendingRef.current = null;
      startRef.current = null;

      ownerDocument.removeEventListener("mousemove", handleMouseMove, true);
      ownerDocument.removeEventListener("mouseup", handleMouseUp, true);

      body.classList.remove("tw-select-none", "tw-cursor-[var(--copilot-resize-cursor)]");
      body.setCssProps({ "--copilot-resize-cursor": "" });
    };
  }, [isResizing]);

  return { isResizing, handleResizeStart };
}
