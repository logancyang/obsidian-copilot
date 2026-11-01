import { logWarn } from "@/logger";
import type { App } from "obsidian";
import { useCallback, useState } from "react";

const STORAGE_KEY = "copilot:sessions-sidebar-expanded-projects:v1";

// Vault-scoped, per-device storage keeps UI state out of the synced settings file.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/802
function readExpandedProjectIds(app: App): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(String(app.loadLocalStorage(STORAGE_KEY)));
    if (Array.isArray(parsed) && parsed.every((id) => typeof id === "string")) {
      return new Set(parsed);
    }
  } catch {
    return new Set();
  }
  return new Set();
}

export function useExpandedProjectIds(app: App) {
  const [expandedProjectIds, setExpandedProjectIds] = useState(() => readExpandedProjectIds(app));

  const toggleProject = useCallback(
    (projectId: string) => {
      setExpandedProjectIds((current) => {
        const next = new Set(current);
        if (!next.delete(projectId)) next.add(projectId);
        try {
          app.saveLocalStorage(STORAGE_KEY, JSON.stringify([...next]));
        } catch (e) {
          logWarn("Failed to persist expanded sidebar projects", e);
        }
        return next;
      });
    },
    [app]
  );

  return { expandedProjectIds, toggleProject };
}
