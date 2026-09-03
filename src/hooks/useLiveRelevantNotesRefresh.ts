import { TFile, type App } from "obsidian";
import { useEffect, useRef } from "react";

/**
 * How often a dirty note is re-queried. Miyo answers a related search in a few
 * milliseconds, so the interval is set by how fast its index can move rather
 * than by request cost.
 */
export const LIVE_REFRESH_INTERVAL_MS = 5000;

/**
 * How long after the last write the note keeps being re-queried. Miyo debounces
 * its file watcher for three seconds and then embeds, so a single poll placed
 * right after a write regularly lands before the new vectors exist. The window
 * spans several polls so the settled ranking is always picked up, then goes
 * quiet.
 */
export const LIVE_REFRESH_WINDOW_MS = 20000;

interface UseLiveRelevantNotesRefreshOptions {
  app: App;
  /** Whether the user has live update switched on for the pane. */
  enabled: boolean;
  /** Vault path of the note being related, or undefined when there is none. */
  filePath: string | undefined;
  /** Re-run the relevant-notes query without disturbing the rendered rows. */
  onRefresh: () => void;
}

/**
 * Re-query relevant notes while the active note is being written.
 *
 * Polling is gated on Obsidian actually writing the note: with no write there
 * are no new embeddings to fetch, so an untouched note costs nothing. Each
 * write opens a window during which the note is re-queried, because Miyo
 * re-embeds a few seconds after the file lands on disk.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/362
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
  // The callback identity changes on every render of the calling component, but
  // resubscribing to vault events on each render would drop pending state.
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
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

    const eventRef = app.vault.on("modify", (file) => {
      if (!(file instanceof TFile) || file.path !== filePath) return;
      deadline = Date.now() + LIVE_REFRESH_WINDOW_MS;
      startPolling();
    });

    return () => {
      app.vault.offref(eventRef);
      stopPolling();
    };
  }, [app, enabled, filePath]);
}
