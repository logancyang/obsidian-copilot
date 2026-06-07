import { type App, Platform } from "obsidian";
import type CopilotPlugin from "@/main";
import { logError } from "@/logger";
import { DEFAULT_SKILLS_FOLDER } from "@/constants";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import { subscribeToSystemPromptChange } from "@/system-prompts/state";
import { buildAgentSystemPrompt } from "./backends/shared/agentSystemPrompt";
import { backendRegistry, listBackendDescriptors } from "./backends/registry";
import type { BackendId } from "./session/types";
import { AgentChatPersistenceManager } from "./session/AgentChatPersistenceManager";
import { AgentModelPreloader } from "./session/AgentModelPreloader";
import { AgentSessionManager } from "./session/AgentSessionManager";
import { shouldUseMiyo } from "@/miyo/miyoUtils";
import { SkillManager } from "./skills";
import { managedBuiltinSkills, MIYO_SEARCH_SKILL } from "./skills/builtin/builtinSkills";
import {
  removeSeededBuiltin,
  seedBuiltinSkills,
  type BuiltinSeedFs,
} from "./skills/builtin/seedBuiltinSkills";
import {
  createDefaultAskUserQuestionPrompter,
  createDefaultPermissionPrompter,
} from "./ui/permissionPrompter";

export { AGENT_CHAT_MODE } from "@/constants";
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
export { frameSink as acpFrameSink, setFrameSinkVaultBasePath } from "./session/debugSink";
export { getManagedSkills, SkillManager, SkillsSettings, useManagedSkills } from "./skills";
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
 * The exact system prompt every backend bakes in — i.e. `buildAgentSystemPrompt`'s
 * real output, not a hand-picked subset. Used as the per-backend restart dedup
 * key so a restart fires iff the composed prompt actually changes: the "disable
 * builtin" toggle, the user's custom prompt (including the legacy
 * `userSystemPrompt` fallback), the base framing, and the pill directive.
 * Keying on the builder's actual output means the key can't silently drift from
 * what the backend sends.
 *
 * The prompt is provider-agnostic, so the key is the same for every `backendId`
 * and does not vary with the sticky default model — switching models never
 * needs a prompt-driven restart. The parameter is kept so the call site can key
 * per-backend should that ever change.
 */
function backendSystemPromptKey(_backendId: BackendId): string {
  return buildAgentSystemPrompt();
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
  const askUserQuestionPrompter = createDefaultAskUserQuestionPrompter(
    (id) => managerRef?.getSessionByBackendId(id) ?? null
  );
  const manager = new AgentSessionManager(app, plugin, {
    permissionPrompter: prompter,
    askUserQuestionPrompter,
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
  //
  // A single BYOK save fires several emits in quick succession (provider row →
  // API key → enabled models). Coalescing them into one re-probe lives a layer
  // down: a running backend folds rapid restarts via the manager's restart
  // queue, and a warm preload probe folds them via `preloader.refresh` — both
  // re-read the *final* config once the burst settles, so no debounce here.
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
  // The composed Agent Mode system prompt (Copilot base + pill directive + the
  // user's custom prompt) is baked into opencode/codex spawn-time config and
  // shared across sessions, so a prompt change only reaches those agents on a
  // fresh spawn. Restart the opted-in backends when their *effective* composed
  // prompt changes; the Claude SDK re-reads it per `newSession()` and opts out.
  //
  // The effective prompt depends on several stores (the session-selection atom,
  // the prompts list, the persisted default-prompt-title, and the legacy
  // `userSystemPrompt` fallback), and the underlying atoms also fire on no-op
  // list reloads — so we dedupe per backend on the builder's real output rather
  // than a guessed subset of inputs. On initial load this is a harmless no-op:
  // `restartBackend` returns early when no subprocess is running yet.
  const lastSystemPromptKeys = new Map<BackendId, string>();
  for (const descriptor of listBackendDescriptors()) {
    if (descriptor.restartOnSystemPromptChange) {
      lastSystemPromptKeys.set(descriptor.id, backendSystemPromptKey(descriptor.id));
    }
  }
  const restartSystemPromptAffected = (): void => {
    for (const descriptor of listBackendDescriptors()) {
      if (!descriptor.restartOnSystemPromptChange) continue;
      const key = backendSystemPromptKey(descriptor.id);
      if (key === lastSystemPromptKeys.get(descriptor.id)) continue;
      lastSystemPromptKeys.set(descriptor.id, key);
      void manager
        .restartBackend(descriptor.id, "system prompt changed")
        .catch((error) =>
          logError(`[AgentMode] restart after system prompt change failed: ${descriptor.id}`, error)
        );
    }
  };
  subscribeToSystemPromptChange(restartSystemPromptAffected);
  // Seed the plugin-shipped builtin skills into the canonical folder, then run
  // discovery so the pass picks them up and fans them out to the agent dirs.
  // The Plus relay skills are always seeded; the Miyo vault-search skill is
  // gated on Miyo being in use — seeded when on, and the seeded copy pruned
  // when off — so it only surfaces while Miyo is available. Discovery runs even
  // when seeding fails so existing skills still reconcile.
  const seedManagedBuiltins = async (folder: string): Promise<void> => {
    const adapter = app.vault.adapter;
    const fs: BuiltinSeedFs = {
      exists: (p) => adapter.exists(p),
      read: (p) => adapter.read(p),
      write: (p, c) => adapter.write(p, c),
      mkdir: (p) => adapter.mkdir(p),
      rmRecursive: (p) => adapter.rmdir(p, true),
    };
    const useMiyo = shouldUseMiyo(getSettings());
    try {
      await seedBuiltinSkills({
        skillsFolderRelPath: folder,
        fs,
        skills: managedBuiltinSkills(useMiyo),
      });
      if (!useMiyo) {
        await removeSeededBuiltin(folder, MIYO_SEARCH_SKILL.name, fs);
      }
    } catch (e) {
      logError("[Skills] builtin skill seeding failed", e);
    }
    await skillManager.refresh();
  };
  subscribeToSettingsChange((prev, next) => {
    if (
      prev.defaultSystemPromptTitle !== next.defaultSystemPromptTitle ||
      prev.userSystemPrompt !== next.userSystemPrompt
    ) {
      restartSystemPromptAffected();
    }
    // Copilot Plus sign-in/out (or license rotation) changes the managed env
    // injected at spawn — the decrypted license the builtin Plus skill scripts
    // read. Restart every backend so the next session sees the license appear
    // or disappear without a plugin reload.
    if (prev.isPlusUser !== next.isPlusUser || prev.plusLicenseKey !== next.plusLicenseKey) {
      for (const descriptor of listBackendDescriptors()) {
        void manager
          .restartBackend(descriptor.id, "Copilot Plus license changed")
          .catch((e) =>
            logError(`[AgentMode] restart after plus change failed: ${descriptor.id}`, e)
          );
      }
    }
    // Re-seed builtins when the canonical skills folder changes (so the tools
    // appear in the new folder without a reload) or when Miyo availability
    // flips (so the gated Miyo skill is seeded/pruned to match). Both run the
    // same gate-aware seed pass against the current folder.
    const prevFolder = prev.agentMode?.skills?.folder ?? DEFAULT_SKILLS_FOLDER;
    const nextFolder = next.agentMode?.skills?.folder ?? DEFAULT_SKILLS_FOLDER;
    // `shouldUseMiyo` depends on `isSelfHostAccessValid()`, which reads the
    // self-host validation fields — and those are refreshed asynchronously at
    // startup (after the initial seed pass). Watch them too, so the skill is
    // re-seeded when validation flips invalid→valid without a reload.
    const miyoAvailabilityChanged =
      prev.enableMiyo !== next.enableMiyo ||
      prev.miyoServerUrl !== next.miyoServerUrl ||
      prev.isPlusUser !== next.isPlusUser ||
      prev.selfHostModeValidatedAt !== next.selfHostModeValidatedAt ||
      prev.selfHostValidationCount !== next.selfHostValidationCount;
    if (prevFolder !== nextFolder || miyoAvailabilityChanged) {
      void seedManagedBuiltins(nextFolder).catch((e) =>
        logError("[Skills] builtin skill re-seeding failed", e)
      );
    }
  });
  // A backend's binary path (or a binary install/update) is resolved at spawn
  // time, so a change must reach the running/warm process — otherwise it only
  // updates the settings status line and the agent keeps the old binary until
  // a plugin reload. Each descriptor's `subscribeInstallState` already fires
  // only on its own path/install field, so this won't churn on unrelated saves.
  for (const descriptor of listBackendDescriptors()) {
    descriptor.subscribeInstallState(plugin, () => {
      void manager
        .onInstallStateChanged(descriptor.id)
        .catch((error) =>
          logError(`[AgentMode] install-state refresh failed: ${descriptor.id}`, error)
        );
    });
  }
  // Seed plugin-shipped builtin skills into the canonical folder, THEN run
  // discovery so the first pass picks them up and fans them out to the agent
  // dirs. Non-blocking for plugin load.
  void seedManagedBuiltins(getSettings().agentMode?.skills?.folder ?? DEFAULT_SKILLS_FOLDER).catch(
    (error) => {
      logError("[Skills] Initial discovery pass failed", error);
    }
  );
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
