import type { App } from "obsidian";
import type CopilotPlugin from "@/main";
import { logError } from "@/logger";
import { getSettings } from "@/settings/model";
import { backendRegistry, listBackendDescriptors } from "./backends/registry";
import { AgentModelPreloader } from "./session/AgentModelPreloader";
import { AgentSessionManager } from "./session/AgentSessionManager";
import { createDefaultPermissionPrompter } from "./ui/permissionPrompter";

// Public surface for the rest of the plugin. External code should import from
// `@/agentMode` (this file), never deep paths into acp/, session/, backends/,
// or ui/.
export { AgentModeChat } from "./ui/AgentModeChat";
export {
  useActiveBackendDescriptor,
  useBackendInstallState,
  useSessionBackendDescriptor,
} from "./ui/useBackendDescriptor";
export { useAgentModelPicker } from "./ui/useAgentModelPicker";
export type { AgentModelPickerOverride } from "./ui/useAgentModelPicker";
export type { AgentSessionManager } from "./session/AgentSessionManager";
export type { BackendDescriptor, BackendId, InstallState } from "./session/types";
export { getActiveBackendDescriptor, listBackendDescriptors } from "./backends/registry";

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
  const manager = new AgentSessionManager(app, plugin, {
    permissionPrompter: createDefaultPermissionPrompter(app),
    resolveDescriptor: (id) => backendRegistry[id],
  });
  // Non-blocking — plugin load should not wait on disk reconcile.
  for (const descriptor of listBackendDescriptors()) {
    descriptor
      .onPluginLoad?.(plugin)
      .catch((e) => logError(`[AgentMode] backend ${descriptor.id} onPluginLoad failed`, e));
  }

  // Spin up the preloader and kick off a probe per ready backend. We do this
  // after the descriptor `onPluginLoad` calls (which may reconcile install
  // state) so `getInstallState` returns the most current answer when the
  // preloader checks readiness — but we don't await either step. The preload
  // itself is fully async/best-effort: a slow/failing probe never blocks
  // the UI (the picker section just stays empty until the cache is filled).
  const preloader = new AgentModelPreloader(app, plugin, (id) => backendRegistry[id]);
  manager.attachModelPreloader(preloader);
  // Skip preloading entirely when Agent Mode is disabled. Probing spawns a
  // subprocess per backend and the user has opted out of the feature.
  const settings = getSettings();
  if (!settings.agentMode?.enabled) return manager;
  for (const descriptor of listBackendDescriptors()) {
    if (descriptor.getInstallState(settings).kind !== "ready") continue;
    preloader
      .preload(descriptor.id)
      .catch((e) => logError(`[AgentMode] preload ${descriptor.id} failed`, e));
  }
  return manager;
}
