import type { App } from "obsidian";
import type CopilotPlugin from "@/main";
import type { InstallState } from "./session/types";
import type { BuiltinSkillRuntime } from "./skills/SkillManager";
import { createAgentSessionManager } from "./index";
import { reconcileBuiltinSkills } from "./skills/builtin/reconcileBuiltinSkills";

jest.mock("@/constants", () => ({}));
jest.mock("@/logger", () => ({ logError: jest.fn() }));
jest.mock("@/settings/model", () => ({
  getSettings: () => ({ agentMode: { skills: {} } }),
  subscribeToSettingsChange: jest.fn(),
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
let mockRuntime: BuiltinSkillRuntime;
const mockStates: Record<string, InstallState> = {};
const mockInstallListeners: Record<string, () => void> = {};
const mockDescriptors = ["claude", "opencode"].map((id) => ({
  id,
  skillsProjectDir: `.${id}/skills`,
  getInstallState: () => mockStates[id],
  subscribeInstallState: (_plugin: unknown, listener: () => void) => {
    mockInstallListeners[id] = listener;
  },
}));
const mockRefresh = jest.fn<Promise<unknown>, unknown[]>();
const mockManager = {
  preloadModels: jest.fn(async () => {}),
  registerPreload: jest.fn<void, [string, Promise<void>]>(),
  onInstallStateChanged: jest.fn(async (_id: string) => {}),
};
const plugin = {
  modelManagement: {
    providerRegistry: { subscribe: jest.fn() },
    backendConfigRegistry: { subscribe: jest.fn() },
  },
} as unknown as CopilotPlugin;
const reconcile = jest.mocked(reconcileBuiltinSkills);
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
