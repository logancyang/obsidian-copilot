import { type App, Platform } from "obsidian";
import type CopilotPlugin from "@/main";
import { logError } from "@/logger";
import { getSettings, subscribeToSettingsChange, type CopilotSettings } from "@/settings/model";
import { deriveSkillsFolder, getEffectiveSkillsFolder } from "@/settings/copilotFolder";
import { subscribeToSystemPromptChange } from "@/system-prompts/state";
import { copilotAppDataDir, getVaultId } from "@/utils/appPaths";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { buildAgentSystemPrompt } from "./backends/shared/agentSystemPrompt";
import { backendRegistry, listBackendDescriptors } from "./backends/registry";
import type { BackendId } from "./session/types";
import { AgentChatPersistenceManager } from "./session/AgentChatPersistenceManager";
import { AgentModelPreloader } from "./session/AgentModelPreloader";
import { AgentSessionIndex } from "./session/AgentSessionIndex";
import { createNodeFileStorage } from "./session/nodeFileStorage";
import { AgentSessionManager } from "./session/AgentSessionManager";
import { seedCopilotDefaultModel } from "./session/copilotDefaultModel";
import { SkillManager } from "./skills";
import { planManagedBuiltins } from "./skills/builtin/builtinSkills";
import { removeSeededBuiltin, seedBuiltinSkills } from "./skills/builtin/seedBuiltinSkills";
import { buildBuiltinSeedFs } from "./skills/builtin/miyoSearchSeed";
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
export { partitionOpencodeOnlyWireIds } from "./backends/opencode/opencodeProbePartition";
export {
  mapProviderToOpencodeId,
  isOpencodeZenWireId,
} from "./backends/opencode/opencodeModelResolve";
export type { OpencodeProviderMapping } from "./backends/opencode/opencodeModelResolve";
export { installBadge, InstallBadge } from "./backends/shared/installStatus";
export type {
  BackendState,
  CopilotMode,
  EffortOption,
  ModelEntry,
  ModelSelection,
  ModelState,
} from "./session/types";
export { AgentDefaultModelSetting } from "./ui/AgentDefaultModelSetting";
export { ModelEnableList } from "./ui/ModelEnableList";
export type { ModelEnableGroup, ModelEnableRow } from "./ui/ModelEnableList";
export { PlanPreviewView, PLAN_PREVIEW_VIEW_TYPE } from "./ui/PlanPreviewView";
export type { PlanPreviewViewState } from "./ui/PlanPreviewView";
export { ReportIssueModal } from "./ui/ReportIssueModal";
export type { ReportIssueModalParams } from "./ui/ReportIssueModal";
export {
  backendDisplayOrder,
  backendNeedsSelfHostWarning,
  getActiveBackendDescriptor,
  getCloudAgentIds,
  listBackendDescriptors,
  RECOMMENDED_BACKEND_ID,
} from "./backends/registry";
export { frameSink as acpFrameSink, setFrameSinkVaultBasePath } from "./session/debugSink";
export { getManagedSkills, SkillManager, SkillsSettings, useManagedSkills } from "./skills";
export type { Skill } from "./skills";
// The `miyo-search` install/remove surface, re-exported for the settings UI —
// host code must enter the agent-mode module through this barrel, not deep
// `skills/*` imports (`boundaries/dependencies`).
export { installMiyoSearchSkill, removeMiyoSearchSkill } from "./skills/builtin/miyoSearchSeed";

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
 * Seed `configuredModelId` as the default model of every registered backend
 * that can route it — the plugin host's entry point for
 * {@link seedCopilotDefaultModel}, called when a license is applied. Lives here
 * because `session/` may not import the registry, the same reason as
 * `collectAgentSkillsDirsProjectRel` below.
 *
 * @param configuredModelId - The model to install as the default.
 * @returns Ids of the backends whose default was written.
 */
export function applyCopilotDefaultModel(configuredModelId: string): BackendId[] {
  return seedCopilotDefaultModel(listBackendDescriptors(), configuredModelId);
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
 * builtin" toggle, the base framing, tool guidance, and the pill directive.
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
 * Order-independent dedup key for a backend's env overrides, so the restart
 * subscription fires iff the effective record actually changes (not on key
 * reordering or unrelated settings writes).
 */
function backendEnvOverridesKey(settings: CopilotSettings, backendId: BackendId): string {
  const backends = settings.agentMode?.backends as
    | Partial<Record<BackendId, { envOverrides?: Record<string, string> }>>
    | undefined;
  const env = backends?.[backendId]?.envOverrides ?? {};
  return JSON.stringify(Object.entries(env).sort(([a], [b]) => a.localeCompare(b)));
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
  const os = requireNodeModule<typeof import("node:os")>("os");
  const path = requireNodeModule<typeof import("node:path")>("path");
  const skillManager = SkillManager.initialize(app, collectAgentSkillsDirsProjectRel());
  const preloader = new AgentModelPreloader(app, plugin, (id) => backendRegistry[id]);
  const persistenceManager = new AgentChatPersistenceManager(app);
  // Plugin-local (per-vault) record of resumable backend sessions, so recent
  // chats can list and resume sessions that were never saved as markdown.
  //
  // Stored OUTSIDE the vault, under `~/.obsidian-copilot/vaults/<vaultId>/`,
  // because the index mirrors device-local backend stores (`~/.claude/projects`,
  // opencode's own session dirs) and references session ids that only resolve
  // on the machine that created them. Keeping it off vault sync avoids ghost
  // entries and write conflicts across synced devices (iCloud/Syncthing/
  // Obsidian Sync). Scoped by a vault id (hash of the vault path) so vaults
  // don't share one file. Agent Mode is desktop-only, so Node fs is fine.
  const vaultId = getVaultId(app);
  const indexPath = path.join(
    copilotAppDataDir(os.homedir()),
    "vaults",
    vaultId,
    "agent-chat-index.json"
  );
  const sessionIndex = new AgentSessionIndex(createNodeFileStorage(), indexPath);
  // Mutable ref breaks the construction cycle: the prompter needs the
  // manager, but handlers only fire after a session exists, which can't
  // happen before assignment below.
  let managerRef: AgentSessionManager | null = null;
  const prompter = createDefaultPermissionPrompter(
    (id) => managerRef?.getSessionByBackendId(id) ?? null,
    (id) => managerRef?.isReadOnlyFanoutSession(id) ?? false
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
    sessionIndex,
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
  // The composed Agent Mode built-in prompt is baked into opencode/codex
  // spawn-time config and shared across sessions. Restart the opted-in backends
  // when its effective content changes; Claude re-reads it per `newSession()`.
  //
  // The system-prompt store also emits for Chat mode prompt changes, so dedupe
  // on the builder's real output. On initial load this is a harmless no-op:
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
  // Env overrides are baked into subprocess spawn env, and the Claude SDK
  // folds them into its model catalog (a custom `ANTHROPIC_MODEL` becomes a
  // picker entry). Either way an edit only reaches the live or warm process on
  // a fresh spawn/probe, so restart the backend whose record actually changed.
  // The editor debounces commits and the manager/preloader coalesce rapid
  // restarts, so a burst of edits folds into one re-probe (same rationale as
  // the provider-config subscription above).
  subscribeToSettingsChange((prev, next) => {
    for (const descriptor of listBackendDescriptors()) {
      if (
        backendEnvOverridesKey(prev, descriptor.id) === backendEnvOverridesKey(next, descriptor.id)
      ) {
        continue;
      }
      void manager
        .restartBackend(descriptor.id, "env overrides changed")
        .catch((error) =>
          logError(`[AgentMode] restart after env overrides change failed: ${descriptor.id}`, error)
        );
    }
  });
  // Seed the plugin-shipped builtin skills into the canonical folder, then run
  // discovery so the pass picks them up and fans them out to the agent dirs.
  // Miyo vault search and Miyo document parsing are gated independently;
  // `planManagedBuiltins` decides both what to write and what to remove, so no
  // gate can be added without its prune (the cloud PDF skill Miyo documents
  // replace is pruned this way). Discovery runs even when seeding fails so
  // existing skills still reconcile.
  //
  // Passes are SERIALIZED through `seedChain`: a fast enable→disable (or a folder
  // change landing mid-seed) would otherwise interleave writes and leave the
  // Miyo skill on disk after a disable, since each pass' skill-set decision is
  // taken before its first `await`. Chaining also makes each pass read the flag
  // at its own execution time, so the last one to run reflects the final intent.
  let seedChain: Promise<void> = Promise.resolve();
  const seedManagedBuiltins = (folder: string): Promise<void> => {
    seedChain = seedChain.then(async () => {
      // Everything runs inside the guard — including the synchronous
      // `buildBuiltinSeedFs`/`getSettings` reads — so this task can NEVER reject.
      // A rejected `seedChain` would strand every later `.then(...)` pass, so the
      // chain must stay resolved no matter what any single pass hits.
      try {
        const fs = buildBuiltinSeedFs(app);
        const settings = getSettings();
        const { seed, prune } = planManagedBuiltins({
          search: settings.enableMiyoSearchSkill === true,
          documents: settings.docProcessorBackend === "miyo",
        });
        await seedBuiltinSkills({ skillsFolderRelPath: folder, fs, skills: seed });
        for (const name of prune) {
          await removeSeededBuiltin(folder, name, fs);
        }
      } catch (e) {
        logError("[Skills] builtin skill seeding failed", e);
      }
      // Always reconcile so existing skills fan out even when seeding failed.
      // Separately guarded so a refresh error can't wedge the chain either.
      try {
        await skillManager.refresh();
      } catch (e) {
        logError("[Skills] skill refresh after seeding failed", e);
      }
    });
    return seedChain;
  };
  subscribeToSettingsChange((prev, next) => {
    // The managed env injected at spawn (see `buildBuiltinSkillEnv`) changes with
    // Copilot Plus sign-in/out or license rotation (the decrypted license the
    // builtin Plus skill scripts read) and with the Miyo server URL (the
    // `MIYO_URL` the bundled miyo CLI reads). Either is only read on a fresh
    // spawn, so restart every backend — otherwise a running subprocess keeps the
    // stale license/URL until a reload. (Restarts coalesce, so this folds with
    // any Miyo-availability re-seed restart below.)
    if (
      prev.isPaidUser !== next.isPaidUser ||
      prev.plusLicenseKey !== next.plusLicenseKey ||
      prev.miyoServerUrl !== next.miyoServerUrl
    ) {
      for (const descriptor of listBackendDescriptors()) {
        void manager
          .restartBackend(descriptor.id, "managed agent env changed")
          .catch((e) =>
            logError(`[AgentMode] restart after managed env change failed: ${descriptor.id}`, e)
          );
      }
    }
    // Re-seed builtins when the canonical skills folder changes (so the tools
    // appear in the new folder without a reload) or when Miyo availability
    // flips (so each gated Miyo skill is seeded/pruned to match). Both run the
    // same gate-aware seed pass against the current folder.
    // Reason: the skills folder is derived from the configurable copilotFolder
    // root; compare derived paths rather than the retired agentMode.skills.folder.
    const prevFolder = deriveSkillsFolder(prev);
    const nextFolder = deriveSkillsFolder(next);
    // `enableMiyoSearchSkill` and `docProcessorBackend` are the two gates
    // `planManagedBuiltins` reads, and each also selects prompt steering that
    // codex/opencode bake at spawn. `enableMiyo` / `miyoServerUrl` are still
    // watched because the injected env (MIYO_URL) changes with them, and
    // `isPaidUser` because it changes the license the seeded Plus scripts read.
    const miyoAvailabilityChanged =
      prev.enableMiyoSearchSkill !== next.enableMiyoSearchSkill ||
      prev.docProcessorBackend !== next.docProcessorBackend ||
      prev.enableMiyo !== next.enableMiyo ||
      prev.miyoServerUrl !== next.miyoServerUrl ||
      prev.isPaidUser !== next.isPaidUser;
    if (prevFolder !== nextFolder || miyoAvailabilityChanged) {
      // Miyo availability also gates the `miyo-search` system-prompt steering
      // (see `buildAgentSystemPrompt`). codex/opencode bake the prompt at spawn,
      // so a mid-session flip needs a restart to apply. Chain the restart AFTER
      // the seed + `skillManager.refresh()` resolve so the skill is written and
      // reconciled into the agent dirs before the agent respawns — otherwise
      // codex (which has `restartOnManagedSkillsChange: false`) could come back
      // with steering pointing at a skill that isn't on disk yet. The seed pass
      // swallows its own errors and always refreshes, so this normally runs
      // after reconcile; `restartSystemPromptAffected` dedupes on the real prompt
      // key, so it's a no-op when the rebuilt prompt is unchanged.
      void seedManagedBuiltins(nextFolder)
        .then(() => {
          if (!miyoAvailabilityChanged) return;
          restartSystemPromptAffected();
          if (prev.docProcessorBackend === next.docProcessorBackend) return;
          // Backends skipped above rebuild the prompt per `newSession()`, so a new
          // chat is already correct — but one already open keeps the route it was
          // born with, and after a switch to Miyo that means a live Claude session
          // still holds the Plus steering while `copilot-read-pdf` is gone, whose
          // fallback clause then sends the PDF to its own reader.
          for (const descriptor of listBackendDescriptors()) {
            if (descriptor.restartOnSystemPromptChange) continue;
            void manager
              .restartBackend(descriptor.id, "document processor changed")
              .catch((e) =>
                logError(
                  `[AgentMode] restart after doc processor change failed: ${descriptor.id}`,
                  e
                )
              );
          }
        })
        .catch((e) => logError("[Skills] builtin skill re-seeding failed", e));
    }
  });
  // A backend's binary path (or a binary install/update) is resolved at spawn
  // time, so a change must reach the running/warm process — otherwise it only
  // updates the settings status line and the agent keeps the old binary until
  // a plugin reload. Each descriptor scopes its subscription to settings that
  // require its process to refresh, so unrelated saves do not churn backends.
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
  void seedManagedBuiltins(getEffectiveSkillsFolder()).catch((error) => {
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
  // Every installed backend preloads — Self-Host Mode marks cloud agents but
  // keeps them usable, so they load like any other.
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
