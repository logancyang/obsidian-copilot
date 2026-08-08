import { RecentUsageManager } from "@/utils/recentUsageManager";
import { useCallback, useSyncExternalStore } from "react";

/**
 * Subscribe to a {@link RecentUsageManager}'s revision so the UI can re-sort when
 * in-memory usage changes — even when the backing list reference is unchanged.
 *
 * Reason: the manager updates its in-memory "last used" timestamps immediately on
 * `touch()` but only throttle-persists to disk (~30s). Sorting purely on the
 * persisted timestamp would show a stale order within the throttle window. Reading
 * this revision as a render dependency forces a re-sort the moment memory changes.
 *
 * Handles a missing manager safely: a stable no-op subscribe and a constant `0`
 * snapshot, so callers can pass `null`/`undefined` without conditional hooks.
 */
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
