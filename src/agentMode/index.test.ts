import type { App } from "obsidian";
import type CopilotPlugin from "@/main";
import type { CopilotSettings } from "@/settings/model";
import type { InstallState } from "./session/types";
import type { BuiltinSkillRuntime } from "./skills/SkillManager";
import { createAgentSessionManager, isCopilotToolOn } from "./index";
import { trackTabStripShown } from "./ui/trackTabStripShown";
import { AgentSessionManager } from "./session/AgentSessionManager";
import { reconcileBuiltinSkills } from "./skills/builtin/reconcileBuiltinSkills";
import { BackendConfigRegistry } from "@/modelManagement";
import { isObsidianCliEnabled } from "@/services/obsidianCli/ObsidianCliClient";
import { createCopilotMcpServer } from "./session/copilotMcpServer";
import { isConnectorsEnabled } from "@/connectors/connectorsEntitlement";

jest.mock("@/constants", () => ({}));
jest.mock("@/logger", () => ({ logError: jest.fn() }));
jest.mock("@/miyo/MiyoClient", () => ({ MiyoClient: jest.fn() }));
jest.mock("@/utils", () => ({ err2String: jest.fn() }));
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
  buildAgentSystemPrompt: (id: string, app: { plugins?: { getPlugin(id: string): unknown } }) =>
    `prompt:${id}:${JSON.stringify(mockSettings.agentMode.skills.builtinPreferences ?? {})}:${mockSettings.agentMode.offerFeedbackCards}:${mockSettings.enableMiyoSearchSkill}:${mockSettings.enableMiyoDocumentProcessing}:${app.plugins?.getPlugin("obsidian-excalidraw-plugin") != null}:${jest.requireMock<typeof import("@/services/obsidianCli/ObsidianCliClient")>("@/services/obsidianCli/ObsidianCliClient").isObsidianCliEnabled()}`,
}));
jest.mock("./backends/shared/builtinSkillEnv", () => ({
  getBuiltinSkillEnvRestartPolicy: () => "none",
}));
jest.mock("./backends/registry", () => ({
  backendRegistry: {},
  listBackendDescriptors: () => mockDescriptors,
}));
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
jest.mock("./session/copilotMcpServer", () => {
  const actual = jest.requireActual("./session/copilotMcpServer");
  return { ...actual, createCopilotMcpServer: jest.fn(actual.createCopilotMcpServer) };
});
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
jest.mock("@/services/obsidianCli/ObsidianCliClient", () => ({
  isObsidianCliEnabled: jest.fn(),
}));
jest.mock("./ui/permissionPrompter", () => ({
  createDefaultPermissionPrompter: jest.fn(),
  createDefaultAskUserQuestionPrompter: jest.fn(),
}));
jest.mock("./ui/CopilotAgentView", () => ({}));
jest.mock("./navigator/openSessionsSidebar", () => ({}));
jest.mock("./navigator/ui/SessionsSidebarView", () => ({}));
jest.mock("./ui/useBackendDescriptor", () => ({}));
jest.mock("./ui/trackTabStripShown", () => ({ trackTabStripShown: jest.fn() }));
jest.mock("./backends/opencode/opencodeProbePartition", () => ({}));
jest.mock("./backends/opencode/opencodeModelResolve", () => ({}));
jest.mock("./ui/AgentDefaultModelSetting", () => ({}));
jest.mock("@/components/ui/ModelEnableList", () => ({}));
jest.mock("./ui/PlanPreviewView", () => ({}));
jest.mock("./ui/ReportIssueModal", () => ({}));
jest.mock("./session/debugSink", () => ({}));
jest.mock("./backends/shared/ui/AgentBackendHeader", () => ({}));
jest.mock("./session/useBackendAuthState", () => ({}));
jest.mock("@/connectors/connectorsEntitlement", () => ({ isConnectorsEnabled: jest.fn() }));

const ISSUE = "https://github.com/logancyang/obsidian-copilot/issues/3022";

function connectorCardsExtension() {
  return jest
    .mocked(AgentSessionManager)
    .mock.calls[0][2].chatExtensions?.find(({ key }) => key.id === "connector-cards");
}

function connectorCardNote(serviceId: string): string | undefined {
  return connectorCardsExtension()?.beforePrompt?.([
    { serviceId, afterUserTurn: 1, dismissed: false, reported: null },
  ])?.note;
}
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
  onPluginLoad: jest.fn(async (_plugin: CopilotPlugin) => {}),
  skillsProjectDir: `.${id}/skills`,
  restartOnProviderConfigChange: id === "opencode",
  restartOnSystemPromptChange: id === "opencode",
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
};
let plugin: CopilotPlugin;
const reconcile = jest.mocked(reconcileBuiltinSkills);
function withCards(offerFeedbackCards: boolean): CopilotSettings {
  return { ...mockSettings, agentMode: { ...mockSettings.agentMode, offerFeedbackCards } };
}
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
      jest.mocked(isObsidianCliEnabled).mockReturnValue(false);
      mockRefresh.mockImplementation(() => mockRuntime.prepare("copilot/skills"));
      mockSettingsSubscribers.length = 0;
      mockSettings = settingsWith({ reasoning: true });
      plugin = {
        manifest: { id: "copilot" },
        modelManagement: {
          providerRegistry: { subscribe: jest.fn() },
          backendConfigRegistry: new BackendConfigRegistry(
            {} as ConstructorParameters<typeof BackendConfigRegistry>[0],
            {} as ConstructorParameters<typeof BackendConfigRegistry>[1]
          ),
        },
      } as unknown as CopilotPlugin;
    });

    it("tells the manager whether a tab strip holds its chats as the workspace layout changes for https://github.com/Brevilabs/obsidian-copilot-private/issues/849", () => {
      const manager = createAgentSessionManager({} as App, plugin);

      expect(trackTabStripShown).toHaveBeenCalledWith(plugin, manager);
    });

    it("waits for each backend upgrade before preloading while other agents remain usable (https://github.com/Brevilabs/obsidian-copilot-private/issues/530)", async () => {
      const upgrade = deferred();
      mockStates.opencode = { kind: "ready", source: "managed" };
      mockDescriptors[1].onPluginLoad.mockReturnValueOnce(upgrade.promise);
      createAgentSessionManager({} as App, plugin);
      await mockManager.registerPreload.mock.calls.find(([id]) => id === "claude")![1];
      expect(mockManager.preloadModels).toHaveBeenCalledWith("claude");
      expect(mockManager.preloadModels).not.toHaveBeenCalledWith("opencode");
      upgrade.resolve();
      await mockManager.registerPreload.mock.calls.find(([id]) => id === "opencode")![1];
      expect(mockManager.preloadModels).toHaveBeenCalledWith("opencode");
    });

    it("links skills for an agent its startup upgrade makes ready, without restarting it while the upgrade owns startup (https://github.com/Brevilabs/obsidian-copilot-private/issues/530, https://github.com/Brevilabs/obsidian-copilot-private/issues/830)", async () => {
      const upgrade = deferred();
      mockStates.opencode = {
        kind: "incompatible",
        source: "managed",
        currentVersion: "1",
        minVersion: "2",
        message: "Upgrade required",
      };
      mockDescriptors[1].onPluginLoad.mockReturnValueOnce(upgrade.promise);
      createAgentSessionManager({} as App, plugin);
      expect(reconcile).toHaveBeenLastCalledWith(
        expect.objectContaining({ availableAgents: ["claude"] })
      );
      mockStates.opencode = { kind: "ready", source: "managed" };
      mockInstallListeners.opencode();
      expect(reconcile).toHaveBeenLastCalledWith(
        expect.objectContaining({ availableAgents: ["claude", "opencode"] })
      );
      upgrade.resolve();
      await mockManager.registerPreload.mock.calls.find(([id]) => id === "opencode")![1];
      expect(mockManager.onInstallStateChanged).not.toHaveBeenCalled();
    });
    it("preloads an agent its startup upgrade makes ready only after that agent's skills are linked, while other agents preload without waiting (https://github.com/Brevilabs/obsidian-copilot-private/issues/830)", async () => {
      const linked = deferred();
      mockDescriptors[1].onPluginLoad.mockImplementationOnce(async () => {
        mockStates.opencode = { kind: "ready", source: "managed" };
        reconcile.mockReturnValueOnce(linked.promise);
        mockInstallListeners.opencode();
      });
      createAgentSessionManager({} as App, plugin);
      await mockManager.registerPreload.mock.calls.find(([id]) => id === "claude")![1];
      expect(mockManager.preloadModels).toHaveBeenCalledWith("claude");
      expect(mockManager.preloadModels).not.toHaveBeenCalledWith("opencode");
      linked.resolve();
      await mockManager.registerPreload.mock.calls.find(([id]) => id === "opencode")![1];
      expect(mockManager.preloadModels).toHaveBeenCalledWith("opencode");
    });
    it("preloads a repaired installation after the upgrade makes it ready (https://github.com/Brevilabs/obsidian-copilot-private/issues/530)", async () => {
      mockStates.opencode = {
        kind: "incompatible",
        source: "managed",
        currentVersion: "1",
        minVersion: "2",
        message: "Upgrade required",
      };
      mockDescriptors[1].onPluginLoad.mockImplementationOnce(async () => {
        mockStates.opencode = { kind: "ready", source: "managed" };
      });
      createAgentSessionManager({} as App, plugin);
      await mockManager.registerPreload.mock.calls.find(([id]) => id === "opencode")![1];
      expect(mockManager.preloadModels).toHaveBeenCalledWith("opencode");
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

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/833 offers a reload when Obsidian's command line interface is turned on between agent starts, so new chats gain the obsidian_cli steering, without re-reconciling skills", async () => {
      createAgentSessionManager({} as App, plugin);
      await mockManager.registerPreload.mock.calls[0][1];
      const { beforeBackendStart } = jest.mocked(AgentSessionManager).mock.calls[0][2];
      const passes = reconcile.mock.calls.length;

      await beforeBackendStart!("claude");
      expect(mockManager.noteSpawnConfigChanged).not.toHaveBeenCalled();

      jest.mocked(isObsidianCliEnabled).mockReturnValue(true);
      await beforeBackendStart!("claude");
      expect(mockManager.noteSpawnConfigChanged).toHaveBeenCalledWith(
        "opencode",
        "system prompt changed"
      );
      expect(reconcile).toHaveBeenCalledTimes(passes);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/787 offers a reload when the Excalidraw plugin is turned on between agent starts, so new chats gain the Excalidraw steering, without re-reconciling skills", async () => {
      let excalidraw: unknown = null;
      const app = { plugins: { getPlugin: () => excalidraw } } as unknown as App;
      createAgentSessionManager(app, plugin);
      await mockManager.registerPreload.mock.calls[0][1];
      const { beforeBackendStart } = jest.mocked(AgentSessionManager).mock.calls[0][2];
      const passes = reconcile.mock.calls.length;

      await beforeBackendStart!("claude");
      expect(mockManager.noteSpawnConfigChanged).not.toHaveBeenCalled();

      excalidraw = { ea: { executeCLI: jest.fn() } };
      await beforeBackendStart!("claude");
      expect(mockManager.noteSpawnConfigChanged).toHaveBeenCalledWith(
        "opencode",
        "system prompt changed"
      );
      expect(reconcile).toHaveBeenCalledTimes(passes);
    });

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

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/599 offers an OpenCode reload after a builtin skill opt-out is reconciled and changes its system prompt", async () => {
      createAgentSessionManager({} as App, plugin);
      await mockManager.registerPreload.mock.calls[0][1];
      const reconciled = deferred();
      const noted = deferred();
      reconcile.mockReturnValueOnce(reconciled.promise);
      mockManager.noteSpawnConfigChanged.mockImplementationOnce(async () => noted.resolve());

      emitSettingsChange(mockSettings, {
        ...mockSettings,
        agentMode: {
          ...mockSettings.agentMode,
          skills: {
            builtinPreferences: { "copilot-web-search": { disabledAgents: ["opencode"] } },
          },
        },
      } as unknown as CopilotSettings);

      expect(mockManager.noteSpawnConfigChanged).not.toHaveBeenCalled();
      reconciled.resolve();
      await noted.promise;
      expect(mockManager.noteSpawnConfigChanged).toHaveBeenCalledTimes(1);
      expect(mockManager.noteSpawnConfigChanged).toHaveBeenCalledWith(
        "opencode",
        "system prompt changed"
      );
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/736 offers an OpenCode reload once the search switch changes, so new chats gain or drop the Miyo steering", async () => {
      createAgentSessionManager({} as App, plugin);
      await mockManager.registerPreload.mock.calls[0][1];
      const noted = deferred();
      mockManager.noteSpawnConfigChanged.mockImplementationOnce(async () => noted.resolve());
      const withSearch = (enableMiyoSearchSkill: boolean) =>
        ({ ...mockSettings, enableMiyo: true, enableMiyoSearchSkill }) as CopilotSettings;

      mockSettings = withSearch(true);
      emitSettingsChange(withSearch(false), mockSettings);
      await noted.promise;

      expect(mockManager.noteSpawnConfigChanged).toHaveBeenCalledWith(
        "opencode",
        "system prompt changed"
      );
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/740 offers only OpenCode a reload once Miyo document processing changes, so new chats gain or drop the miyo_parse steering", async () => {
      createAgentSessionManager({} as App, plugin);
      await mockManager.registerPreload.mock.calls[0][1];
      const noted = deferred();
      mockManager.noteSpawnConfigChanged.mockImplementationOnce(async () => noted.resolve());
      const withDocuments = (enableMiyoDocumentProcessing: boolean) => ({
        ...mockSettings,
        enableMiyoDocumentProcessing,
      });

      mockSettings = withDocuments(true);
      emitSettingsChange(withDocuments(false), mockSettings);
      await noted.promise;

      expect(mockManager.noteSpawnConfigChanged.mock.calls).toEqual([
        ["opencode", "system prompt changed"],
      ]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/672 offers an OpenCode reload when feedback cards are turned off, so new chats drop the feedback prompt line", () => {
      mockSettings = withCards(true);
      createAgentSessionManager({} as App, plugin);

      emitSettingsChange(withCards(true), withCards(false));

      expect(mockManager.noteSpawnConfigChanged).toHaveBeenCalledTimes(1);
      expect(mockManager.noteSpawnConfigChanged).toHaveBeenCalledWith(
        "opencode",
        "system prompt changed"
      );
    });

    it(`refreshes a spawn-config backend when a model's published effort levels change ${LINEUP_ISSUE}`, () => {
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

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/557 offers an OpenCode reload when enabled model tool support changes", () => {
      createAgentSessionManager({} as App, plugin);

      emitSettingsChange(settingsWith({ toolCall: true }), settingsWith({ toolCall: false }));

      expect(mockManager.noteSpawnConfigChanged).toHaveBeenCalledWith(
        "opencode",
        "model config changed"
      );
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3840 offers an OpenCode reload when an enabled model's context window changes", () => {
      createAgentSessionManager({} as App, plugin);

      emitSettingsChange(settingsWith({}), settingsWith({ limits: { context: 262144 } }));

      expect(mockManager.noteSpawnConfigChanged).toHaveBeenCalledWith(
        "opencode",
        "model config changed"
      );
    });

    it(`leaves a running agent alone when only a model's display metadata changes ${LINEUP_ISSUE}`, () => {
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

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/857 offers a reload to each agent the connector change affects, so its open chats can pick up the new tools", () => {
      const toolSetListeners: Array<(affectsBackend: (backendId: string) => boolean) => void> = [];
      createAgentSessionManager(
        {} as App,
        {
          ...plugin,
          connectorTools: {
            subscribeToToolSetChange: (listener: (typeof toolSetListeners)[number]) => {
              toolSetListeners.push(listener);
              return () => {};
            },
          },
        } as unknown as CopilotPlugin
      );

      toolSetListeners.forEach((listener) => listener((backendId) => backendId === "opencode"));

      expect(mockManager.noteSpawnConfigChanged.mock.calls).toEqual([
        ["opencode", "connectors changed"],
      ]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/860 offers agents suggest_connector on a device with connectors, and reports connected services in a chat's card outcomes", () => {
      jest.mocked(isConnectorsEnabled).mockReturnValue(true);
      createAgentSessionManager(
        {} as App,
        {
          ...plugin,
          connectionManager: {
            getSnapshot: () => ({
              connections: [
                { id: "c1", serviceId: "notion", status: "connected" },
                { id: "c2", serviceId: "linear", status: "needs-login" },
              ],
            }),
          },
        } as unknown as CopilotPlugin
      );

      const hosted = jest.mocked(createCopilotMcpServer).mock.calls[0][1];
      expect(hosted.map(({ definition }) => definition.name)).toContain("suggest_connector");
      expect(connectorCardNote("notion")).toContain("The user connected Notion.");
      expect(connectorCardNote("linear")).toContain("without connecting Linear");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/860 reports no service connected in a chat's card outcomes while the connectors entitlement is off, even with a stored login", () => {
      jest.mocked(isConnectorsEnabled).mockReturnValue(false);
      createAgentSessionManager(
        {} as App,
        {
          ...plugin,
          connectionManager: {
            getSnapshot: () => ({
              connections: [{ id: "c1", serviceId: "notion", status: "connected" }],
            }),
          },
        } as unknown as CopilotPlugin
      );

      expect(connectorCardNote("notion")).toContain("without connecting Notion");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/860 offers no suggest_connector or connector cards where connectors aren't available, such as mobile", () => {
      createAgentSessionManager({} as App, plugin);

      const hosted = jest.mocked(createCopilotMcpServer).mock.calls[0][1];
      expect(hosted.map(({ definition }) => definition.name)).not.toContain("suggest_connector");
      expect(connectorCardsExtension()).toBeUndefined();
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

describe("isCopilotToolOn()", () => {
  const appWith = (excalidraw: unknown): App =>
    ({
      plugins: {
        getPlugin: (id: string) => (id === "obsidian-excalidraw-plugin" ? excalidraw : null),
      },
    }) as unknown as App;
  const noExcalidraw = appWith(null);
  const off = (update: Partial<CopilotSettings>): CopilotSettings =>
    ({
      agentMode: { offerFeedbackCards: false },
      enableMiyo: false,
      ...update,
    }) as CopilotSettings;

  it("follows the feedback-card setting for send_feedback", () => {
    expect(
      isCopilotToolOn(
        "send_feedback",
        off({ agentMode: { offerFeedbackCards: true } as CopilotSettings["agentMode"] }),
        noExcalidraw
      )
    ).toBe(true);
    expect(isCopilotToolOn("send_feedback", off({}), noExcalidraw)).toBe(false);
  });

  it.each([
    ["Miyo is connected and the search switch is on", true, true, true],
    ["the search switch is off", true, false, false],
    ["Miyo is disconnected even though the switch defaults on", false, true, false],
  ])(
    "https://github.com/Brevilabs/obsidian-copilot-private/issues/736 offers miyo_search when %s",
    (_state, enableMiyo, enableMiyoSearchSkill, on) => {
      expect(
        isCopilotToolOn("miyo_search", off({ enableMiyo, enableMiyoSearchSkill }), noExcalidraw)
      ).toBe(on);
    }
  );

  it.each([
    ["Miyo is connected and document processing is on", true, true, true],
    ["document processing is off", true, false, false],
    ["Miyo is disconnected even though document processing defaults on", false, true, false],
  ])(
    "https://github.com/Brevilabs/obsidian-copilot-private/issues/740 offers miyo_parse when %s",
    (_state, enableMiyo, enableMiyoDocumentProcessing, on) => {
      expect(
        isCopilotToolOn(
          "miyo_parse",
          off({ enableMiyo, enableMiyoDocumentProcessing }),
          noExcalidraw
        )
      ).toBe(on);
    }
  );

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/746 offers the OpenArtifacts tools to every user", () => {
    expect(
      isCopilotToolOn("openartifacts_publish", off({ plusLicenseKey: "" }), noExcalidraw)
    ).toBe(true);
  });

  it.each([
    ["on", true],
    ["off", false],
  ])(
    "https://github.com/Brevilabs/obsidian-copilot-private/issues/833 offers obsidian_cli only while Obsidian's command line interface is %s",
    (_state, on) => {
      jest.mocked(isObsidianCliEnabled).mockReturnValue(on);
      expect(isCopilotToolOn("obsidian_cli", off({}), noExcalidraw)).toBe(on);
    }
  );

  it.each([
    ["Excalidraw 2.29 or later is enabled", { ea: { executeCLI: jest.fn() } }, true],
    ["an Excalidraw older than 2.29 has no executeCLI", { ea: {} }, false],
    ["Excalidraw is not enabled", null, false],
  ])(
    "https://github.com/Brevilabs/obsidian-copilot-private/issues/787 offers the Excalidraw tools when %s",
    (_state, excalidraw, on) => {
      for (const name of ["excalidraw_read", "excalidraw_render", "excalidraw_write"]) {
        expect(isCopilotToolOn(name, off({}), appWith(excalidraw))).toBe(on);
      }
    }
  );
});
