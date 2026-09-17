import { type App, Platform } from "obsidian";
import type CopilotPlugin from "@/main";
import { logError } from "@/logger";
import { getSettings, subscribeToSettingsChange, type CopilotSettings } from "@/settings/model";
import { deriveSkillsFolder } from "@/settings/copilotFolder";
import { subscribeToSystemPromptChange } from "@/system-prompts/state";
import { copilotAppDataDir, getVaultId } from "@/utils/appPaths";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { buildAgentSystemPrompt } from "./backends/shared/agentSystemPrompt";
import { getBuiltinSkillEnvRestartPolicy } from "./backends/shared/builtinSkillEnv";
import { backendRegistry, listBackendDescriptors } from "./backends/registry";
import type { BackendId } from "./session/types";
import { AgentChatPersistenceManager } from "./session/AgentChatPersistenceManager";
import { AgentModelPreloader } from "./session/AgentModelPreloader";
import { AgentFileManager } from "@/agents/AgentFileManager";
import { AgentSessionIndex } from "./session/AgentSessionIndex";
import { createNodeFileStorage } from "./session/nodeFileStorage";
import { AgentSessionManager } from "./session/AgentSessionManager";
import { seedCopilotDefaultModel } from "./session/copilotDefaultModel";
import { SkillManager } from "./skills";
import {
  availableBuiltinAgents,
  reconcileBuiltinSkills,
} from "./skills/builtin/reconcileBuiltinSkills";
import {
  saveBuiltinPreferences,
  type BuiltinPreferencesUpdate,
} from "@/settings/builtinSkillPreferences";
import { buildBuiltinSeedFs } from "./skills/builtin/miyoSearchSeed";
import {
  createDefaultAskUserQuestionPrompter,
  createDefaultPermissionPrompter,
} from "./ui/permissionPrompter";

export { default as CopilotAgentView } from "./ui/CopilotAgentView";
export { useBackendInstallState, useManagedInstallActionState } from "./ui/useBackendDescriptor";
export type { AgentSessionManager } from "./session/AgentSessionManager";
export type { BackendDescriptor, BackendId } from "./session/types";
export { partitionOpencodeOnlyWireIds } from "./backends/opencode/opencodeProbePartition";
export { mapProviderToOpencodeId } from "./backends/opencode/opencodeModelResolve";
export type { CopilotMode, ModelSelection } from "./session/types";
export { AgentDefaultModelSetting } from "./ui/AgentDefaultModelSetting";
export { ModelEnableList } from "@/components/ui/ModelEnableList";
export type { ModelEnableGroup } from "@/components/ui/ModelEnableList";
export { PlanPreviewView, PLAN_PREVIEW_VIEW_TYPE } from "./ui/PlanPreviewView";
export { ReportIssueModal } from "./ui/ReportIssueModal";
export {
  backendDisplayOrder,
  backendNeedsSelfHostWarning,
  listBackendDescriptors,
} from "./backends/registry";
export { frameSink as acpFrameSink, setFrameSinkVaultBasePath } from "./session/debugSink";
export { getManagedSkills, SkillManager, SkillsSettings } from "./skills";
export type { Skill } from "./skills";
function isAgentModeEnabled(): boolean {
  return !Platform.isMobile;
}

export function applyCopilotDefaultModel(configuredModelId: string): BackendId[] {
  return seedCopilotDefaultModel(listBackendDescriptors(), configuredModelId);
}

function collectAgentSkillsDirsProjectRel(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const descriptor of listBackendDescriptors()) {
    out[descriptor.id] = descriptor.skillsProjectDir;
  }
  return out;
}

function backendEnvOverridesKey(settings: CopilotSettings, backendId: BackendId): string {
  const backends = settings.agentMode?.backends as
    | Partial<Record<BackendId, { envOverrides?: Record<string, string> }>>
    | undefined;
  const env = backends?.[backendId]?.envOverrides ?? {};
  return JSON.stringify(Object.entries(env).sort(([a], [b]) => a.localeCompare(b)));
}

function spawnModelConfigKey(
  settings: CopilotSettings,
  backendId: keyof CopilotSettings["backends"]
): string {
  const enabled = new Set(settings.backends[backendId]?.enabledModels);
  return settings.configuredModels
    .filter((model) => {
      const provider = settings.providers[model.providerId];
      return enabled.has(model.configuredModelId) && provider && provider.origin.kind !== "agent";
    })
    .map((model) =>
      JSON.stringify([
        model.configuredModelId,
        model.providerId,
        model.info.id,
        model.info.reasoning,
        model.info.reasoningEfforts,
        model.info.modalities,
        model.info.toolCall,
      ])
    )
    .sort()
    .join("\n");
}

export function createAgentSessionManager(app: App, plugin: CopilotPlugin): AgentSessionManager {
  const os = requireNodeModule<typeof import("node:os")>("os");
  const path = requireNodeModule<typeof import("node:path")>("path");
  let lastAvailableSkillAgents: readonly string[] = [];
  const availableSkillAgents = (): readonly string[] => {
    const states = Object.fromEntries(
      listBackendDescriptors()
        .filter((descriptor) => descriptor.skillsProjectDir)
        .map((descriptor) => [descriptor.id, descriptor.getInstallState(getSettings())])
    );
    lastAvailableSkillAgents = availableBuiltinAgents(states, lastAvailableSkillAgents);
    return lastAvailableSkillAgents;
  };
  const saveSkillPreferences = (update: BuiltinPreferencesUpdate) =>
    saveBuiltinPreferences(update, (data) => plugin.saveData(data));
  const skillManager = SkillManager.initialize(app, collectAgentSkillsDirsProjectRel(), {
    availableAgents: availableSkillAgents,
    savePreferences: saveSkillPreferences,
    prepare: async (folder) => {
      await reconcileBuiltinSkills({
        folder,
        fs: buildBuiltinSeedFs(app),
        settings: getSettings(),
        availableAgents: availableSkillAgents(),
        registeredAgents: Object.keys(collectAgentSkillsDirsProjectRel()),
      });
    },
  });
  const initializing = new Map<BackendId, Promise<void>>();
  const beforeBackendStart = async (id: BackendId): Promise<void> => {
    await initializing.get(id);
  };
  const preloader = new AgentModelPreloader(
    app,
    plugin,
    (id) => backendRegistry[id],
    beforeBackendStart
  );
  const persistenceManager = new AgentChatPersistenceManager(app);
  const vaultId = getVaultId(app);
  const indexPath = path.join(
    copilotAppDataDir(os.homedir()),
    "vaults",
    vaultId,
    "agent-chat-index.json"
  );
  const sessionIndex = new AgentSessionIndex(createNodeFileStorage(), indexPath);
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
    beforeBackendStart,
    persistenceManager,
    sessionIndex,
    agentFileManager: new AgentFileManager(app),
  });
  managerRef = manager;
  // `noteSpawnConfigChanged` holds the restart behind Reload while a session is open: a skill
  // file an agent just wrote must not close the conversation that asked for it. https://github.com/Brevilabs/obsidian-copilot-private/issues/475
  skillManager.subscribeToSkillSetChange((backendId) => {
    const descriptor = backendRegistry[backendId];
    if (!descriptor?.restartOnManagedSkillsChange) return;
    void manager
      .noteSpawnConfigChanged(backendId, "managed skills changed")
      .catch((error) =>
        logError(`[Skills] Failed to refresh backend after skill change: ${backendId}`, error)
      );
  });
  for (const descriptor of listBackendDescriptors()) {
    if (!descriptor.restartOnProviderConfigChange) continue;
    const backendId = descriptor.id as keyof CopilotSettings["backends"];
    const refresh = (reason: string): void => {
      void manager
        .noteSpawnConfigChanged(descriptor.id, reason)
        .catch((error) =>
          logError(`[AgentMode] restart after ${reason} failed: ${descriptor.id}`, error)
        );
    };
    plugin.modelManagement.providerRegistry.subscribe((providerId) => {
      const settings = getSettings();
      const provider = settings.providers[providerId];
      const enabled = new Set(settings.backends[backendId]?.enabledModels);
      // Unused BYOK providers cannot change this process; key rotations still notify. https://github.com/Brevilabs/obsidian-copilot-private/issues/475
      if (
        provider &&
        provider.origin.kind !== "agent" &&
        settings.configuredModels.some(
          (model) => model.providerId === providerId && enabled.has(model.configuredModelId)
        )
      ) {
        refresh("provider config changed");
      }
    });
    subscribeToSettingsChange((prev, next) => {
      if (spawnModelConfigKey(prev, backendId) !== spawnModelConfigKey(next, backendId)) {
        // Lineup reconciliation can withdraw an effort level without changing the enabled list. https://github.com/Brevilabs/obsidian-copilot-private/issues/319
        refresh("model config changed");
      }
    });
  }
  const lastSystemPromptKeys = new Map<BackendId, string>();
  for (const descriptor of listBackendDescriptors()) {
    if (descriptor.restartOnSystemPromptChange) {
      lastSystemPromptKeys.set(descriptor.id, buildAgentSystemPrompt(descriptor.id));
    }
  }
  const refreshSystemPromptAffected = (): void => {
    for (const descriptor of listBackendDescriptors()) {
      if (!descriptor.restartOnSystemPromptChange) continue;
      const key = buildAgentSystemPrompt(descriptor.id);
      if (key === lastSystemPromptKeys.get(descriptor.id)) continue;
      lastSystemPromptKeys.set(descriptor.id, key);
      void manager
        .noteSpawnConfigChanged(descriptor.id, "system prompt changed")
        .catch((error) =>
          logError(`[AgentMode] restart after system prompt change failed: ${descriptor.id}`, error)
        );
    }
  };
  subscribeToSystemPromptChange(refreshSystemPromptAffected);
  subscribeToSettingsChange((prev, next) => {
    for (const descriptor of listBackendDescriptors()) {
      if (
        backendEnvOverridesKey(prev, descriptor.id) === backendEnvOverridesKey(next, descriptor.id)
      ) {
        continue;
      }
      void manager
        .noteSpawnConfigChanged(descriptor.id, "env overrides changed")
        .catch((error) =>
          logError(`[AgentMode] restart after env overrides change failed: ${descriptor.id}`, error)
        );
    }
  });
  const seedManagedBuiltins = async (): Promise<void> => {
    await skillManager.refresh(true);
  };
  subscribeToSettingsChange((prev, next) => {
    for (const descriptor of listBackendDescriptors()) {
      const managedEnvRestartPolicy = getBuiltinSkillEnvRestartPolicy(prev, next, descriptor.id);
      if (managedEnvRestartPolicy === "none") continue;
      // Applying a new search boundary cannot wait for a running turn to finish,
      // let alone for the user to accept a Reload: cancel the turn before it can
      // start another search with the prior scope.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/121
      const applied =
        managedEnvRestartPolicy === "immediate"
          ? manager.restartBackend(descriptor.id, "managed agent env changed", {
              deferWhileBusy: false,
            })
          : manager.noteSpawnConfigChanged(descriptor.id, "managed agent env changed");
      void applied.catch((e) =>
        logError(`[AgentMode] restart after managed env change failed: ${descriptor.id}`, e)
      );
    }
    const prevFolder = deriveSkillsFolder(prev);
    const nextFolder = deriveSkillsFolder(next);
    const miyoAvailabilityChanged =
      prev.enableMiyoSearchSkill !== next.enableMiyoSearchSkill ||
      prev.docProcessorBackend !== next.docProcessorBackend ||
      prev.enableMiyo !== next.enableMiyo ||
      prev.miyoConnectionMode !== next.miyoConnectionMode ||
      prev.miyoServerUrl !== next.miyoServerUrl ||
      prev.isPaidUser !== next.isPaidUser;
    if (
      prevFolder !== nextFolder ||
      miyoAvailabilityChanged ||
      prev.agentMode.skills.builtinPreferences !== next.agentMode.skills.builtinPreferences
    ) {
      void seedManagedBuiltins()
        .then(() => {
          refreshSystemPromptAffected();
          if (prev.docProcessorBackend === next.docProcessorBackend) return;
          for (const descriptor of listBackendDescriptors()) {
            if (descriptor.restartOnSystemPromptChange) continue;
            void manager
              .noteSpawnConfigChanged(descriptor.id, "document processor changed")
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
  for (const descriptor of listBackendDescriptors()) {
    descriptor.subscribeInstallState(plugin, () => {
      // Startup reads the final installation; reacting to intermediate writes would duplicate
      // probes. https://github.com/Brevilabs/obsidian-copilot-private/issues/530
      if (initializing.has(descriptor.id)) return;
      // The first warm probe must see newly installed skills. https://github.com/logancyang/obsidian-copilot/issues/3022
      void seedManagedBuiltins()
        .then(() => manager.onInstallStateChanged(descriptor.id))
        .catch((error) =>
          logError(`[AgentMode] install-state refresh failed: ${descriptor.id}`, error)
        );
    });
  }
  const initialSkillsReady = seedManagedBuiltins().catch((error) => {
    logError("[Skills] Initial discovery pass failed", error);
  });
  for (const descriptor of listBackendDescriptors()) {
    const ready = Promise.resolve()
      .then(() => descriptor.onPluginLoad?.(plugin))
      .catch((e) => logError(`[AgentMode] backend ${descriptor.id} onPluginLoad failed`, e))
      .then(() => initialSkillsReady)
      .finally(() => initializing.delete(descriptor.id));
    initializing.set(descriptor.id, ready);
    if (isAgentModeEnabled()) {
      manager.registerPreload(
        descriptor.id,
        ready.then(() => {
          if (descriptor.getInstallState(getSettings()).kind === "ready") {
            return manager.preloadModels(descriptor.id);
          }
        })
      );
    }
  }

  return manager;
}

export { AgentBackendHeader } from "./backends/shared/ui/AgentBackendHeader";

export { useBackendAuthState } from "./session/useBackendAuthState";
