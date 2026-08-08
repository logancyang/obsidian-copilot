import { useCallback } from "react";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";

/**
 * Build a `useSyncExternalStore` `subscribe` that fans out manager,
 * preloader-cache, and active-session UI-state notifications to a single
 * callback. Re-wires the active-session listener whenever the manager's
 * active session changes so the snapshot stays current after tab switches.
 */
export function useManagerSubscribe(
  manager: AgentSessionManager | null
): (cb: () => void) => () => void {
  return useCallback(
    (cb: () => void) => {
      if (!manager) return () => {};
      let unsubActive: (() => void) | null = null;
      let lastUI: ReturnType<typeof manager.getActiveChatUIState> = null;
      const rewireActive = (): void => {
        const cur = manager.getActiveChatUIState();
        if (cur === lastUI) return;
        unsubActive?.();
        lastUI = cur;
        unsubActive = cur?.subscribe(cb) ?? null;
      };
      rewireActive();
      const unsubManager = manager.subscribe(() => {
        rewireActive();
        cb();
      });
      const unsubCache = manager.subscribeModelCache(cb);
      return () => {
        unsubManager();
        unsubCache();
        unsubActive?.();
      };
    },
    [manager]
  );
}
