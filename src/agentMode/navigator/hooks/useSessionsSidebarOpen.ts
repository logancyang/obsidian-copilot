import { isNavigatorEnabled } from "@/agentMode/navigator/navigatorEntitlement";
import { SESSIONS_SIDEBAR_VIEWTYPE } from "@/constants";
import { subscribeToEntitlementChange } from "@/plusUtils";
import type { App } from "obsidian";
import { useCallback, useSyncExternalStore } from "react";

export function isSessionsSidebarOpen(app: App): boolean {
  // A Navigator leaf blocked for a user without preview access must not hide the tab strip.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/819
  return (
    app.workspace.getLeavesOfType(SESSIONS_SIDEBAR_VIEWTYPE).length > 0 &&
    isNavigatorEnabled() !== false
  );
}

export function useSessionsSidebarOpen(app: App): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const ref = app.workspace.on("layout-change", onChange);
      const unsubscribeEntitlement = subscribeToEntitlementChange(onChange);
      return () => {
        app.workspace.offref(ref);
        unsubscribeEntitlement();
      };
    },
    [app]
  );
  const getSnapshot = useCallback(() => isSessionsSidebarOpen(app), [app]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
