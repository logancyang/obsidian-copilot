import type CopilotPlugin from "@/main";
import { useCallback, useSyncExternalStore } from "react";

type CopilotPlusCatalogSnapshot = ReturnType<CopilotPlugin["copilotPlusSync"]["getSnapshot"]>;

const EMPTY_MODELS = Object.freeze([]);
const UNAVAILABLE_SNAPSHOT: CopilotPlusCatalogSnapshot = Object.freeze({
  status: "error",
  models: EMPTY_MODELS,
});

/**
 * Subscribe React surfaces to the current plugin lifecycle's live Plus catalog.
 * Tests and pre-onload renderers without a queue receive a stable unavailable
 * snapshot instead of accidentally reading persisted models as live state.
 *
 * @param plugin - Plugin lifecycle that owns the catalog request queue.
 */
export function useCopilotPlusCatalog(plugin: CopilotPlugin): CopilotPlusCatalogSnapshot {
  const queue = plugin.copilotPlusSync;
  const subscribe = useCallback(
    (listener: () => void) => queue?.subscribe(listener) ?? (() => undefined),
    [queue]
  );
  const getSnapshot = useCallback(() => queue?.getSnapshot() ?? UNAVAILABLE_SNAPSHOT, [queue]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
