import type { HiddenAgentChats } from "@/agents/agentMode/hiddenAgentChats";
import { AgentUnavailableError } from "@/agents/agentUnavailableError";
import type { CustomAgent, CustomAgentStore } from "@/agents/CustomAgentStore";
import {
  backendRegistry,
  findBackendForModel,
  getActiveBackendDescriptor,
} from "@/agentMode/backends/registry";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendId, InstallState, ModelSelection } from "@/agentMode/session/types";
import { GLOBAL_SCOPE } from "@/agentMode/session/scope";
import { deleteChatAndBookmark } from "@/agentMode/ui/hooks/useAgentHistoryControls";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { logError, logWarn } from "@/logger";
import { getCachedProjectRecords } from "@/projects/state";
import { getEffectiveConversationsFolder } from "@/settings/copilotFolder";
import { getSettings, setSettings, type CopilotSettings } from "@/settings/model";
import { TFile, type App } from "obsidian";

export type AgentSetupProblem =
  | { kind: "coding_agent"; backendId: BackendId }
  | { kind: "model"; modelName: string };

function modelGone(settings: CopilotSettings, baseModelId: string): AgentSetupProblem {
  const id = baseModelId.split("/").pop() || baseModelId;
  const configured = settings.configuredModels.find(({ info }) =>
    [baseModelId, id].includes(info.id)
  );
  return { kind: "model", modelName: configured?.info.displayName || id };
}

const RUNNABLE_INSTALL_KINDS: ReadonlySet<InstallState["kind"]> = new Set(["ready", "checking"]);

// An agent's files sync between devices while each coding agent and its models are set up per device, so an agent whose model can't run here is locked instead of answering on another model.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/962
export function agentSetupProblem(
  settings: CopilotSettings,
  model: CustomAgent["model"]
): AgentSetupProblem | null {
  const backend = model
    ? findBackendForModel(settings, model.baseModelId)
    : getActiveBackendDescriptor(settings);
  if (!backend) return model ? modelGone(settings, model.baseModelId) : null;
  if (!RUNNABLE_INSTALL_KINDS.has(backend.getInstallState(settings).kind)) {
    return { kind: "coding_agent", backendId: backend.id };
  }
  const runnable = backend
    .getEnabledModelEntries?.(settings)
    ?.some((entry) => entry.baseModelId === model?.baseModelId && entry.credentialState === "ok");
  return model && runnable === false ? modelGone(settings, model.baseModelId) : null;
}

export function agentSetupReason(name: string, problem: AgentSetupProblem): string {
  if (problem.kind === "coding_agent") {
    return `${name} runs on ${backendRegistry[problem.backendId].displayName}, which isn't set up on this device.`;
  }
  return `${name}'s model, ${problem.modelName}, isn't available on this device.`;
}

// A saved chat reopens on the coding agent it ran on, so an agent's chat whose coding agent isn't set up here opens the agent's profile, which says why, instead of failing to load.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/962
export function agentToSetUpBeforeChat(
  { agent, backendId }: Pick<ChatHistoryItem, "agent" | "backendId">,
  problems: ReadonlyMap<string, AgentSetupProblem>
): string | null {
  const problem = agent && problems.get(agent);
  return problem && problem.kind === "coding_agent" && problem.backendId === backendId
    ? agent
    : null;
}

export function agentBackend(
  manager: AgentSessionManager,
  { name, model }: Pick<CustomAgent, "name" | "model">
): { backendId?: BackendId; seed?: ModelSelection } {
  const settings = getSettings();
  const problem = agentSetupProblem(settings, model);
  if (problem) throw new AgentUnavailableError(agentSetupReason(name, problem));
  const backendId = model && findBackendForModel(settings, model.baseModelId)?.id;
  if (!backendId) return {};
  return { backendId, seed: manager.getSeedSelection(backendId, model) ?? undefined };
}

export async function startCustomAgentChat(
  manager: AgentSessionManager,
  agent: Pick<CustomAgent, "slug" | "name" | "model">
): Promise<AgentSession> {
  const { backendId, seed } = agentBackend(manager, agent);
  return manager.createSession(backendId, undefined, seed, undefined, agent.slug);
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
  hiddenChats?: Pick<HiddenAgentChats, "stopAgent">;
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
  hiddenChats,
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
    // A vault whose default coding agent can't start here still deletes the agent; the tab then closes with the agent's chat.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/962
    await manager.startNewChatInPlace(hostSessionId).catch((error: unknown) => {
      logWarn(`[Custom agents] No new chat in place of ${slug}'s chat`, error);
    });
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
  // An agent the delete keeps keeps working, so its run is stopped and reported as deleted only once nothing is left to keep it.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/945
  hiddenChats?.stopAgent(slug);
  try {
    await store.deleteAgent(slug);
  } catch (error) {
    logError(`[Custom agents] Trashing ${slug}'s folder failed`, error);
    return { deletedChats, failedChats, agentDeleted: false };
  }
  return { deletedChats, failedChats, agentDeleted: true };
}
