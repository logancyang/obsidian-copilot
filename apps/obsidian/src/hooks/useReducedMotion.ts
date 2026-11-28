import { useCallback, useMemo, useSyncExternalStore } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function useReducedMotion(): boolean {
  const mediaQuery = useMemo(() => window.matchMedia(REDUCED_MOTION_QUERY), []);
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      mediaQuery.addEventListener("change", onStoreChange);
      return () => mediaQuery.removeEventListener("change", onStoreChange);
    },
    [mediaQuery]
  );
  const getSnapshot = useCallback(() => mediaQuery.matches, [mediaQuery]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
