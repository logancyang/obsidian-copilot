import { readAgentsFile } from "@/instructions/agentsFile";
import { logError } from "@/logger";
import { App } from "obsidian";
import { useEffect, useState } from "react";

export function useAgentsFileDraft(
  app: App,
  folderPath: string | null
): [string | null, (next: string) => void] {
  const [draft, setDraft] = useState<string | null>(null);

  useEffect(() => {
    if (folderPath === null) return;
    let cancelled = false;
    void readAgentsFile(app, folderPath)
      .then((content) => {
        if (!cancelled) setDraft(content);
      })
      .catch((error) => {
        logError(`Failed to read AGENTS.md for "${folderPath || "<vault root>"}".`, error);
      });
    return () => {
      cancelled = true;
    };
  }, [app, folderPath]);

  return [draft, setDraft];
}
