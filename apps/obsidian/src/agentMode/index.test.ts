import type { App } from "obsidian";
import type CopilotPlugin from "@/main";
import type { CopilotSettings } from "@/settings/model";
import type { InstallState } from "./session/types";
import type { BuiltinSkillRuntime } from "./skills/SkillManager";
import { createAgentSessionManager, isCopilotToolOn, startCustomAgentChat } from "./index";
import { loadAgentSessionPrompt } from "@/agents/agentSessionPrompt";
import type { CustomAgentStore } from "@/agents/CustomAgentStore";
import { trackTabStripShown } from "./ui/trackTabStripShown";
import { AgentSessionManager } from "./session/AgentSessionManager";
import { reconcileBuiltinSkills } from "./skills/builtin/reconcileBuiltinSkills";
import { BackendConfigRegistry } from "@/modelManagement";
import { isObsidianCliEnabled } from "@/services/obsidianCli/ObsidianCliClient";
import { createCopilotMcpServer } from "./session/copilotMcpServer";
import { isConnectorsEnabled } from "@/connectors/connectorsEntitlement";
import { createDefaultPermissionPrompter } from "./ui/permissionPrompter";
import { fakeChat } from "./session/testing/fakeChat";
import { buildNativeChatId } from "@/utils/nativeChatId";
import { AGENT_DRAFT_CARD, AGENT_DRAFT_CARD_EXTENSION } from "@/agents/agentMode/agentDraftCard";

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
  getActiveBackendDescriptor: () => mockDescriptors[0],
  listBackendDescriptors: () => mockDescriptors,
  findBackendForModel: (settings: unknown, baseModelId: string) =>
    mockDescriptors.find((descriptor) =>
      (descriptor as { getEnabledModelEntries?: (s: unknown) => { baseModelId: string }[] })
        .getEnabledModelEntries?.(settings)
        ?.some((entry) => entry.baseModelId === baseModelId)
    ),
}));
jest.mock("./session/AgentChatPersistenceManager", () => ({
  AgentChatPersistenceManager: jest.fn(),
}));
jest.mock("./session/AgentModelPreloader", () => ({ AgentModelPreloader: jest.fn() }));
let mockAskedConversations: unknown[] = [];
jest.mock("./session/AgentSessionIndex", () => ({
  AgentSessionIndex: jest.fn(() => ({ getAskedConversations: async () => mockAskedConversations })),
}));
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
jest.mock("@/agents/agentSessionPrompt", () => ({
  ...jest.requireActual("@/agents/agentSessionPrompt"),
  loadAgentSessionPrompt: jest.fn(),
}));
let mockCustomAgentsGate = "full";
const mockGateListeners: Array<() => void> = [];
jest.mock("@/agents/customAgentsGate", () => ({
  getCustomAgentsGate: () => mockCustomAgentsGate,
  subscribeToCustomAgentsGate: (listener: () => void) => {
    mockGateListeners.push(listener);
    return () => {};
  },
}));
jest.mock("@/utils/vaultPath", () => ({ getVaultBase: () => "/vault" }));

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
let customAgents: CustomAgentStore;
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
      mockGateListeners.length = 0;
      mockAskedConversations = [];
      mockCustomAgentsGate = "full";
      mockSettings = settingsWith({ reasoning: true });
      customAgents = {
        getAgents: () => [],
        subscribe: () => () => {},
      } as unknown as CustomAgentStore;
      plugin = {
        manifest: { id: "copilot" },
        register: jest.fn(),
        modelManagement: {
          providerRegistry: { subscribe: jest.fn() },
          backendConfigRegistry: new BackendConfigRegistry(
            {} as ConstructorParameters<typeof BackendConfigRegistry>[0],
            {} as ConstructorParameters<typeof BackendConfigRegistry>[1]
          ),
        },
      } as unknown as CopilotPlugin;
    });

    it("refreshes built-in availability when a license key is removed without a paid-status change https://github.com/logancyang/obsidian-copilot/issues/4239", async () => {
      createAgentSessionManager({} as App, plugin, customAgents);
      await mockManager.registerPreload.mock.calls[0][1];
      mockRefresh.mockClear();
      emitSettingsChange(
        { ...mockSettings, isPaidUser: true, plusLicenseKey: "test-license" },
        { ...mockSettings, isPaidUser: true, plusLicenseKey: "" }
      );
      expect(mockRefresh).toHaveBeenCalledTimes(1);
      await mockRefresh.mock.results[0].value;
      expect(reconcile).toHaveBeenLastCalledWith(
        expect.objectContaining({ settings: expect.objectContaining({ plusLicenseKey: "" }) })
      );
    });

    it("gives the manager the plugin's custom agents to start a chat as one", async () => {
      const agent = {
        slug: "coco",
        name: "Coco",
        prompt: "In this chat you are Coco.",
        memoryPath: "/vault/copilot/teammates/coco/MEMORY.md",
      };
      jest.mocked(loadAgentSessionPrompt).mockResolvedValueOnce(agent);
      const store = { ...customAgents } as CustomAgentStore;
      createAgentSessionManager({} as App, plugin, store);

      const resolved = await jest
        .mocked(AgentSessionManager)
        .mock.calls[0][2].resolveAgent?.("coco");

      expect(resolved).toBe(agent);
      expect(loadAgentSessionPrompt).toHaveBeenCalledWith(store, "coco", "/vault");
    });

    it("tells the manager whether a tab strip holds its chats as the workspace layout changes for https://github.com/Brevilabs/obsidian-copilot-private/issues/849", () => {
      const { manager } = createAgentSessionManager({} as App, plugin, customAgents);

      expect(trackTabStripShown).toHaveBeenCalledWith(plugin, manager);
    });

    it("waits for each backend upgrade before preloading while other agents remain usable (https://github.com/Brevilabs/obsidian-copilot-private/issues/530)", async () => {
      const upgrade = deferred();
      mockStates.opencode = { kind: "ready", source: "managed" };
      mockDescriptors[1].onPluginLoad.mockReturnValueOnce(upgrade.promise);
      createAgentSessionManager({} as App, plugin, customAgents);
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
      createAgentSessionManager({} as App, plugin, customAgents);
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
      createAgentSessionManager({} as App, plugin, customAgents);
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
      createAgentSessionManager({} as App, plugin, customAgents);
      await mockManager.registerPreload.mock.calls.find(([id]) => id === "opencode")![1];
      expect(mockManager.preloadModels).toHaveBeenCalledWith("opencode");
    });
    it(`waits for initial skill reconciliation before preloading ready agents ${ISSUE}`, async () => {
      const gate = deferred();
      reconcile.mockReturnValue(gate.promise);
      expect(createAgentSessionManager({} as App, plugin, customAgents).manager).toBe(mockManager);
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
        createAgentSessionManager({} as App, plugin, customAgents);
        await mockManager.registerPreload.mock.calls[0][1];
        expect(mockManager.preloadModels).toHaveBeenCalledWith("claude");
      }
    );

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/833 offers a reload when Obsidian's command line interface is turned on between agent starts, so new chats gain the obsidian_cli steering, without re-reconciling skills", async () => {
      createAgentSessionManager({} as App, plugin, customAgents);
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
      createAgentSessionManager(app, plugin, customAgents);
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
      createAgentSessionManager({} as App, plugin, customAgents);
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
      createAgentSessionManager({} as App, plugin, customAgents);
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
      createAgentSessionManager({} as App, plugin, customAgents);
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
      createAgentSessionManager({} as App, plugin, customAgents);
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
      createAgentSessionManager({} as App, plugin, customAgents);

      emitSettingsChange(withCards(true), withCards(false));

      expect(mockManager.noteSpawnConfigChanged).toHaveBeenCalledTimes(1);
      expect(mockManager.noteSpawnConfigChanged).toHaveBeenCalledWith(
        "opencode",
        "system prompt changed"
      );
    });

    it(`refreshes a spawn-config backend when a model's published effort levels change ${LINEUP_ISSUE}`, () => {
      createAgentSessionManager({} as App, plugin, customAgents);

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
      createAgentSessionManager({} as App, plugin, customAgents);

      emitSettingsChange(settingsWith({ toolCall: true }), settingsWith({ toolCall: false }));

      expect(mockManager.noteSpawnConfigChanged).toHaveBeenCalledWith(
        "opencode",
        "model config changed"
      );
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3840 offers an OpenCode reload when an enabled model's context window changes", () => {
      createAgentSessionManager({} as App, plugin, customAgents);

      emitSettingsChange(settingsWith({}), settingsWith({ limits: { context: 262144 } }));

      expect(mockManager.noteSpawnConfigChanged).toHaveBeenCalledWith(
        "opencode",
        "model config changed"
      );
    });

    it(`leaves a running agent alone when only a model's display metadata changes ${LINEUP_ISSUE}`, () => {
      createAgentSessionManager({} as App, plugin, customAgents);

      emitSettingsChange(
        settingsWith({ reasoning: true, description: "A frontier open model." }),
        settingsWith({ reasoning: true, description: "A frontier open-weight model." })
      );

      expect(mockManager.noteSpawnConfigChanged).not.toHaveBeenCalled();
      expect(mockManager.restartBackend).not.toHaveBeenCalled();
    });

    it(`offers an OpenCode reload when its enabled models change ${RELOAD_ISSUE}`, async () => {
      createAgentSessionManager({} as App, plugin, customAgents);

      await plugin.modelManagement.backendConfigRegistry.disableModel("opencode", "configured-1");

      expect(mockManager.noteSpawnConfigChanged).toHaveBeenCalledTimes(1);
      expect(mockManager.noteSpawnConfigChanged).toHaveBeenCalledWith(
        "opencode",
        "model config changed"
      );
    });

    it(`does not offer an OpenCode reload when a Claude model is disabled or re-enabled ${RELOAD_ISSUE}`, async () => {
      createAgentSessionManager({} as App, plugin, customAgents);

      await plugin.modelManagement.backendConfigRegistry.disableModel("claude", "claude-haiku");
      expect(plugin.modelManagement.backendConfigRegistry.get("claude").enabledModels).toEqual([]);
      expect(mockManager.noteSpawnConfigChanged).not.toHaveBeenCalled();

      await plugin.modelManagement.backendConfigRegistry.enableModel("claude", "claude-haiku");
      expect(mockManager.noteSpawnConfigChanged).not.toHaveBeenCalled();
    });

    it(`ignores model metadata changes outside OpenCode's enabled list ${RELOAD_ISSUE}`, () => {
      createAgentSessionManager({} as App, plugin, customAgents);
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
      createAgentSessionManager({} as App, plugin, customAgents);

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
        createAgentSessionManager({} as App, plugin, customAgents);
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
      createAgentSessionManager({} as App, plugin, customAgents);

      emitSettingsChange(mockSettings, { ...mockSettings, providers: {} });

      expect(mockManager.noteSpawnConfigChanged).toHaveBeenCalledWith(
        "opencode",
        "model config changed"
      );
    });

    it(`routes a Claude environment change only to Claude ${RELOAD_ISSUE}`, () => {
      createAgentSessionManager({} as App, plugin, customAgents);
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
        } as unknown as CopilotPlugin,
        customAgents
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
        } as unknown as CopilotPlugin,
        customAgents
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
        } as unknown as CopilotPlugin,
        customAgents
      );

      expect(connectorCardNote("notion")).toContain("without connecting Notion");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/860 offers no suggest_connector or connector cards where connectors aren't available, such as mobile", () => {
      createAgentSessionManager({} as App, plugin, customAgents);

      const hosted = jest.mocked(createCopilotMcpServer).mock.calls[0][1];
      expect(hosted.map(({ definition }) => definition.name)).not.toContain("suggest_connector");
      expect(connectorCardsExtension()).toBeUndefined();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/944 offers ask_teammate among Copilot's tools and stops the agents it asked when the plugin unloads", () => {
      createAgentSessionManager({} as App, plugin, customAgents);

      const hosted = jest.mocked(createCopilotMcpServer).mock.calls[0][1];
      expect(hosted.map(({ definition }) => definition.name)).toContain("ask_teammate");
      expect(plugin.register).toHaveBeenCalledWith(expect.any(Function));
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/944 has the agents list Copilot's tools again when custom agents turn unavailable or available, so OpenCode's shared listing follows a license entered while it runs", () => {
      const notifyToolsChanged = jest.fn();
      const { createCopilotMcpServer: create } = jest.requireActual<
        typeof import("./session/copilotMcpServer")
      >("./session/copilotMcpServer");
      jest
        .mocked(createCopilotMcpServer)
        .mockImplementationOnce((...args) => ({ ...create(...args), notifyToolsChanged }));
      createAgentSessionManager({} as App, plugin, customAgents);

      mockCustomAgentsGate = "locked";
      mockGateListeners.forEach((listener) => listener());
      mockGateListeners.forEach((listener) => listener());
      mockCustomAgentsGate = "full";
      mockGateListeners.forEach((listener) => listener());

      expect(notifyToolsChanged).toHaveBeenCalledTimes(2);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/987 has the agents list Copilot's tools again when the first agent is created, and offers the asking tools to a Copilot chat from then on", () => {
      const notifyToolsChanged = jest.fn();
      const { createCopilotMcpServer: create } = jest.requireActual<
        typeof import("./session/copilotMcpServer")
      >("./session/copilotMcpServer");
      jest
        .mocked(createCopilotMcpServer)
        .mockImplementationOnce((...args) => ({ ...create(...args), notifyToolsChanged }));
      let agents: unknown[] = [];
      const storeListeners: Array<() => void> = [];
      const store = {
        getAgents: () => agents,
        subscribe: (listener: () => void) => {
          storeListeners.push(listener);
          return () => {};
        },
      } as unknown as CustomAgentStore;
      Object.assign(mockManager, { isUnlistedSession: () => false });
      createAgentSessionManager({} as App, plugin, store);
      const askAgent = jest
        .mocked(createCopilotMcpServer)
        .mock.calls[0][1].find(({ definition }) => definition.name === "ask_teammate")!;
      const copilotChat = { sessionKey: "copilot-chat", backendId: "claude" as const };

      expect(askAgent.listedAs?.(copilotChat)).toBeNull();
      agents = [{ slug: "maya", name: "Maya" }];
      storeListeners.forEach((listener) => listener());

      expect(notifyToolsChanged).toHaveBeenCalledTimes(1);
      expect(askAgent.listedAs?.(copilotChat)?.name).toBe(askAgent.definition.name);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/945 offers check_teammate, answer_teammate, stop_teammate and ask_user and hands the profile's delete the asked agents' chats to stop", () => {
      const { hiddenAgentChats } = createAgentSessionManager({} as App, plugin, customAgents);

      const hosted = jest.mocked(createCopilotMcpServer).mock.calls[0][1];
      expect(hosted.map(({ definition }) => definition.name)).toEqual(
        expect.arrayContaining(["check_teammate", "answer_teammate", "stop_teammate", "ask_user"])
      );
      expect(hiddenAgentChats).toEqual(
        expect.objectContaining({ stopAgent: expect.any(Function) })
      );
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/941 offers draft_teammate to every chat the user sees, with or without a custom agent, refuses a hidden chat's call, and keeps the draft card with the chat", async () => {
      const coco = Object.assign(fakeChat(), { agentSlug: "coco" });
      const copilot = Object.assign(fakeChat(), { agentSlug: null });
      Object.assign(mockManager, {
        getSession: (key: string) => ({ "coco-chat": coco, "copilot-chat": copilot })[key],
        getSessions: () => [coco, copilot],
        isUnlistedSession: (key: string) => key === "hidden-chat",
      });
      createAgentSessionManager({} as App, plugin, customAgents);
      const draftAgent = jest
        .mocked(createCopilotMcpServer)
        .mock.calls[0][1].find(({ definition }) => definition.name === "draft_teammate")!;
      const listedFor = (sessionKey: string) =>
        draftAgent.listedAs?.({ sessionKey, backendId: "claude" }) ?? null;
      const nora = { name: "Nora", title: "", instruction: "You plan pickups." };

      expect(listedFor("coco-chat")).not.toBeNull();
      expect(listedFor("copilot-chat")).not.toBeNull();
      expect(listedFor("hidden-chat")).toBeNull();
      expect((await draftAgent.call(nora, fakeChat())).text).toContain(
        "Only a chat the user sees can draft an AI teammate"
      );
      expect((await draftAgent.call(nora, coco)).text).toContain("Shown to the user as a card");
      expect(coco.readChatState(AGENT_DRAFT_CARD)?.draftedBy).toBe("coco");
      expect((await draftAgent.call(nora, copilot)).text).toContain("Shown to the user as a card");
      expect(copilot.readChatState(AGENT_DRAFT_CARD)?.draftedBy).toBeNull();
      expect(jest.mocked(AgentSessionManager).mock.calls[0][2].chatExtensions).toContain(
        AGENT_DRAFT_CARD_EXTENSION
      );
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/959 lists an agent's own earlier chats without the calling chat, and turns down a chat no list shows (https://github.com/Brevilabs/obsidian-copilot-private/issues/987)", async () => {
      const at = new Date(2026, 10, 11);
      const item = (id: string, title: string, agent?: string) => ({
        id,
        title,
        createdAt: at,
        lastAccessedAt: at,
        ...(agent ? { agent } : {}),
      });
      const juno = Object.assign(fakeChat(), {
        agentSlug: "juno",
        internalId: "juno-chat",
        backendId: "claude",
        getBackendSessionId: () => "s-now",
      });
      Object.assign(mockManager, {
        getSessions: () => [juno],
        getSessionSourcePath: (internalId: string) =>
          internalId === "juno-chat" ? "chats/this-chat.md" : "",
        getChatHistoryItems: async () => [
          item("chats/this-chat.md", "This chat", "juno"),
          item(buildNativeChatId("claude", "s-now"), "This chat, by its backend id", "juno"),
          item("chats/plan.md", "Release video plan", "juno"),
          item("chats/rex.md", "Podcast sponsorship", "rex"),
        ],
      });
      createAgentSessionManager({} as App, plugin, customAgents);
      const listChats = jest
        .mocked(createCopilotMcpServer)
        .mock.calls[0][1].find(({ definition }) => definition.name === "list_chats")!;

      expect((await listChats.call({}, fakeChat())).text).toBe(
        "This chat can't list earlier chats. Don't call list_chats again."
      );
      const { text } = await listChats.call({}, juno);
      expect(text).toContain("- 2026-11-11 · Release video plan · /vault/chats/plan.md");
      expect(text).not.toContain("This chat");
      expect(text).not.toContain("Podcast sponsorship");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/980 lists the conversations the calling agent was asked into, naming who asked and the asking chat by its title", async () => {
      const at = new Date(2026, 10, 11);
      const juno = Object.assign(fakeChat(), {
        agentSlug: "juno",
        internalId: "juno-chat",
        backendId: "claude",
        getBackendSessionId: () => "s-now",
      });
      Object.assign(mockManager, {
        getSessions: () => [juno],
        getSessionSourcePath: () => "",
        getChatHistoryItems: async () => [
          {
            id: "chats/rex.md",
            title: "Podcast sponsorship",
            createdAt: at,
            lastAccessedAt: at,
            agent: "rex",
            backendId: "codex",
            sessionId: "rex-chat",
          },
        ],
      });
      mockAskedConversations = [
        {
          backendId: "claude",
          sessionId: "juno-hidden",
          agent: "juno",
          askedBy: "rex",
          askedIn: { backendId: "codex", sessionId: "rex-chat" },
          firstAtMs: at.getTime(),
          lastAtMs: at.getTime(),
          asks: 1,
          firstAsk: "Which sponsor fits?",
          latestAnswer: "The note-taking app.",
          ending: "finished",
        },
      ];
      const store = {
        getAgents: () => [{ slug: "rex", name: "Rex" }],
        subscribe: () => () => {},
      } as unknown as CustomAgentStore;
      createAgentSessionManager({} as App, plugin, store);
      const listChats = jest
        .mocked(createCopilotMcpServer)
        .mock.calls[0][1].find(({ definition }) => definition.name === "list_chats")!;

      const { text } = await listChats.call({}, juno);

      expect(text).toContain(
        '- 2026-11-11 · Rex asked you in "Podcast sponsorship" · times asked: 1 · first ask: "Which sponsor fits?" · your latest answer: "The note-taking app."'
      );
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/944 hands a permission request no asked agent made to the chat's own prompter", async () => {
      const chatPrompter = jest.fn(async () => ({ outcome: { outcome: "cancelled" as const } }));
      jest.mocked(createDefaultPermissionPrompter).mockReturnValueOnce(chatPrompter);
      createAgentSessionManager({} as App, plugin, customAgents);
      const request = {
        sessionId: "chat-session",
        toolCall: { toolCallId: "t", title: "Edit" },
        options: [],
      };

      await jest.mocked(AgentSessionManager).mock.calls[0][2].permissionPrompter(request);

      expect(chatPrompter).toHaveBeenCalledWith(request);
    });

    it(`retains only previously ready agents during compatibility checks ${ISSUE}`, async () => {
      createAgentSessionManager({} as App, plugin, customAgents);
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

  describe("startCustomAgentChat()", () => {
    function startWith(model: { baseModelId: string; effort: string | null } | null) {
      const manager = {
        getSeedSelection: jest.fn((_backendId: string, preferred: unknown) => preferred),
        createSession: jest.fn(async () => ({})),
      };
      mockDescriptors.forEach((descriptor) => {
        mockStates[descriptor.id] = { kind: "ready", source: "managed" };
        Object.assign(descriptor, {
          getEnabledModelEntries: () => [
            { baseModelId: `${descriptor.id}-model`, credentialState: "ok" },
          ],
        });
      });
      const started = startCustomAgentChat(manager as unknown as AgentSessionManager, {
        slug: "coco",
        name: "Coco",
        model,
      });
      return { manager, started };
    }

    it("starts the agent's chat as that agent on the backend that runs its model, on that model", async () => {
      const model = { baseModelId: "opencode-model", effort: null };

      const { manager, started } = startWith(model);
      await started;

      expect(manager.createSession).toHaveBeenCalledWith(
        "opencode",
        undefined,
        model,
        undefined,
        "coco"
      );
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/937 starts an agent with no model on the default agent backend and its default model", async () => {
      const { manager, started } = startWith(null);
      await started;

      expect(manager.getSeedSelection).not.toHaveBeenCalled();
      expect(manager.createSession).toHaveBeenCalledWith(
        undefined,
        undefined,
        undefined,
        undefined,
        "coco"
      );
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/962 refuses an agent whose model no backend runs here, before any chat opens", async () => {
      const { manager, started } = startWith({ baseModelId: "gpt-6", effort: null });

      await expect(started).rejects.toThrow("Coco's model, gpt-6, isn't available on this device.");
      expect(manager.createSession).not.toHaveBeenCalled();
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
