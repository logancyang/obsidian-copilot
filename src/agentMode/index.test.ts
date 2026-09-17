import type { App } from "obsidian";
import type CopilotPlugin from "@/main";
import type { CopilotSettings } from "@/settings/model";
import type { InstallState } from "./session/types";
import type { BuiltinSkillRuntime } from "./skills/SkillManager";
import { createAgentSessionManager } from "./index";
import { reconcileBuiltinSkills } from "./skills/builtin/reconcileBuiltinSkills";
import { BackendConfigRegistry } from "@/modelManagement";

jest.mock("@/constants", () => ({}));
jest.mock("@/logger", () => ({ logError: jest.fn() }));
// Exercise real model-list writes without loading the barrel's provider SDKs and UI.
jest.mock("@/modelManagement", () => ({
  BackendConfigRegistry: jest.requireActual("@/modelManagement/backends/BackendConfigRegistry")
    .BackendConfigRegistry,
}));
jest.mock("@/settings/model", () => ({
  getSettings: () => mockSettings,
  setSettings: (update: (settings: CopilotSettings) => Partial<CopilotSettings>) => {
    emitSettingsChange(mockSettings, { ...mockSettings, ...update(mockSettings) });
  },
  subscribeToSettingsChange: (callback: SettingsSubscriber) => {
    mockSettingsSubscribers.push(callback);
    return () => {};
  },
}));
jest.mock("@/settings/copilotFolder", () => ({ deriveSkillsFolder: () => "copilot/skills" }));
jest.mock("@/settings/builtinSkillPreferences", () => ({ saveBuiltinPreferences: jest.fn() }));
jest.mock("@/system-prompts/state", () => ({ subscribeToSystemPromptChange: jest.fn() }));
jest.mock("@/utils/appPaths", () => ({
  copilotAppDataDir: () => "/tmp/copilot",
  getVaultId: () => "test-vault",
}));
jest.mock("./backends/shared/agentSystemPrompt", () => ({
  buildAgentSystemPrompt: () => "prompt",
}));
jest.mock("./backends/shared/builtinSkillEnv", () => ({
  getBuiltinSkillEnvRestartPolicy: () => "none",
}));
jest.mock("./backends/registry", () => ({
  backendRegistry: {},
  listBackendDescriptors: () => mockDescriptors,
}));
jest.mock("@/agents/AgentFileManager", () => ({ AgentFileManager: jest.fn() }));
jest.mock("./session/AgentChatPersistenceManager", () => ({
  AgentChatPersistenceManager: jest.fn(),
}));
jest.mock("./session/AgentModelPreloader", () => ({ AgentModelPreloader: jest.fn() }));
jest.mock("./session/AgentSessionIndex", () => ({ AgentSessionIndex: jest.fn() }));
jest.mock("./session/nodeFileStorage", () => ({ createNodeFileStorage: jest.fn() }));
jest.mock("./session/AgentSessionManager", () => ({
  AgentSessionManager: jest.fn(() => mockManager),
}));
jest.mock("./session/copilotDefaultModel", () => ({ seedCopilotDefaultModel: jest.fn() }));
jest.mock("./skills", () => ({
  SkillManager: {
    initialize: (_app: App, _dirs: unknown, runtime: BuiltinSkillRuntime) => {
      mockRuntime = runtime;
      return { refresh: mockRefresh, subscribeToSkillSetChange: jest.fn() };
    },
  },
}));
jest.mock("./skills/builtin/reconcileBuiltinSkills", () => ({
  ...jest.requireActual("./skills/builtin/reconcileBuiltinSkills"),
  reconcileBuiltinSkills: jest.fn(),
}));
jest.mock("./skills/builtin/miyoSearchSeed", () => ({ buildBuiltinSeedFs: jest.fn() }));
jest.mock("./ui/permissionPrompter", () => ({
  createDefaultPermissionPrompter: jest.fn(),
  createDefaultAskUserQuestionPrompter: jest.fn(),
}));
// The host barrel also exports UI and provider integrations; none participate in startup wiring.
jest.mock("./ui/AgentModeChat", () => ({}));
jest.mock("./ui/CopilotAgentView", () => ({}));
jest.mock("./ui/useBackendDescriptor", () => ({}));
jest.mock("./ui/useAgentModelPicker", () => ({}));
jest.mock("./ui/useAgentModePicker", () => ({}));
jest.mock("./backends/opencode/opencodeProbePartition", () => ({}));
jest.mock("./backends/opencode/opencodeModelResolve", () => ({}));
jest.mock("./backends/shared/installStatus", () => ({}));
jest.mock("./ui/AgentDefaultModelSetting", () => ({}));
jest.mock("@/components/ui/ModelEnableList", () => ({}));
jest.mock("./ui/PlanPreviewView", () => ({}));
jest.mock("./ui/ReportIssueModal", () => ({}));
jest.mock("./session/debugSink", () => ({}));
jest.mock("./backends/shared/ui/AgentBackendHeader", () => ({}));
jest.mock("./session/useBackendAuthState", () => ({}));

const ISSUE = "https://github.com/logancyang/obsidian-copilot/issues/3022";
const LINEUP_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/319";
const RELOAD_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/475";
type SettingsSubscriber = (prev: CopilotSettings, next: CopilotSettings) => void;
const mockSettingsSubscribers: SettingsSubscriber[] = [];
let mockSettings: CopilotSettings;
let mockRuntime: BuiltinSkillRuntime;
const mockStates: Record<string, InstallState> = {};
const mockInstallListeners: Record<string, () => void> = {};
const mockDescriptors = ["claude", "opencode"].map((id) => ({
  id,
  skillsProjectDir: `.${id}/skills`,
  // Only subprocess backends bake provider and model config into their spawn.
  restartOnProviderConfigChange: id === "opencode",
  getInstallState: () => mockStates[id],
  subscribeInstallState: (_plugin: unknown, listener: () => void) => {
    mockInstallListeners[id] = listener;
  },
}));
const mockRefresh = jest.fn<Promise<unknown>, unknown[]>();
const mockManager = {
  preloadModels: jest.fn(async () => {}),
  restartBackend: jest.fn(async (_id: string, _reason: string) => {}),
  noteSpawnConfigChanged: jest.fn(async (_id: string, _reason: string) => {}),
  registerPreload: jest.fn<void, [string, Promise<void>]>(),
  onInstallStateChanged: jest.fn(async (_id: string) => {}),
  consolidateStaleAgentsOnLoad: jest.fn(async () => {}),
};
let plugin: CopilotPlugin;
const reconcile = jest.mocked(reconcileBuiltinSkills);
/** Settings holding one configured model whose `info` carries `overrides`. */
function settingsWith(overrides: Record<string, unknown>): CopilotSettings {
  return {
    agentMode: { skills: {} },
    providers: {
      plus: { providerId: "plus", origin: { kind: "copilot-plus" } },
      claude: { providerId: "claude", origin: { kind: "agent", agentType: "claude" } },
      native: { providerId: "native", origin: { kind: "agent", agentType: "opencode" } },
      "unused-byok": { providerId: "unused-byok", origin: { kind: "byok" } },
    },
    backends: {
      opencode: { enabledModels: ["configured-1"] },
      claude: { enabledModels: ["claude-haiku"] },
    },
    configuredModels: [
      {
        configuredModelId: "configured-1",
        providerId: "plus",
        configuredAt: 0,
        info: { id: "glm-5.2", displayName: "GLM-5.2", ...overrides },
      },
    ],
  } as unknown as CopilotSettings;
}

/** Drive every settings subscriber the way the settings store would. */
function emitSettingsChange(prev: CopilotSettings, next: CopilotSettings): void {
  mockSettings = next;
  for (const subscriber of mockSettingsSubscribers) subscriber(prev, next);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("agentMode", () => {
  describe("createAgentSessionManager()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockStates.claude = { kind: "ready", source: "custom" };
      mockStates.opencode = { kind: "absent" };
      reconcile.mockResolvedValue(undefined);
      mockRefresh.mockImplementation(() => mockRuntime.prepare("copilot/skills"));
      mockSettingsSubscribers.length = 0;
      mockSettings = settingsWith({ reasoning: true });
      plugin = {
        modelManagement: {
          providerRegistry: { subscribe: jest.fn() },
          backendConfigRegistry: new BackendConfigRegistry(
            {} as ConstructorParameters<typeof BackendConfigRegistry>[0],
            {} as ConstructorParameters<typeof BackendConfigRegistry>[1]
          ),
        },
      } as unknown as CopilotPlugin;
    });

    it(`waits for initial skill reconciliation before preloading ready agents ${ISSUE}`, async () => {
      const gate = deferred();
      reconcile.mockReturnValue(gate.promise);
      expect(createAgentSessionManager({} as App, plugin)).toBe(mockManager);
      expect(reconcile).toHaveBeenCalledWith(
        expect.objectContaining({ availableAgents: ["claude"] })
      );
      expect(mockManager.preloadModels).not.toHaveBeenCalled();
      gate.resolve();
      await mockManager.registerPreload.mock.calls[0][1];
      expect(mockManager.preloadModels).toHaveBeenCalledTimes(1);
      expect(mockManager.preloadModels).toHaveBeenCalledWith("claude");
    });

    it.each(["reported", "rejected"])(
      `still preloads available agents after a %s initial refresh failure ${ISSUE}`,
      async (failure) => {
        if (failure === "reported") mockRefresh.mockResolvedValueOnce({ ok: false });
        else mockRefresh.mockRejectedValueOnce(new Error("Disk unavailable"));
        createAgentSessionManager({} as App, plugin);
        await mockManager.registerPreload.mock.calls[0][1];
        expect(mockManager.preloadModels).toHaveBeenCalledWith("claude");
      }
    );

    it(`settles new-agent skills before refreshing that agent's installation ${ISSUE}`, async () => {
      createAgentSessionManager({} as App, plugin);
      await mockManager.registerPreload.mock.calls[0][1];
      const gate = deferred();
      const handled = deferred();
      reconcile.mockReturnValueOnce(gate.promise);
      mockManager.onInstallStateChanged.mockImplementationOnce(async () => handled.resolve());
      mockStates.opencode = { kind: "ready", source: "custom" };
      mockInstallListeners.opencode();
      expect(reconcile).toHaveBeenLastCalledWith(
        expect.objectContaining({ availableAgents: ["claude", "opencode"] })
      );
      expect(mockManager.onInstallStateChanged).not.toHaveBeenCalled();
      gate.resolve();
      await handled.promise;
      expect(mockManager.onInstallStateChanged).toHaveBeenCalledWith("opencode");
    });

    it(`refreshes a spawn-config backend when a model's published effort levels change ${LINEUP_ISSUE}`, () => {
      // The Plus lineup reconcile rewrites the row in place, so no provider or
      // enabled-list emission fires; without this the live agent keeps offering
      // an effort level the service has withdrawn.
      createAgentSessionManager({} as App, plugin);

      emitSettingsChange(
        settingsWith({ reasoning: true, reasoningEfforts: ["none", "low", "high"] }),
        settingsWith({ reasoning: true, reasoningEfforts: ["none", "medium", "high"] })
      );

      expect(mockManager.noteSpawnConfigChanged).toHaveBeenCalledTimes(1);
      expect(mockManager.noteSpawnConfigChanged).toHaveBeenCalledWith(
        "opencode",
        "model config changed"
      );
    });

    it(`leaves a running agent alone when only a model's display metadata changes ${LINEUP_ISSUE}`, () => {
      // The agent is asked to reload for this, which a reworded description is
      // not worth: the spawn config never carries it.
      createAgentSessionManager({} as App, plugin);

      emitSettingsChange(
        settingsWith({ reasoning: true, description: "A frontier open model." }),
        settingsWith({ reasoning: true, description: "A frontier open-weight model." })
      );

      expect(mockManager.noteSpawnConfigChanged).not.toHaveBeenCalled();
      expect(mockManager.restartBackend).not.toHaveBeenCalled();
    });

    it(`offers an OpenCode reload when its enabled models change ${RELOAD_ISSUE}`, async () => {
      createAgentSessionManager({} as App, plugin);

      await plugin.modelManagement.backendConfigRegistry.disableModel("opencode", "configured-1");

      expect(mockManager.noteSpawnConfigChanged).toHaveBeenCalledTimes(1);
      expect(mockManager.noteSpawnConfigChanged).toHaveBeenCalledWith(
        "opencode",
        "model config changed"
      );
    });

    it(`does not offer an OpenCode reload when a Claude model is disabled or re-enabled ${RELOAD_ISSUE}`, async () => {
      createAgentSessionManager({} as App, plugin);

      await plugin.modelManagement.backendConfigRegistry.disableModel("claude", "claude-haiku");
      expect(plugin.modelManagement.backendConfigRegistry.get("claude").enabledModels).toEqual([]);
      expect(mockManager.noteSpawnConfigChanged).not.toHaveBeenCalled();

      await plugin.modelManagement.backendConfigRegistry.enableModel("claude", "claude-haiku");
      expect(mockManager.noteSpawnConfigChanged).not.toHaveBeenCalled();
    });

    it(`ignores model metadata changes outside OpenCode's enabled list ${RELOAD_ISSUE}`, () => {
      createAgentSessionManager({} as App, plugin);
      const prev = settingsWith({ reasoning: true });
      const next = {
        ...prev,
        configuredModels: [
          ...prev.configuredModels,
          {
            ...prev.configuredModels[0],
            configuredModelId: "claude-haiku",
            providerId: "claude",
          },
        ],
      };

      emitSettingsChange(prev, next);

      expect(mockManager.noteSpawnConfigChanged).not.toHaveBeenCalled();
    });

    it(`ignores native model toggles because the agent already owns their configuration ${RELOAD_ISSUE}`, async () => {
      mockSettings.configuredModels.push({
        ...mockSettings.configuredModels[0],
        configuredModelId: "native-model",
        providerId: "native",
      });
      createAgentSessionManager({} as App, plugin);

      await plugin.modelManagement.backendConfigRegistry.enableModel("opencode", "native-model");
      await plugin.modelManagement.backendConfigRegistry.disableModel("opencode", "native-model");

      expect(mockManager.noteSpawnConfigChanged).not.toHaveBeenCalled();
    });

    it.each([
      ["plus", true],
      ["claude", false],
      ["native", false],
      ["unused-byok", false],
    ])(
      `offers a reload for provider %s only when it feeds the backend's config ${RELOAD_ISSUE}`,
      (providerId, reload) => {
        mockSettings.configuredModels.push(
          {
            ...mockSettings.configuredModels[0],
            configuredModelId: "native-model",
            providerId: "native",
          },
          {
            ...mockSettings.configuredModels[0],
            configuredModelId: "unused-model",
            providerId: "unused-byok",
          }
        );
        mockSettings.backends.opencode!.enabledModels.push("native-model");
        createAgentSessionManager({} as App, plugin);
        const notifyProvider = jest.mocked(plugin.modelManagement.providerRegistry.subscribe).mock
          .calls[0][0];

        // A key rotation can emit without changing settings or its keychain ID.
        notifyProvider(providerId);

        if (reload) {
          expect(mockManager.noteSpawnConfigChanged).toHaveBeenCalledWith(
            "opencode",
            "provider config changed"
          );
        } else {
          expect(mockManager.noteSpawnConfigChanged).not.toHaveBeenCalled();
        }
      }
    );

    it(`offers a reload when an injected provider is removed ${RELOAD_ISSUE}`, () => {
      createAgentSessionManager({} as App, plugin);

      emitSettingsChange(mockSettings, { ...mockSettings, providers: {} });

      expect(mockManager.noteSpawnConfigChanged).toHaveBeenCalledWith(
        "opencode",
        "model config changed"
      );
    });

    it(`routes a Claude environment change only to Claude ${RELOAD_ISSUE}`, () => {
      createAgentSessionManager({} as App, plugin);
      const next = {
        ...mockSettings,
        agentMode: {
          ...mockSettings.agentMode,
          backends: { claude: { envOverrides: { CLAUDE_CONFIG_DIR: "/test-profile" } } },
        },
      } as CopilotSettings;

      emitSettingsChange(mockSettings, next);

      expect(mockManager.noteSpawnConfigChanged).toHaveBeenCalledTimes(1);
      expect(mockManager.noteSpawnConfigChanged).toHaveBeenCalledWith(
        "claude",
        "env overrides changed"
      );
    });

    it(`retains only previously ready agents during compatibility checks ${ISSUE}`, async () => {
      createAgentSessionManager({} as App, plugin);
      await mockManager.registerPreload.mock.calls[0][1];
      mockStates.claude = { kind: "checking", source: "custom" };
      mockStates.opencode = { kind: "checking", source: "custom" };
      const handled = deferred();
      mockManager.onInstallStateChanged.mockImplementationOnce(async () => handled.resolve());
      mockInstallListeners.claude();
      await handled.promise;
      expect(reconcile).toHaveBeenLastCalledWith(
        expect.objectContaining({ availableAgents: ["claude"] })
      );
    });
  });
});
