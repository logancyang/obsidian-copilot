import type { AgentEntry } from "@/agents/types";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { useManagerSubscribe } from "@/agentMode/ui/useManagerSubscribe";
import { logError } from "@/logger";
import { openVaultPath } from "@/utils/openVaultPath";
import { App, Notice } from "obsidian";
import { useCallback, useEffect, useSyncExternalStore } from "react";

export interface AgentTalkingTo {
  /** The built-in Copilot first, then every agent on disk. */
  entries: readonly AgentEntry[];
  /** Slug of the entry the picker shows. */
  selectedSlug: string;
  /** Talk to another agent from now on. */
  select: (slug: string) => void;
  /** Re-read the agents folder (the picker calls this as its menu opens). */
  refresh: () => void;
  /** Open one agent's `MEMORY.md` so the user can read or edit it. */
  openMemory: (slug: string) => void;
  /** Reset one agent's `MEMORY.md` to its empty skeleton. */
  clearMemory: (slug: string) => void;
}

/**
 * Live view of the "talking to" selection for the Agent Home header.
 *
 * The manager owns the selection because it is the thing that binds a chat to
 * an agent when one is created; this hook only renders it and refreshes the
 * roster, which is read from the vault rather than cached — agents are ordinary
 * notes the user may have just created in Settings.
 *
 * @param manager - Session manager owning the selection and the roster.
 * @param app - Vault this chat belongs to, used to open the memory note.
 */
export function useAgentTalkingTo(manager: AgentSessionManager, app: App): AgentTalkingTo {
  const subscribe = useManagerSubscribe(manager);
  const entries = useSyncExternalStore(subscribe, () => manager.getAgentEntries());
  const selectedSlug = useSyncExternalStore(subscribe, () => manager.getSelectedAgentSlug());

  const refresh = useCallback(() => {
    manager.refreshAgents().catch((error) => logError("[Agents] refresh failed", error));
  }, [manager]);

  useEffect(refresh, [refresh]);

  const select = useCallback(
    (slug: string) => {
      manager.setSelectedAgent(slug).catch((error) => logError("[Agents] select failed", error));
    },
    [manager]
  );

  // The memory file belongs to the agent, not to the chat, so both actions go
  // through the slug rather than the open session
  // (`designdocs/CUSTOM_AGENTS.md` §5).
  const openMemory = useCallback(
    (slug: string) => {
      manager
        .resolveAgentMemoryPath(slug)
        .then((path) => {
          if (path) openVaultPath(app, path, { newLeaf: true });
        })
        .catch((error) => logError("[Agents] open memory failed", error));
    },
    [app, manager]
  );

  const clearMemory = useCallback(
    (slug: string) => {
      manager
        .clearAgentMemory(slug)
        .then(() => new Notice("Memory cleared."))
        .catch((error) => {
          logError("[Agents] clear memory failed", error);
          new Notice("Could not clear the memory file.");
        });
    },
    [manager]
  );

  return { entries, selectedSlug, select, refresh, openMemory, clearMemory };
}
