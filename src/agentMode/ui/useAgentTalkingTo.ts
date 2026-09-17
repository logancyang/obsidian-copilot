import type { AgentEntry } from "@/agents/types";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { useManagerSubscribe } from "@/agentMode/ui/useManagerSubscribe";
import { logError } from "@/logger";
import { useCallback, useEffect, useSyncExternalStore } from "react";

export interface AgentTalkingTo {
  /** The built-in Copilot first, then every agent on disk. */
  entries: readonly AgentEntry[];
  /** Slug of the entry the picker shows. */
  selectedSlug: string;
  /** Talk to another agent from now on. */
  select: (slug: string) => void;
  /** Re-read the agents folder (the picker calls this as its popover opens). */
  refresh: () => void;
}

/**
 * Live view of who the chat is talking to, for the Agent section at the top of
 * the composer's model picker (`designdocs/CUSTOM_AGENTS.md` §3).
 *
 * The manager owns the selection because it is the thing that binds a chat to
 * an agent when one is created; this hook only renders it and refreshes the
 * roster, which is read from the vault rather than cached — agents are ordinary
 * notes the user may have just created in Settings.
 *
 * @param manager - Session manager owning the selection and the roster.
 */
export function useAgentTalkingTo(manager: AgentSessionManager): AgentTalkingTo {
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

  return { entries, selectedSlug, select, refresh };
}
