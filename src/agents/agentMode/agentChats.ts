import type { HiddenAgentChats } from "@/agents/agentMode/hiddenAgentChats";
import { AgentUnavailableError } from "@/agents/agentUnavailableError";
import type { CustomAgent, CustomAgentStore } from "@/agents/CustomAgentStore";
import type { App } from "obsidian";
import {
  backendRegistry,
  findBackendForModel,
  getActiveBackendDescriptor,
  listBackendDescriptors,
} from "@/agentMode/backends/registry";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendId, InstallState, ModelSelection } from "@/agentMode/session/types";
import { GLOBAL_SCOPE } from "@/agentMode/session/scope";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { logError, logWarn } from "@/logger";
import { getCachedProjectRecords } from "@/projects/state";
import { getSettings, setSettings, type CopilotSettings } from "@/settings/model";

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

export async function listAllChats(manager: AgentSessionManager): Promise<ChatHistoryItem[]> {
  // The all-chats list hides archived projects' chats, which still belong to the agent.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/940
  const archivedProjectIds = getCachedProjectRecords()
    .filter((record) => record.project.archivedAt !== undefined)
    .map((record) => record.project.id);
  const lists = await Promise.all(
    [GLOBAL_SCOPE, ...archivedProjectIds].map((scope) => manager.getChatHistoryItems(scope))
  );
  return lists.flat();
}

export async function listAgentChats(
  manager: AgentSessionManager,
  slug: string
): Promise<ChatHistoryItem[]> {
  return (await listAllChats(manager)).filter((chat) => chat.agent === slug);
}

export async function listAgentChatsToArchive(
  manager: AgentSessionManager,
  slug: string
): Promise<ChatHistoryItem[]> {
  // A chat the user already archived, or one in an archived project, stays where the user put it, so only the all-chats list's unarchived chats move to the archive.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/940
  const chats = await manager.getChatHistoryItems(GLOBAL_SCOPE);
  return chats.filter((chat) => chat.agent === slug && chat.archivedAt === undefined);
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
  archivedChats: number;
  agentDeleted: boolean;
}

const NOTHING_DELETED: DeleteAgentResult = Object.freeze({
  archivedChats: 0,
  agentDeleted: false,
});

export async function deleteAgentAndArchiveChats({
  app,
  manager,
  store,
  slug,
  hostSessionId,
  hiddenChats,
}: DeleteAgentRequest): Promise<DeleteAgentResult> {
  // A confirm that lands after the agent's folder is gone or custom agents stopped must not archive its chats on their own.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/940
  if (!store.getAgents().some((agent) => agent.slug === slug)) return NOTHING_DELETED;
  // New chats must not reopen on the agent being deleted, or the new chat below would start as it.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/940
  if (getSettings().agentMode.lastTeammate === slug) {
    setSettings((cur) => ({ agentMode: { ...cur.agentMode, lastTeammate: undefined } }));
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
  hiddenChats?.stopAgent(slug);
  try {
    await store.deleteAgent(slug);
  } catch (error) {
    logError(`[Custom agents] Trashing ${slug}'s folder failed`, error);
    return NOTHING_DELETED;
  }
  let archivedChats = 0;
  for (const chat of await listAgentChatsToArchive(manager, slug)) {
    // An open chat would keep replying as an agent that no longer exists, so it closes first; one its coding agent can't close is archived all the same.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/940
    await manager.closeChatSession(chat.id).catch((error: unknown) => {
      logWarn(`[Custom agents] Closing ${slug}'s chat ${chat.id} failed`, error);
    });
    try {
      await manager.setChatArchived(chat.id, true);
      archivedChats++;
    } catch (error) {
      logError(`[Custom agents] Archiving ${slug}'s chat ${chat.id} failed`, error);
    }
  }
  for (const descriptor of listBackendDescriptors()) {
    // A coding agent's copy of the agent's instruction and memory outside the vault must not outlive the agent, yet the agent is deleted all the same when that copy can't be removed.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/991
    await descriptor.forgetAgent?.(app, slug).catch((error: unknown) => {
      logWarn(`[Custom agents] ${descriptor.displayName} couldn't forget ${slug}`, error);
    });
  }
  return { archivedChats, agentDeleted: true };
}
