import { useCallback } from "react";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";

export function useManagerSubscribe(
  manager: AgentSessionManager | null
): (cb: () => void) => () => void {
  return useCallback(
    (cb: () => void) => {
      if (!manager) return () => {};
      let unsubActive: (() => void) | null = null;
      let lastSession: ReturnType<typeof manager.getActiveSession> = null;
      const rewireActive = (): void => {
        const cur = manager.getActiveSession();
        if (cur === lastSession) return;
        unsubActive?.();
        lastSession = cur;
        unsubActive =
          cur?.subscribe({
            onMessagesChanged: cb,
            onStatusChanged: cb,
            onModelChanged: cb,
            onCurrentPlanChanged: cb,
            onCurrentTodoListChanged: cb,
          }) ?? null;
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
