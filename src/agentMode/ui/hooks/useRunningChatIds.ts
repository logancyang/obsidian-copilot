import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { useManagerSetSnapshot } from "@/agentMode/ui/hooks/useManagerSetSnapshot";

const getRunningSnapshot = (manager: AgentSessionManager): ReadonlySet<string> =>
  manager.getRunningChatIds();

export function useRunningChatIds(manager: AgentSessionManager): ReadonlySet<string> {
  return useManagerSetSnapshot(manager, getRunningSnapshot);
}
