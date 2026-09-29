import type React from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

interface Position {
  x: number;
  y: number;
}

interface UseDraggableOptions {
  initialPosition?: Position;
  bounds?: "window" | "parent" | null;
  dragRef?: React.RefObject<HTMLDivElement>;
  getPosition?: () => Position;
  onPositionChange?: (position: Position) => void;
  writeToDom?: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

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

  const writePositionToDom = useCallback(
    (next: Position): void => {
      if (!writeToDom) return;

      const el = dragRef.current;
      if (!el) return;

      el.setCssProps({
        "--copilot-drag-x": `${next.x}px`,
        "--copilot-drag-y": `${next.y}px`,
      });
    },
    [dragRef, writeToDom]
  );

  const applyPosition = useCallback(
    (raw: Position): Position => {
      let nextX = raw.x;
      let nextY = raw.y;

      const el = dragRef.current;

      if (bounds === "window" && el) {
        const ownerWindow = el.win;
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

  const scheduleApply = useCallback((): void => {
    if (rafIdRef.current != null) return;

    const ownerWindow = dragRef.current?.win ?? window;
    rafIdRef.current = ownerWindow.requestAnimationFrame(() => {
      rafIdRef.current = null;

      const pending = pendingPositionRef.current;
      if (!pending) return;

      pendingPositionRef.current = null;
      applyPosition(pending);
    });
  }, [applyPosition, dragRef]);

  useLayoutEffect(() => {
    writePositionToDom(positionRef.current);
  }, [writePositionToDom]);

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

  const handleMouseDown = useCallback(
    (e: React.MouseEvent): void => {
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

      const ownerDocument = dragRef.current?.doc ?? activeDocument;
      const ownerWindow = ownerDocument.defaultView ?? window;
      const body = ownerDocument.body;

      body.classList.add("tw-select-none", "tw-cursor-grabbing");

      const handleMouseMove = (event: MouseEvent): void => {
        pendingPositionRef.current = {
          x: event.clientX - dragOffsetRef.current.x,
          y: event.clientY - dragOffsetRef.current.y,
        };
        scheduleApply();
      };

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

        body.classList.remove("tw-select-none", "tw-cursor-grabbing");

        cleanupDragRef.current = null;

        if (commit && isMountedRef.current) {
          setPositionState(finalPosition);
          setIsDragging(false);
        }
      };

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
