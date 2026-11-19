import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { GLOBAL_SCOPE } from "@/agentMode/session/scope";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { getCachedProjectRecords } from "@/projects/state";

export async function listAgentChats(
  manager: AgentSessionManager,
  slug: string
): Promise<ChatHistoryItem[]> {
  // The all-chats list hides archived projects' chats, which still belong to the agent.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/940
  const archivedProjectIds = getCachedProjectRecords()
    .filter((record) => record.project.archivedAt !== undefined)
    .map((record) => record.project.id);
  const lists = await Promise.all(
    [GLOBAL_SCOPE, ...archivedProjectIds].map((scope) => manager.getChatHistoryItems(scope))
  );
  return lists.flat().filter((chat) => chat.agent === slug);
}
