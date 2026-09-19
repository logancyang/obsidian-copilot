import { App, FileSystemAdapter } from "obsidian";
import { waitFor } from "@testing-library/react";
import type CopilotPlugin from "@/main";
import type { CopilotSettings } from "@/settings/model";
import { createAgentSessionManager } from "@/agentMode/index";
import { CodexBackendDescriptor } from "@/agentMode/backends/codex/descriptor";
import { AgentSession } from "@/agentMode/session/AgentSession";
import type { BackendDescriptor, BackendProcess, BackendState } from "@/agentMode/session/types";
import { MethodUnsupportedError } from "@/agentMode/session/errors";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/settings/model", () => ({
  getSettings: () => mockSettings,
  setSettings: (update: (settings: CopilotSettings) => Partial<CopilotSettings>) => {
    emitSettings({ ...mockSettings, ...update(mockSettings) });
  },
  subscribeToSettingsChange: (cb: (prev: CopilotSettings, next: CopilotSettings) => void) => {
    mockSettingsListeners.add(cb);
    return () => mockSettingsListeners.delete(cb);
  },
  settingsStore: { get: jest.fn(() => ({})), set: jest.fn() },
}));
jest.mock("@/agentMode/backends/registry", () => ({
  backendRegistry: {
    get codex() {
      return mockDescriptor;
    },
  },
  listBackendDescriptors: () => [mockDescriptor],
}));
jest.mock("@/agentMode/skills", () => ({
  SkillManager: {
    initialize: () => ({ refresh: mockRefreshSkills, subscribeToSkillSetChange: jest.fn() }),
  },
}));
jest.mock("@/agentMode/skills/builtin/reconcileBuiltinSkills", () => ({
  availableBuiltinAgents: () => [],
  reconcileBuiltinSkills: jest.fn(),
}));
jest.mock("@/agentMode/skills/builtin/miyoSearchSeed", () => ({ buildBuiltinSeedFs: jest.fn() }));
jest.mock("@/settings/copilotFolder", () => ({ deriveSkillsFolder: () => "copilot/skills" }));
jest.mock("@/settings/builtinSkillPreferences", () => ({ saveBuiltinPreferences: jest.fn() }));
jest.mock("@/system-prompts/state", () => ({ subscribeToSystemPromptChange: jest.fn() }));
jest.mock("@/utils/appPaths", () => ({
  copilotAppDataDir: () => "/test/copilot",
  getVaultId: () => "test",
}));
jest.mock("@/agentMode/backends/shared/agentSystemPrompt", () => ({
  buildAgentSystemPrompt: () => "",
}));
jest.mock("@/agentMode/backends/shared/builtinSkillEnv", () => ({
  getBuiltinSkillEnvRestartPolicy: () => "none",
}));
jest.mock("@/agentMode/session/AgentChatPersistenceManager", () => ({
  AgentChatPersistenceManager: jest.fn(),
}));
jest.mock("@/agentMode/session/AgentSessionIndex", () => ({
  AgentSessionIndex: jest.fn(() => ({
    recordSession: jest.fn(),
    touch: jest.fn(),
    flush: jest.fn(),
  })),
}));
jest.mock("@/agentMode/session/nodeFileStorage", () => ({ createNodeFileStorage: jest.fn() }));
jest.mock("@/agentMode/session/copilotDefaultModel", () => ({
  seedCopilotDefaultModel: jest.fn(),
}));
jest.mock("@/instructions/agentsFile", () => ({
  ensureAgentsFileForDiscovery: jest.fn(async () => undefined),
}));
jest.mock("@/agentMode/ui/permissionPrompter", () => ({
  createDefaultPermissionPrompter: jest.fn(),
  createDefaultAskUserQuestionPrompter: jest.fn(),
}));
jest.mock("@/agentMode/ui/AgentModeChat", () => ({}));
jest.mock("@/agentMode/ui/CopilotAgentView", () => ({}));
jest.mock("@/agentMode/ui/useBackendDescriptor", () => ({}));
jest.mock("@/agentMode/ui/useAgentModelPicker", () => ({}));
jest.mock("@/agentMode/ui/useAgentModePicker", () => ({}));
jest.mock("@/agentMode/ui/AgentDefaultModelSetting", () => ({}));
jest.mock("@/agentMode/ui/PlanPreviewView", () => ({}));
jest.mock("@/agentMode/ui/ReportIssueModal", () => ({}));
jest.mock("@/agentMode/backends/shared/ui/AgentBackendHeader", () => ({}));
jest.mock("@/agentMode/backends/codex/CodexInstallModal", () => ({}));
jest.mock("@/agentMode/backends/codex/CodexSettingsPanel", () => ({}));
jest.mock("@/agentMode/session/useBackendAuthState", () => ({}));

const mockSettingsListeners = new Set<(prev: CopilotSettings, next: CopilotSettings) => void>();
let mockSettings: CopilotSettings;
let mockDescriptor: BackendDescriptor;
const mockRefreshSkills = jest.fn<Promise<void>, []>(async () => undefined);

function emitSettings(next: CopilotSettings): void {
  const prev = mockSettings;
  mockSettings = next;
  for (const listener of mockSettingsListeners) listener(prev, next);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("AgentSessionManager install recovery", () => {
  describe("AgentSessionManager", () => {
    describe("resumeRecoverySelection()", () => {
      it.each(["single", "queued", "lazy startup"])(
        "creates one selected chat after %s managed-upgrade settings subscriptions settle (https://github.com/Brevilabs/obsidian-copilot-private/issues/480)",
        async (notifications) => {
          mockSettingsListeners.clear();
          mockRefreshSkills.mockReset().mockResolvedValue(undefined);
          const selection = { baseModelId: "gpt-6-astra", effort: "medium" };
          mockSettings = {
            agentMode: {
              activeBackend: "codex",
              backends: {
                codex: {
                  binaryPath: "/managed/codex",
                  binaryVersion: "old",
                  binarySource: "managed",
                  defaultModel: selection,
                },
              },
              skills: { builtinPreferences: {} },
            },
            backends: {},
            providers: {},
            configuredModels: [],
            autosaveChat: false,
          } as unknown as CopilotSettings;
          const firstSession = deferred();
          let nextId = 0;
          const state: BackendState = {
            model: {
              current: selection,
              availableModels: [
                {
                  baseModelId: selection.baseModelId,
                  name: "GPT-6 Astra",
                  provider: null,
                  effortOptions: [{ value: "medium", label: "Medium" }],
                },
              ],
              apply: { kind: "setModel" },
            },
            mode: null,
          };
          const newSession = jest.fn(async () => {
            const id = ++nextId;
            if (id === 1) await firstSession.promise;
            return { sessionId: `session-${id}`, state };
          });
          mockDescriptor = {
            ...CodexBackendDescriptor,
            onPluginLoad: undefined,
            getInstallState: (settings) =>
              settings.agentMode.backends.codex?.binaryVersion === "old"
                ? {
                    kind: "incompatible",
                    source: "managed",
                    currentVersion: "old",
                    minVersion: "new",
                    message: "Upgrade required",
                  }
                : { kind: "ready", source: "managed" },
            createBackendProcess: () => {
              let running = true;
              return {
                start: async () => undefined,
                isRunning: () => running,
                shutdown: async () => {
                  running = false;
                },
                onExit: () => () => {},
                registerSessionHandler: () => () => {},
                setPermissionPrompter: () => {},
                newSession,
                cancel: async () => undefined,
                setSessionModel: async () => state,
                loadSession: async () => {
                  throw new MethodUnsupportedError("load");
                },
                resumeSession: async () => {
                  throw new MethodUnsupportedError("resume");
                },
              } as unknown as BackendProcess;
            },
          };
          const events = { on: jest.fn(() => ({})), offref: jest.fn() };
          const app = {
            vault: {
              ...events,
              adapter: new (FileSystemAdapter as unknown as new (path: string) => unknown)(
                "/vault"
              ),
              getAbstractFileByPath: () => null,
              getFiles: () => [],
            },
            metadataCache: events,
            workspace: { getLeavesOfType: () => [] },
          } as unknown as App;
          const plugin = {
            manifest: { version: "test" },
            modelManagement: { providerRegistry: { subscribe: jest.fn() } },
          } as unknown as CopilotPlugin;
          const manager = createAgentSessionManager(app, plugin);
          const starts = jest.spyOn(AgentSession, "start");
          const installRefresh = jest.spyOn(manager, "onInstallStateChanged");
          const skills = deferred();
          mockRefreshSkills.mockReturnValueOnce(skills.promise);
          try {
            if (notifications !== "lazy startup")
              manager.deferRecoverySelection("codex", selection);
            emitSettings({
              ...mockSettings,
              agentMode: {
                ...mockSettings.agentMode,
                backends: {
                  ...mockSettings.agentMode.backends,
                  codex: { ...mockSettings.agentMode.backends.codex, binaryVersion: "new" },
                },
              },
            });
            const recovery =
              notifications === "lazy startup"
                ? manager.getOrCreateActiveSession()
                : manager.resumeRecoverySelection();
            if (notifications === "queued")
              emitSettings({
                ...mockSettings,
                agentMode: {
                  ...mockSettings.agentMode,
                  backends: {
                    ...mockSettings.agentMode.backends,
                    codex: { ...mockSettings.agentMode.backends.codex, binaryVersion: "newer" },
                  },
                },
              });
            await new Promise((resolve) => window.setTimeout(resolve, 0));
            const startedBeforeSkills = starts.mock.calls.length;
            skills.resolve();
            await waitFor(() =>
              expect(installRefresh).toHaveBeenCalledTimes(notifications === "queued" ? 2 : 1)
            );
            firstSession.resolve();
            await recovery;
            await Promise.all(installRefresh.mock.results.map((result) => result.value));
            await waitFor(() => expect(manager.isBackendRestartPending("codex")).toBe(false));
            await manager.getOrCreateActiveSession();
            await Promise.all(manager.getSessions().map((session) => session.ready));
            expect(manager.getSessions()).toHaveLength(1);
            expect(manager.getActiveSession()?.getState()?.model?.current).toEqual(selection);
            expect(manager.getRecoverySelection()).toBeNull();
            expect(starts).toHaveBeenCalledTimes(1);
            expect(startedBeforeSkills).toBe(0);
          } finally {
            firstSession.resolve();
            skills.resolve();
            starts.mockRestore();
            await manager.shutdown();
          }
        }
      );
    });
  });
});
