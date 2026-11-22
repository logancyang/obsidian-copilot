import { useCallback } from "react";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";

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
