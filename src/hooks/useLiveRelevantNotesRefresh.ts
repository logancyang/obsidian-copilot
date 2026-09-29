import { TFile, type App } from "obsidian";
import { useEffect, useRef } from "react";

export const LIVE_REFRESH_INTERVAL_MS = 5000;

export const LIVE_REFRESH_WINDOW_MS = 20000;

interface UseLiveRelevantNotesRefreshOptions {
  app: App;
  enabled: boolean;
  filePath: string | undefined;
  onRefresh: () => void;
}

/**
 * Re-query relevant notes while the active note is being written. Each write opens a window
 * during which the note is re-queried, because Miyo re-embeds a few seconds after the file
 * lands on disk. https://github.com/Brevilabs/obsidian-copilot-private/issues/362
 *
 * @param options - Runtime access, the enablement flag, the note being related,
 *   and the callback that re-runs the query.
 */
export function useLiveRelevantNotesRefresh({
  app,
  enabled,
  filePath,
  onRefresh,
}: UseLiveRelevantNotesRefreshOptions): void {
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const wasEnabledRef = useRef(enabled);

  useEffect(() => {
    const justEnabled = enabled && !wasEnabledRef.current;
    wasEnabledRef.current = enabled;
    if (!enabled || !filePath) return;

    let deadline = 0;
    let interval: number | null = null;

    const stopPolling = () => {
      if (interval === null) return;
      window.clearInterval(interval);
      interval = null;
    };

    const startPolling = () => {
      if (interval !== null) return;
      interval = window.setInterval(() => {
        if (Date.now() > deadline) {
          stopPolling();
          return;
        }
        onRefreshRef.current();
      }, LIVE_REFRESH_INTERVAL_MS);
    };

    const openWindow = () => {
      deadline = Date.now() + LIVE_REFRESH_WINDOW_MS;
      startPolling();
    };

    const eventRef = app.vault.on("modify", (file) => {
      if (!(file instanceof TFile) || file.path !== filePath) return;
      openWindow();
    });

    if (justEnabled) {
      onRefreshRef.current();
      openWindow();
    }

    return () => {
      app.vault.offref(eventRef);
      stopPolling();
    };
  }, [app, enabled, filePath]);
}
