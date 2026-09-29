import { useRef, useCallback, useEffect } from "react";

export function useRafThrottledCallback<T extends (...args: unknown[]) => void>(callback: T): T {
  const callbackRef = useRef(callback);
  const frameRef = useRef<number | null>(null);
  const lastArgsRef = useRef<Parameters<T> | null>(null);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

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

      frameRef.current = window.requestAnimationFrame(() => {
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
