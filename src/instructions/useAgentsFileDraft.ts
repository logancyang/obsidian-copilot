import { readAgentsFile } from "@/instructions/agentsFile";
import { logError } from "@/logger";
import { App } from "obsidian";
import { useEffect, useState } from "react";

/**
 * Editable draft of a folder's AGENTS.md, seeded from what is on disk.
 *
 * The draft stays `null` until the read settles, and while it is null the host is expected to
 * render no editor at all. Mounting an empty textarea and filling it a frame later would read
 * as Copilot having wiped the user's instructions, and a save fired in that gap would make it
 * true. A null folder — a scope with no folder to read from — never resolves for the same
 * reason.
 *
 * Persisting is the host's job, because the two hosts commit at different moments: settings
 * saves as the user types, while the project modal saves when the user accepts the dialog.
 *
 * @param app - Obsidian app that owns the target vault
 * @param folderPath - Vault-relative folder ("" for the vault root), or null when the scope
 * has no folder yet and there is nothing to read
 * @returns The draft text and its setter; the setter only updates local state
 */
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
