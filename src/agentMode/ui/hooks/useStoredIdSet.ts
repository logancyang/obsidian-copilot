import { logWarn } from "@/logger";
import type { App } from "obsidian";
import { useCallback, useState } from "react";

// Vault-scoped, per-device storage keeps UI state out of the synced settings file.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/802
function readStoredIds(app: App, storageKey: string): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(String(app.loadLocalStorage(storageKey)));
    if (Array.isArray(parsed) && parsed.every((id) => typeof id === "string")) {
      return new Set(parsed);
    }
  } catch {
    return new Set();
  }
  return new Set();
}

function saveStoredIds(app: App, storageKey: string, ids: ReadonlySet<string>): void {
  try {
    app.saveLocalStorage(storageKey, JSON.stringify([...ids]));
  } catch (e) {
    logWarn("Failed to persist sessions sidebar state", e);
  }
}

export function useStoredIdSet(app: App, storageKey: string) {
  const [ids, setIds] = useState(() => readStoredIds(app, storageKey));

  const toggle = useCallback(
    (id: string) => {
      setIds((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        saveStoredIds(app, storageKey, next);
        return next;
      });
    },
    [app, storageKey]
  );

  const replace = useCallback(
    (orderedIds: readonly string[]) => {
      const next = new Set(orderedIds);
      saveStoredIds(app, storageKey, next);
      setIds(next);
    },
    [app, storageKey]
  );

  return { ids, toggle, replace };
}
