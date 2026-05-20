import { type App, Platform } from "obsidian";
import type CopilotPlugin from "@/main";
import { logError } from "@/logger";
import { type CopilotSettings, getSettings, useSettingsValue } from "@/settings/model";
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
export { isAgentModelEnabled, writeAgentModelOverride } from "./session/modelEnable";
export { getBackendModelOverrides } from "./session/backendSettingsAccess";
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
export { SelectedModelsList } from "./ui/SelectedModelsList";
export { PlanPreviewView, PLAN_PREVIEW_VIEW_TYPE } from "./ui/PlanPreviewView";
export type { PlanPreviewViewState } from "./ui/PlanPreviewView";
export { getActiveBackendDescriptor, listBackendDescriptors } from "./backends/registry";
export { frameSink as acpFrameSink } from "./session/debugSink";
export { SkillManager, SkillsSettings, useManagedSkills } from "./skills";
export type { Skill } from "./skills";

/**
 * True when Agent Mode is enabled and the platform supports it. Agent Mode
 * requires subprocess support, so this is always false on mobile regardless
 * of the persisted `enabled` flag (which may have been synced from desktop).
 */
export function isAgentModeEnabled(settings: CopilotSettings = getSettings()): boolean {
  return !Platform.isMobile && !!settings.agentMode?.enabled;
}

/** React hook variant — re-renders when the setting or platform-derived value changes. */
export function useIsAgentModeEnabled(): boolean {
  return isAgentModeEnabled(useSettingsValue());
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
 * SkillManager must be initialised before the preload probes fire: the
 * Claude descriptor's `getSkillCreationDirective` reads
 * `SkillManager.getInstance()` synchronously inside `newSession()`, which
 * the probe calls. Doing it in this function (rather than from `main.ts`
 * via a separate call) keeps the dependency order obvious and prevents the
 * preload race that would otherwise throw "called before initialize".
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
  if (!isAgentModeEnabled(settings)) return manager;
  const preloads: Promise<void>[] = [];
  for (const descriptor of listBackendDescriptors()) {
    if (descriptor.getInstallState(settings).kind !== "ready") continue;
    preloads.push(
      manager
        .preloadModels(descriptor.id)
        .catch((e) => logError(`[AgentMode] preload ${descriptor.id} failed`, e))
    );
  }
  // Aggregate so the chat UI can gate its first render until every
  // backend's catalog has settled — the model picker should never flash
  // empty before the cache populates.
  manager.setPreloadPromise(Promise.allSettled(preloads).then(() => undefined));
  return manager;
}
