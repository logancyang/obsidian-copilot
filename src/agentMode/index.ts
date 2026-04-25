import type { App } from "obsidian";
import type CopilotPlugin from "@/main";
import { getSettings } from "@/settings/model";
import { logError } from "@/logger";
import { getActiveBackendDescriptor } from "./backends/registry";
import { AgentSessionManager } from "./session/AgentSessionManager";
import { createDefaultPermissionPrompter } from "./ui/permissionPrompter";

// Public surface for the rest of the plugin. External code should import from
// `@/agentMode` (this file), never deep paths into acp/, session/, backends/,
// or ui/.
export { AgentChatRouter } from "./ui/AgentChatRouter";
export { useActiveBackendDescriptor, useBackendInstallState } from "./ui/useBackendDescriptor";
export { useAgentModelPicker } from "./ui/useAgentModelPicker";
export type { AgentModelPickerOverride } from "./ui/useAgentModelPicker";
export type { AgentSessionManager } from "./session/AgentSessionManager";
export type { BackendDescriptor, BackendId, InstallState } from "./session/types";
export { getActiveBackendDescriptor } from "./backends/registry";

/**
 * Single seam between the plugin host (`main.ts`) and Agent Mode. Resolves
 * the active backend descriptor and the default permission prompter, wires
 * them into a fresh `AgentSessionManager`, and kicks off the descriptor's
 * load-time reconcile (e.g. clear stale managed install).
 *
 * `main.ts` calls this once on plugin load. To swap backends or prompters,
 * shut down the existing manager and call this again.
 */
export function createAgentSessionManager(app: App, plugin: CopilotPlugin): AgentSessionManager {
  const descriptor = getActiveBackendDescriptor(getSettings());
  const manager = new AgentSessionManager(app, plugin, {
    descriptor,
    permissionPrompter: createDefaultPermissionPrompter(app),
  });
  // Non-blocking — plugin load should not wait on disk reconcile.
  descriptor
    .onPluginLoad?.(plugin)
    .catch((e) => logError("[AgentMode] backend onPluginLoad failed", e));
  return manager;
}
