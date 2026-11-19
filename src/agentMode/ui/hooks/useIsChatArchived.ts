import { useApp } from "@/context";
import { parseChatTimestamp } from "@/utils/chatHistoryUtils";
import { useCallback, useSyncExternalStore } from "react";

export function useIsChatArchived(notePath: string | undefined): boolean {
  const app = useApp();
  const subscribe = useCallback(
    (onChange: () => void) => {
      const ref = app.metadataCache.on("changed", (file) => {
        if (file.path === notePath) onChange();
      });
      return () => app.metadataCache.offref(ref);
    },
    [app, notePath]
  );
  const read = useCallback(
    () =>
      notePath !== undefined &&
      parseChatTimestamp(app.metadataCache.getCache(notePath)?.frontmatter?.archivedAt) !==
        undefined,
    [app, notePath]
  );
  return useSyncExternalStore(subscribe, read);
}
