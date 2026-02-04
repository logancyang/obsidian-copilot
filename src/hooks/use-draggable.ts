import type React from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

interface Position {
  x: number;
  y: number;
}

interface UseDraggableOptions {
  initialPosition?: Position;
  bounds?: "window" | "parent" | null;
  /**
   * Optional external ref for the draggable element.
   * Useful when the element ref is shared with other hooks (e.g., resize).
   */
  dragRef?: React.RefObject<HTMLDivElement>;
  /**
   * Optional getter for the current element position at drag start.
   * Use when the element is positioned outside of React state.
   */
  getPosition?: () => Position;
  /**
   * Called whenever a new position is applied (RAF-throttled).
   * Useful when the caller controls positioning outside the hook.
   */
  onPositionChange?: (position: Position) => void;
  /**
   * Whether to write `left/top` to the DOM.
   * Disable when the element is positioned by an external owner.
   */
  writeToDom?: boolean;
}

/**
 * Clamps a number between the given min/max.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * useDraggable
 *
 * A draggable hook optimized for performance:
 * - Optionally writes `left/top` directly to the DOM (no React re-render on mousemove)
 * - Uses `requestAnimationFrame` to throttle updates
 * - Applies `preventDefault()` + `document.body.style.userSelect = "none"` during drag
 *
 * API is kept compatible:
 * `position, setPosition, isDragging, dragRef, handleMouseDown`
 */
export function useDraggable(options: UseDraggableOptions = {}) {
  const {
    initialPosition = { x: 0, y: 0 },
    bounds = "window",
    dragRef: providedDragRef,
    getPosition,
    onPositionChange,
    writeToDom = true,
  } = options;

  const [position, setPositionState] = useState<Position>(initialPosition);
  const [isDragging, setIsDragging] = useState(false);

  const internalDragRef = useRef<HTMLDivElement>(null);
  const dragRef = providedDragRef ?? internalDragRef;

  const positionRef = useRef<Position>(initialPosition);
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const pendingPositionRef = useRef<Position | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const cleanupDragRef = useRef<((commit: boolean) => void) | null>(null);
  const isMountedRef = useRef(true);

  const previousBodyStyleRef = useRef<{ userSelect: string; cursor: string } | null>(null);

  /**
   * Writes position to the drag element via inline styles.
   */
  const writePositionToDom = useCallback(
    (next: Position): void => {
      if (!writeToDom) return;

      const el = dragRef.current;
      if (!el) return;

      const left = `${next.x}px`;
      const top = `${next.y}px`;

      if (el.style.left !== left) el.style.left = left;
      if (el.style.top !== top) el.style.top = top;
    },
    [dragRef, writeToDom]
  );

  /**
   * Applies bounds (if enabled), updates refs, and optionally writes to DOM.
   */
  const applyPosition = useCallback(
    (raw: Position): Position => {
      let nextX = raw.x;
      let nextY = raw.y;

      const el = dragRef.current;

      if (bounds === "window" && el) {
        const ownerWindow = el.ownerDocument?.defaultView ?? window;
        const rect = el.getBoundingClientRect();
        const maxX = ownerWindow.innerWidth - rect.width;
        const maxY = ownerWindow.innerHeight - rect.height;

        nextX = clamp(nextX, 0, Math.max(0, maxX));
        nextY = clamp(nextY, 0, Math.max(0, maxY));
      } else if (bounds === "parent" && el?.parentElement) {
        const rect = el.getBoundingClientRect();
        const parentRect = el.parentElement.getBoundingClientRect();

        const minX = parentRect.left;
        const minY = parentRect.top;
        const maxX = parentRect.right - rect.width;
        const maxY = parentRect.bottom - rect.height;

        nextX = clamp(nextX, minX, Math.max(minX, maxX));
        nextY = clamp(nextY, minY, Math.max(minY, maxY));
      }

      const next = { x: nextX, y: nextY };
      positionRef.current = next;
      writePositionToDom(next);
      onPositionChange?.(next);
      return next;
    },
    [bounds, dragRef, writePositionToDom, onPositionChange]
  );

  /**
   * Schedules a DOM update on the next animation frame.
   */
  const scheduleApply = useCallback((): void => {
    if (rafIdRef.current != null) return;

    const ownerWindow = dragRef.current?.ownerDocument?.defaultView ?? window;
    rafIdRef.current = ownerWindow.requestAnimationFrame(() => {
      rafIdRef.current = null;

      const pending = pendingPositionRef.current;
      if (!pending) return;

      pendingPositionRef.current = null;
      applyPosition(pending);
    });
  }, [applyPosition, dragRef]);

  /**
   * Compatible setter: updates state + ref, and also writes to DOM immediately.
   * (No throttling here; `setPosition` is expected to be called infrequently.)
   */
  const setPosition = useCallback<React.Dispatch<React.SetStateAction<Position>>>(
    (value) => {
      const base = positionRef.current;
      const next = typeof value === "function" ? value(base) : value;

      positionRef.current = next;
      setPositionState(next);
      writePositionToDom(next);
      onPositionChange?.(next);
    },
    [writePositionToDom, onPositionChange]
  );

  /**
   * Starts dragging: captures pointer offset and installs global listeners.
   */
  const handleMouseDown = useCallback(
    (e: React.MouseEvent): void => {
      // Only respond to left mouse button
      if (e.button !== 0) return;
      e.preventDefault();

      if (cleanupDragRef.current) return;

      setIsDragging(true);

      const current = getPosition ? getPosition() : positionRef.current;
      positionRef.current = current;
      writePositionToDom(current);

      dragOffsetRef.current = {
        x: e.clientX - current.x,
        y: e.clientY - current.y,
      };

      const ownerDocument = dragRef.current?.ownerDocument ?? document;
      const ownerWindow = ownerDocument.defaultView ?? window;
      const body = ownerDocument.body;
      previousBodyStyleRef.current = {
        userSelect: body.style.userSelect,
        cursor: body.style.cursor,
      };

      body.style.userSelect = "none";
      body.style.cursor = "grabbing";

      /**
       * Mouse move handler: updates pending position and schedules RAF apply.
       */
      const handleMouseMove = (event: MouseEvent): void => {
        pendingPositionRef.current = {
          x: event.clientX - dragOffsetRef.current.x,
          y: event.clientY - dragOffsetRef.current.y,
        };
        scheduleApply();
      };

      /**
       * Drag cleanup (commit=true on mouseup; commit=false on unmount safety cleanup).
       */
      const cleanup = (commit: boolean): void => {
        if (cleanupDragRef.current !== cleanup) return;

        ownerDocument.removeEventListener("mousemove", handleMouseMove, true);
        ownerDocument.removeEventListener("mouseup", handleMouseUp, true);

        if (rafIdRef.current != null) {
          ownerWindow.cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }

        const pending = pendingPositionRef.current;
        pendingPositionRef.current = null;

        const finalPosition = pending ? applyPosition(pending) : positionRef.current;

        const previous = previousBodyStyleRef.current;
        if (previous) {
          body.style.userSelect = previous.userSelect;
          body.style.cursor = previous.cursor;
          previousBodyStyleRef.current = null;
        } else {
          body.style.userSelect = "";
          body.style.cursor = "";
        }

        cleanupDragRef.current = null;

        if (commit && isMountedRef.current) {
          setPositionState(finalPosition);
          setIsDragging(false);
        }
      };

      /**
       * Mouse up handler: ends dragging and commits position to React state once.
       */
      const handleMouseUp = (): void => {
        cleanup(true);
      };

      cleanupDragRef.current = cleanup;

      ownerDocument.addEventListener("mousemove", handleMouseMove, true);
      ownerDocument.addEventListener("mouseup", handleMouseUp, true);
    },
    [applyPosition, dragRef, getPosition, scheduleApply, writePositionToDom]
  );

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      cleanupDragRef.current?.(false);
    };
  }, []);

  useLayoutEffect(() => {
    // Keep DOM aligned with the latest ref position even if parent re-renders.
    writePositionToDom(positionRef.current);
  });

  return {
    position,
    setPosition,
    isDragging,
    dragRef,
    handleMouseDown,
  };
}
