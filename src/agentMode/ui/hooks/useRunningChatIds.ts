import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { useManagerSetSnapshot } from "@/agentMode/ui/hooks/useManagerSetSnapshot";

const getRunningSnapshot = (manager: AgentSessionManager): ReadonlySet<string> =>
  manager.getRunningChatIds();

/**
 * Reactive set of recent-list ids whose backend turn is currently running.
 * The manager re-notifies whenever a session's running membership flips, so
 * the landing rows can show/hide their spinner without polling.
 */
export function useRunningChatIds(manager: AgentSessionManager): ReadonlySet<string> {
  return useManagerSetSnapshot(manager, getRunningSnapshot);
}
