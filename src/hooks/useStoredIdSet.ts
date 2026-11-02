import type { App } from "obsidian";
import { useCallback, useState } from "react";

// Vault-scoped, per-device storage keeps UI state out of the synced settings file.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/802
function readStoredIds(app: App, storageKey: string): ReadonlySet<string> {
  const stored = app.loadLocalStorage(storageKey);
  return new Set(Array.isArray(stored) ? stored : []);
}

export function useStoredIdSet(app: App, storageKey: string) {
  const [ids, setIds] = useState(() => readStoredIds(app, storageKey));

  const toggle = useCallback(
    (id: string) => {
      setIds((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        app.saveLocalStorage(storageKey, [...next]);
        return next;
      });
    },
    [app, storageKey]
  );

  const replace = useCallback(
    (orderedIds: readonly string[]) => {
      const next = new Set(orderedIds);
      app.saveLocalStorage(storageKey, [...next]);
      setIds(next);
    },
    [app, storageKey]
  );

  return { ids, toggle, replace };
}
