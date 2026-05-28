import { type App, Platform } from "obsidian";
import type CopilotPlugin from "@/main";
import { logError } from "@/logger";
import { getSettings } from "@/settings/model";
import { backendRegistry, listBackendDescriptors } from "./backends/registry";
import { AgentChatPersistenceManager } from "./session/AgentChatPersistenceManager";
import { AgentModelPreloader } from "./session/AgentModelPreloader";
import { AgentSessionManager } from "./session/AgentSessionManager";
import { SkillManager } from "./skills";
import { createDefaultPermissionPrompter } from "./ui/permissionPrompter";

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
export { useAgentModePicker } from "./ui/useAgentModePicker";
export type { AgentModePickerOverride } from "./ui/useAgentModePicker";
export type { AgentSessionManager } from "./session/AgentSessionManager";
export type { AgentBrand, BackendDescriptor, BackendId, InstallState } from "./session/types";
// First-enrollment default-enable rule (enable the agent's current model).
export { computeDefaultEnabledIds } from "./session/agentDefaultEnable";
export type { EnrolledModelRef } from "./session/agentDefaultEnable";
export { partitionOpencodeOnlyWireIds } from "./backends/opencode/opencodeProbePartition";
export { mapProviderToOpencodeId } from "./backends/opencode/opencodeModelResolve";
export type { OpencodeProviderMapping } from "./backends/opencode/opencodeModelResolve";
export { installBadge, InstallBadge, InstallStatusLine } from "./backends/shared/installStatus";
export type {
  BackendState,
  CopilotMode,
  EffortOption,
  ModelEntry,
  ModelSelection,
  ModelState,
} from "./session/types";
export type { StoredMcpServer, McpTransport } from "./session/mcpResolver";
export { sanitizeStoredMcpServers } from "./session/mcpResolver";
export { McpServersPanel } from "./ui/McpServersPanel";
export { ModelEnableList } from "./ui/ModelEnableList";
export type { ModelEnableGroup, ModelEnableRow } from "./ui/ModelEnableList";
export { PlanPreviewView, PLAN_PREVIEW_VIEW_TYPE } from "./ui/PlanPreviewView";
export type { PlanPreviewViewState } from "./ui/PlanPreviewView";
export { getActiveBackendDescriptor, listBackendDescriptors } from "./backends/registry";
export { frameSink as acpFrameSink } from "./session/debugSink";
export { SkillManager, SkillsSettings, useManagedSkills } from "./skills";
export type { Skill } from "./skills";

/**
 * True when the platform supports Agent Mode. Agent Mode is always on, but
 * requires subprocess support, so this is always false on mobile.
 */
export function isAgentModeEnabled(): boolean {
  return !Platform.isMobile;
}

/** Hook variant for symmetry with other settings-derived hooks. */
export function useIsAgentModeEnabled(): boolean {
  return isAgentModeEnabled();
}

/**
 * Collect each registered backend's project-relative skills directory into
 * a `BackendId → path` map. The skills layer is forbidden by
 * `boundaries/dependencies` from importing the registry, so this lives in
 * the host-side barrel and is injected into `SkillManager.initialize`.
 */
function collectAgentSkillsDirsProjectRel(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const descriptor of listBackendDescriptors()) {
    out[descriptor.id] = descriptor.skillsProjectDir;
  }
  return out;
}

/**
 * Single seam between the plugin host (`main.ts`) and Agent Mode. Initialises
 * the SkillManager singleton, wires the default permission prompter into a
 * fresh `AgentSessionManager`, kicks off every registered backend
 * descriptor's load-time reconcile (e.g. clear stale managed install), and
 * starts the model-catalog preload probes. The manager itself is
 * backend-agnostic — backends are spawned lazily on first session creation.
 *
 * SkillManager must be initialized before the preload probes fire: any
 * spawn-time directive that reads `SkillManager.getInstance()` synchronously
 * inside `newSession()` would otherwise throw "called before initialize"
 * when the probe runs. Doing it in this function (rather than from
 * `main.ts` via a separate call) keeps the dependency order obvious.
 *
 * `main.ts` calls this once on plugin load. To swap prompters, shut down
 * the existing manager and call this again.
 */
export function createAgentSessionManager(app: App, plugin: CopilotPlugin): AgentSessionManager {
  const skillManager = SkillManager.initialize(app, collectAgentSkillsDirsProjectRel());
  const preloader = new AgentModelPreloader(app, plugin, (id) => backendRegistry[id]);
  const persistenceManager = new AgentChatPersistenceManager(app);
  // Mutable ref breaks the construction cycle: the prompter needs the
  // manager, but handlers only fire after a session exists, which can't
  // happen before assignment below.
  let managerRef: AgentSessionManager | null = null;
  const prompter = createDefaultPermissionPrompter(
    (id) => managerRef?.getSessionByBackendId(id) ?? null
  );
  const manager = new AgentSessionManager(app, plugin, {
    permissionPrompter: prompter,
    resolveDescriptor: (id) => backendRegistry[id],
    modelPreloader: preloader,
    persistenceManager,
  });
  managerRef = manager;
  // Skill-set changes restart the affected backend when its descriptor
  // opts in via `restartOnManagedSkillsChange`, so native skill command
  // caches stay fresh.
  skillManager.subscribeToSkillSetChange((backendId) => {
    const descriptor = backendRegistry[backendId];
    if (!descriptor?.restartOnManagedSkillsChange) return;
    void manager
      .restartBackend(backendId, "managed skills changed")
      .catch((error) =>
        logError(`[Skills] Failed to refresh backend after skill change: ${backendId}`, error)
      );
  });
  // Provider rows, API keys, and per-backend enabled-models lists are baked
  // into subprocess backends' spawn config (e.g. opencode's
  // `OPENCODE_CONFIG_CONTENT`). Restart any descriptor that opts in so a
  // new spawn picks them up. Without this, a key entered after the
  // subprocess started never reaches it — opencode keeps making un-
  // authenticated requests and surfaces them as silent zero-token turns.
  const restartProviderAffected = (reason: string): void => {
    for (const descriptor of listBackendDescriptors()) {
      if (!descriptor.restartOnProviderConfigChange) continue;
      void manager
        .restartBackend(descriptor.id, reason)
        .catch((error) =>
          logError(`[AgentMode] restart after ${reason} failed: ${descriptor.id}`, error)
        );
    }
  };
  plugin.modelManagement.providerRegistry.subscribe(() =>
    restartProviderAffected("provider config changed")
  );
  plugin.modelManagement.backendConfigRegistry.subscribe(() =>
    restartProviderAffected("backend enabled models changed")
  );
  void skillManager.refresh().catch((error) => {
    logError("[Skills] Initial discovery pass failed", error);
  });
  // Non-blocking — plugin load should not wait on disk reconcile.
  for (const descriptor of listBackendDescriptors()) {
    descriptor
      .onPluginLoad?.(plugin)
      .catch((e) => logError(`[AgentMode] backend ${descriptor.id} onPluginLoad failed`, e));
  }

  const settings = getSettings();
  if (!isAgentModeEnabled()) return manager;
  // Per-backend preload registration: each backend's status flips
  // independently. The chat UI gates on the active backend's status; the
  // picker reads every backend's status to render per-backend loading rows.
  for (const descriptor of listBackendDescriptors()) {
    if (descriptor.getInstallState(settings).kind !== "ready") continue;
    const promise = manager.preloadModels(descriptor.id);
    manager.registerPreload(
      descriptor.id,
      promise.catch((e) => {
        logError(`[AgentMode] preload ${descriptor.id} failed`, e);
        throw e;
      })
    );
  }
  return manager;
}
