import type { App } from "obsidian";
import type CopilotPlugin from "@/main";
import type { CopilotSettings } from "@/settings/model";
import type { InstallState } from "./session/types";
import type { BuiltinSkillRuntime } from "./skills/SkillManager";
import { TFile } from "obsidian";
import { backendRegistry } from "./backends/registry";
import {
  createAgentSessionClient,
  createAgentSessionHost,
  createAgentSessionManager,
  isRegisteredBackend,
  resolveVaultNote,
} from "./index";
import type { AgentSessionManager } from "./session/AgentSessionManager";
import { reconcileBuiltinSkills } from "./skills/builtin/reconcileBuiltinSkills";
import { BackendConfigRegistry } from "@/modelManagement";

jest.mock("@/constants", () => ({}));
jest.mock("@/logger", () => ({ logError: jest.fn() }));
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
  buildAgentSystemPrompt: (id: string) =>
    `prompt:${id}:${JSON.stringify(mockSettings.agentMode.skills.builtinPreferences ?? {})}`,
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

    it("does not restart a backend for installation writes while its upgrade owns startup (https://github.com/Brevilabs/obsidian-copilot-private/issues/530)", async () => {
      const upgrade = deferred();
      mockDescriptors[1].onPluginLoad.mockReturnValueOnce(upgrade.promise);
      createAgentSessionManager({} as App, plugin);
      mockInstallListeners.opencode();
      upgrade.resolve();
      await mockManager.registerPreload.mock.calls.find(([id]) => id === "opencode")![1];
      expect(mockManager.onInstallStateChanged).not.toHaveBeenCalled();
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

  describe("resolveVaultNote()", () => {
    const app = (entry: unknown) =>
      ({ vault: { getAbstractFileByPath: () => entry } }) as unknown as App;

    it("returns the file for a vault path that names a note", () => {
      const file = Object.assign(new TFile(), { path: "Projects/plan.md" });
      expect(resolveVaultNote(app(file), "Projects//plan.md")).toBe(file);
    });

    it("returns null for a missing path or a path that names a folder", () => {
      expect(resolveVaultNote(app(null), "nope.md")).toBeNull();
      expect(resolveVaultNote(app({ path: "Projects", children: [] }), "Projects")).toBeNull();
    });
  });

  describe("isRegisteredBackend()", () => {
    it("recognizes registered backend ids and rejects inherited object keys", () => {
      (backendRegistry as Record<string, unknown>).claude = {};
      expect(isRegisteredBackend("claude")).toBe(true);
      expect(isRegisteredBackend("toString")).toBe(false);
      expect(isRegisteredBackend("mystery")).toBe(false);
    });
  });

  describe("createAgentSessionHost()", () => {
    const manager = {
      subscribe: jest.fn(() => () => {}),
      getSessions: () => [],
      getTabSessions: () => [],
    } as unknown as AgentSessionManager;

    function build(entries: Record<string, unknown>) {
      const app = {
        vault: { getAbstractFileByPath: (path: string) => entries[path] ?? null },
      } as unknown as App;
      const host = createAgentSessionHost(
        app,
        { manifest: { version: "9.9.9" } } as CopilotPlugin,
        manager
      );
      return host;
    }

    it("hosts the manager's sessions and announces the plugin version in hello", () => {
      const host = build({});
      const sent: unknown[] = [];
      host.connect((frame) => sent.push(frame)).receive({ type: "hello", v: 1, app: "phone" });
      expect(sent[0]).toMatchObject({ type: "hello", app: "9.9.9", ok: true });
    });
  });

  describe("createAgentSessionClient()", () => {
    it("connects the desktop panel to the host and receives the tab set https://github.com/Brevilabs/obsidian-copilot-private/issues/611", async () => {
      const manager = {
        subscribe: jest.fn(() => () => {}),
        getSessions: () => [],
        getTabSessions: () => [],
      } as unknown as AgentSessionManager;
      const host = createAgentSessionHost(
        {} as App,
        { manifest: { version: "9.9.9" } } as CopilotPlugin,
        manager
      );
      const client = createAgentSessionClient(host);

      await new Promise((resolve) => window.setTimeout(resolve, 0));

      expect(client.getConnection()).toBe("live");
      expect(client.getHost()).toEqual({ tabs: [] });
      client.dispose();
      host.dispose();
    });
  });
});
