import { SESSIONS_SIDEBAR_VIEWTYPE } from "@/constants";
import { useIsPaidUser } from "@/plusUtils";
import type { App } from "obsidian";
import { useCallback, useSyncExternalStore } from "react";

export function useSessionsSidebarOpen(app: App): boolean {
  // A Navigator leaf blocked for a user without Plus must not hide the tab strip.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/813
  const isPlusLocked = useIsPaidUser() === false;
  const subscribe = useCallback(
    (onChange: () => void) => {
      const ref = app.workspace.on("layout-change", onChange);
      return () => app.workspace.offref(ref);
    },
    [app]
  );
  const getSnapshot = useCallback(
    () => app.workspace.getLeavesOfType(SESSIONS_SIDEBAR_VIEWTYPE).length > 0,
    [app]
  );
  return useSyncExternalStore(subscribe, getSnapshot) && !isPlusLocked;
}
