import { useEffect, useState } from "react";
import { Platform } from "obsidian";

import { getWebViewerService } from "@/services/webViewerService/webViewerServiceSingleton";
import type { ActiveWebTabStateSnapshot } from "@/services/webViewerService/webViewerServiceTypes";

const EMPTY_ACTIVE_WEB_TAB_STATE: ActiveWebTabStateSnapshot = {
  activeWebTabForMentions: null,
  activeOrLastWebTab: null,
};

/**
 * React hook for subscribing to the single-source Active Web Tab snapshot.
 * This hook provides unified access to Active Web Tab state for all UI components.
 *
 * @returns ActiveWebTabStateSnapshot containing:
 *   - activeWebTabForMentions: For @mention search "Active Web Tab" option
 *   - activeOrLastWebTab: For pill display (active or last active tab)
 */
export function useActiveWebTabState(): ActiveWebTabStateSnapshot {
  const [state, setState] = useState<ActiveWebTabStateSnapshot>(() => {
    if (!Platform.isDesktopApp) {
      return EMPTY_ACTIVE_WEB_TAB_STATE;
    }
    try {
      return getWebViewerService(app).getActiveWebTabState();
    } catch {
      return EMPTY_ACTIVE_WEB_TAB_STATE;
    }
  });

  useEffect(() => {
    if (!Platform.isDesktopApp) {
      setState(EMPTY_ACTIVE_WEB_TAB_STATE);
      return;
    }

    let unsubscribe: (() => void) | undefined;
    try {
      const service = getWebViewerService(app);
      // Get initial state
      setState(service.getActiveWebTabState());
      // Subscribe to updates
      unsubscribe = service.subscribeActiveWebTabState(setState);
    } catch {
      setState(EMPTY_ACTIVE_WEB_TAB_STATE);
    }

    return () => {
      unsubscribe?.();
    };
  }, []);

  return state;
}
