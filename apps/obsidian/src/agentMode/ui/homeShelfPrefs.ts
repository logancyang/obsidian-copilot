import { logWarn } from "@/logger";
import type { App } from "obsidian";
import { useCallback, useState } from "react";

export const HOME_SHELF_TAB_STORAGE_KEY = "copilot:home-shelf-tab:v1";
export const PROJECT_SHELF_TAB_STORAGE_KEY = "copilot:project-shelf-tab:v1";

function loadPref(app: App, key: string): string | null {
  try {
    const value = app.loadLocalStorage(key);
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function getHomeShelfTab(app: App, storageKey: string): string | null {
  return loadPref(app, storageKey);
}

export function setHomeShelfTab(app: App, storageKey: string, id: string): void {
  try {
    app.saveLocalStorage(storageKey, id);
  } catch (e) {
    logWarn("Failed to persist home shelf tab", e);
  }
}

export function useHomeShelfTab(
  app: App,
  storageKey: string
): [string | null, (id: string) => void] {
  const [tab, setTab] = useState<string | null>(() => getHomeShelfTab(app, storageKey));
  const selectTab = useCallback(
    (id: string) => {
      setTab(id);
      setHomeShelfTab(app, storageKey, id);
    },
    [app, storageKey]
  );
  return [tab, selectTab];
}
