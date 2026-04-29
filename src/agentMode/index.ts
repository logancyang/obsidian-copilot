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
export type { StoredMcpServer, McpTransport } from "./session/mcpResolver";
export { sanitizeStoredMcpServers } from "./session/mcpResolver";
export { McpServersPanel } from "./ui/McpServersPanel";
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
  const manager = new AgentSessionManager(app, plugin, {
    permissionPrompter: createDefaultPermissionPrompter(app),
    resolveDescriptor: (id) => backendRegistry[id],
    modelPreloader: preloader,
    persistenceManager,
  });
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
