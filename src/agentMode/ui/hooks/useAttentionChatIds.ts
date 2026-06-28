import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { useManagerSetSnapshot } from "@/agentMode/ui/hooks/useManagerSetSnapshot";

const getAttentionSnapshot = (manager: AgentSessionManager): ReadonlySet<string> =>
  manager.getAttentionChatIds();

/**
 * Reactive set of recent-list ids currently flagging needs-attention — the
 * live complement to the `item.needsAttention` snapshot, so a row's done-dot
 * lights up the moment its backgrounded turn finishes (taking over from the
 * running spinner) instead of waiting for the next history reload.
 */
export function useAttentionChatIds(manager: AgentSessionManager): ReadonlySet<string> {
  return useManagerSetSnapshot(manager, getAttentionSnapshot);
}
