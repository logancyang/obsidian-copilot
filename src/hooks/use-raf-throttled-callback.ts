/**
 * useRafThrottledCallback - Shared RAF-throttled callback hook.
 * Returns a callback that is throttled to at most once per animation frame.
 * The latest arguments are always used, suitable for streaming UI updates.
 */

import { useRef, useCallback, useEffect } from "react";

/**
 * Returns a callback that is throttled to at most once per animation frame.
 * The latest arguments are always used, suitable for streaming UI updates.
 * Includes cleanup on unmount to prevent late state updates.
 */
export function useRafThrottledCallback<T extends (...args: unknown[]) => void>(callback: T): T {
  const callbackRef = useRef(callback);
  const frameRef = useRef<number | null>(null);
  const lastArgsRef = useRef<Parameters<T> | null>(null);

  // Keep callback ref up to date
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // Cancel pending RAF on unmount
  useEffect(() => {
    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, []);

  return useCallback(
    ((...args: Parameters<T>) => {
      lastArgsRef.current = args;

      if (frameRef.current !== null) return;

      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        const latestArgs = lastArgsRef.current;
        if (latestArgs) {
          callbackRef.current(...latestArgs);
        }
      });
    }) as T,
    []
  );
}
