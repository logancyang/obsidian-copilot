import { RecentUsageManager } from "@/utils/recentUsageManager";
import { useCallback, useSyncExternalStore } from "react";

export function useRecentUsageManagerRevision<Key extends string>(
  manager: RecentUsageManager<Key> | null | undefined
): number {
  const subscribe = useCallback(
    (onChange: () => void) => manager?.subscribe(onChange) ?? (() => {}),
    [manager]
  );
  const getSnapshot = useCallback(() => manager?.getRevision() ?? 0, [manager]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
