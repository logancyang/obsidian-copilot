import type { AgentEntry } from "@/agents/types";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { useManagerSubscribe } from "@/agentMode/ui/useManagerSubscribe";
import { logError } from "@/logger";
import { useCallback, useEffect, useSyncExternalStore } from "react";

export interface AgentTalkingTo {
  entries: readonly AgentEntry[];
  selectedSlug: string;
  select: (slug: string) => void;
  refresh: () => void;
}

export function useAgentTalkingTo(manager: AgentSessionManager): AgentTalkingTo {
  const subscribe = useManagerSubscribe(manager);
  const entries = useSyncExternalStore(subscribe, () => manager.getAgentEntries());
  const selectedSlug = useSyncExternalStore(subscribe, () => manager.getTalkingToSlug());

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
