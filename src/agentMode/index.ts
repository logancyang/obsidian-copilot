import type { App } from "obsidian";
import type CopilotPlugin from "@/main";
import { logError } from "@/logger";
import { getSettings } from "@/settings/model";
import { backendRegistry, listBackendDescriptors } from "./backends/registry";
import { AgentChatPersistenceManager } from "./session/AgentChatPersistenceManager";
import { AgentModelPreloader } from "./session/AgentModelPreloader";
import { AgentSessionManager } from "./session/AgentSessionManager";
import { createDefaultPermissionPrompter } from "./ui/permissionPrompter";

// Public surface for the rest of the plugin. External code should import from
// `@/agentMode` (this file), never deep paths into acp/, session/, backends/,
// or ui/.
export { AGENT_CHAT_MODE } from "./session/AgentChatPersistenceManager";
export { AgentModeChat } from "./ui/AgentModeChat";
export { default as CopilotAgentView } from "./ui/CopilotAgentView";
export {
  useActiveBackendDescriptor,
  useBackendInstallState,
  useSessionBackendDescriptor,
} from "./ui/useBackendDescriptor";
export { useAgentModelPicker } from "./ui/useAgentModelPicker";
export type { AgentModelPickerOverride } from "./ui/useAgentModelPicker";
export type { AgentSessionManager } from "./session/AgentSessionManager";
export type { BackendDescriptor, BackendId, InstallState } from "./session/types";
export { isAgentModelEnabled } from "./session/modelEnable";
export { getBackendModelOverrides } from "./session/backendSettingsAccess";
export { dedupeAvailableModels, buildEffortAdapter } from "./session/effortAdapter";
export type { EffortAdapter, EffortOption } from "./session/effortAdapter";
export type { CopilotMode } from "./session/modeAdapter";
export type { StoredMcpServer, McpTransport } from "./session/mcpResolver";
export { sanitizeStoredMcpServers } from "./session/mcpResolver";
export { McpServersPanel } from "./ui/McpServersPanel";
export { PlanPreviewView, PLAN_PREVIEW_VIEW_TYPE } from "./ui/PlanPreviewView";
export type { PlanPreviewViewState } from "./ui/PlanPreviewView";
export { getActiveBackendDescriptor, listBackendDescriptors } from "./backends/registry";
export { frameSink as acpFrameSink } from "./acp/frameSink";

/**
 * Single seam between the plugin host (`main.ts`) and Agent Mode. Wires the
 * default permission prompter into a fresh `AgentSessionManager` and kicks
 * off every registered backend descriptor's load-time reconcile (e.g. clear
 * stale managed install). The manager itself is backend-agnostic — backends
 * are spawned lazily on first session creation.
 *
 * `main.ts` calls this once on plugin load. To swap prompters, shut down
 * the existing manager and call this again.
 */
export function createAgentSessionManager(app: App, plugin: CopilotPlugin): AgentSessionManager {
  const preloader = new AgentModelPreloader(app, plugin, (id) => backendRegistry[id]);
  const persistenceManager = new AgentChatPersistenceManager(app);
  // The prompter needs to look up sessions by ACP id (to route ExitPlanMode
  // permissions into the chat card), but the manager isn't constructed until
  // the line below. Invariant: the prompter is only invoked once a session
  // exists, which can't happen before `manager` is assigned, so the closure
  // is guaranteed to see a non-null reference at call time.
  let managerRef: AgentSessionManager | null = null;
  const prompter = createDefaultPermissionPrompter(app, () => managerRef);
  const manager = new AgentSessionManager(app, plugin, {
    permissionPrompter: prompter,
    resolveDescriptor: (id) => backendRegistry[id],
    modelPreloader: preloader,
    persistenceManager,
  });
  managerRef = manager;
  // Non-blocking — plugin load should not wait on disk reconcile.
  for (const descriptor of listBackendDescriptors()) {
    descriptor
      .onPluginLoad?.(plugin)
      .catch((e) => logError(`[AgentMode] backend ${descriptor.id} onPluginLoad failed`, e));
  }

  const settings = getSettings();
  if (!settings.agentMode?.enabled) return manager;
  for (const descriptor of listBackendDescriptors()) {
    if (descriptor.getInstallState(settings).kind !== "ready") continue;
    manager
      .preloadModels(descriptor.id)
      .catch((e) => logError(`[AgentMode] preload ${descriptor.id} failed`, e));
  }
  return manager;
}
