import type { CustomAgent, CustomAgentStore } from "@/agents/CustomAgentStore";
import { findBackendForModel } from "@/agentMode/backends/registry";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendId, ModelSelection } from "@/agentMode/session/types";
import { GLOBAL_SCOPE } from "@/agentMode/session/scope";
import { deleteChatAndBookmark } from "@/agentMode/ui/hooks/useAgentHistoryControls";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { logError } from "@/logger";
import { getCachedProjectRecords } from "@/projects/state";
import { getEffectiveConversationsFolder } from "@/settings/copilotFolder";
import { getSettings, setSettings } from "@/settings/model";
import { TFile, type App } from "obsidian";

export function agentBackend(
  manager: AgentSessionManager,
  model: CustomAgent["model"]
): { backendId?: BackendId; seed?: ModelSelection } {
  const backendId = model && findBackendForModel(getSettings(), model.baseModelId)?.id;
  if (!backendId) return {};
  return { backendId, seed: manager.getSeedSelection(backendId, model) ?? undefined };
}

export function startCustomAgentChat(
  manager: AgentSessionManager,
  { slug, model }: Pick<CustomAgent, "slug" | "model">
): Promise<AgentSession> {
  const { backendId, seed } = agentBackend(manager, model);
  return manager.createSession(backendId, undefined, seed, undefined, slug);
}

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

function isAgentChatNote(app: App, slug: string, path: string): boolean {
  if (!path.startsWith(`${getEffectiveConversationsFolder()}/`)) return false;
  const file = app.vault.getAbstractFileByPath(path);
  const agent: unknown =
    file instanceof TFile ? app.metadataCache.getFileCache(file)?.frontmatter?.agent : undefined;
  return typeof agent === "string" && agent.trim() === slug;
}

export interface DeleteAgentRequest {
  app: App;
  manager: AgentSessionManager;
  store: CustomAgentStore;
  slug: string;
  hostSessionId: string;
}

export interface DeleteAgentResult {
  deletedChats: number;
  failedChats: number;
  agentDeleted: boolean;
}

const NOTHING_DELETED: DeleteAgentResult = Object.freeze({
  deletedChats: 0,
  failedChats: 0,
  agentDeleted: false,
});

export async function deleteAgentWithChats({
  app,
  manager,
  store,
  slug,
  hostSessionId,
}: DeleteAgentRequest): Promise<DeleteAgentResult> {
  // A confirm that lands after the agent's folder is gone or custom agents stopped must not delete its chats on their own.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/940
  if (!store.getAgents().some((agent) => agent.slug === slug)) return NOTHING_DELETED;
  // New chats must not reopen on the agent being deleted, or the new chat below would start as it.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/940
  if (getSettings().agentMode.lastCustomAgent === slug) {
    setSettings((cur) => ({ agentMode: { ...cur.agentMode, lastCustomAgent: undefined } }));
  }
  // The tab the profile covers goes back to the agent home as a new chat instead of closing with the agent's chat.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/940
  const host = manager.getSession(hostSessionId);
  if (host?.agentSlug === slug && host.hasUserVisibleMessages()) {
    await manager.startNewChatInPlace(hostSessionId);
  }
  const chats = await listAgentChats(manager, slug);
  // A history row can carry the agent from the chat index while its note was moved out of the chats folder, replaced, or no longer names the agent; only the note itself proves it is this agent's chat.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/940
  const canTrashNote = (path: string) => isAgentChatNote(app, slug, path);
  let deletedChats = 0;
  for (const chat of chats) {
    try {
      await deleteChatAndBookmark(app, manager, chat.id, { canTrashNote });
      deletedChats++;
    } catch (error) {
      logError(`[Custom agents] Deleting ${slug}'s chat ${chat.id} failed`, error);
    }
  }
  const failedChats = chats.length - deletedChats;
  // An agent deleted while some of its chats stay would leave them recorded with an agent nobody can open or delete them from.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/940
  if (failedChats > 0) return { deletedChats, failedChats, agentDeleted: false };
  try {
    await store.deleteAgent(slug);
  } catch (error) {
    logError(`[Custom agents] Trashing ${slug}'s folder failed`, error);
    return { deletedChats, failedChats, agentDeleted: false };
  }
  return { deletedChats, failedChats, agentDeleted: true };
}
