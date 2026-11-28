import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { useManagerSetSnapshot } from "@/agentMode/ui/hooks/useManagerSetSnapshot";

const getAttentionSnapshot = (manager: AgentSessionManager): ReadonlySet<string> =>
  manager.getAttentionChatIds();

export function useAttentionChatIds(manager: AgentSessionManager): ReadonlySet<string> {
  return useManagerSetSnapshot(manager, getAttentionSnapshot);
}
