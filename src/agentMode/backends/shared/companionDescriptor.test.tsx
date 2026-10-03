import { createCompanionDescriptor } from "./companionDescriptor";
import { simpleBinaryBackendProcess } from "./simpleBinaryBackend";
import { configureCompanion, resolveCompanionAdapter, verifyCompanion } from "./companionRuntime";
import type CopilotPlugin from "@/main";
import type { App } from "obsidian";
import type { CopilotSettings } from "@/settings/model";
import type { CompanionDefinition } from "./companionPolicy";
import type { BackendDescriptor } from "@/agentMode/session/types";
import { DEFAULT_SETTINGS } from "@/constants";
let mockSettings: CopilotSettings;
let mockSubscription: ((previous: CopilotSettings, next: CopilotSettings) => void) | undefined;
jest.mock("@/settings/model", () => ({
  getSettings: () => mockSettings,
  useSettingsValue: () => mockSettings,
  subscribeToSettingsChange: (callback: typeof mockSubscription) => {
    mockSubscription = callback;
    return () => {};
  },
  updateAgentModeBackendFields: jest.fn(),
}));
jest.mock("./simpleBinaryBackend", () => ({ simpleBinaryBackendProcess: jest.fn() }));
jest.mock("./companionRuntime", () => ({
  companionEnvironment: () => ({ FIXTURE: "yes" }),
  configureCompanion: jest.fn(),
  verifyCompanion: jest.fn().mockResolvedValue("1.3.0"),
  resolveCompanionAdapter: jest.fn().mockResolvedValue("/plugin/companion.cjs"),
  resolveCompanionNode: jest.fn().mockResolvedValue("/runtime/node.exe"),
  signInCompanion: jest.fn(),
  installCompanion: jest.fn(),
}));
jest.mock("./agentSystemPrompt", () => ({
  buildAgentSystemPrompt: () => "Copilot vault instructions",
}));
const definition: CompanionDefinition = {
  id: "antigravity",
  displayName: "Antigravity (Gemini)",
  binaryName: "agy",
  installerBaseUrl: "https://antigravity.google/cli/install",
  loginArgs: [],
  automaticTools: true,
  skillsProjectDir: ".agents/skills",
};
const create = () => createCompanionDescriptor(definition);
const spawn = () => {
  const descriptor = create();
  descriptor.createBackendProcess({
    plugin: { manifest: { id: "copilot", dir: "custom-config/plugins/copilot" } } as CopilotPlugin,
    app: {} as App,
    clientVersion: "test",
    descriptor,
  });
  return jest.mocked(simpleBinaryBackendProcess).mock.calls.at(-1)![1];
};
describe("companionDescriptor", () => {
  beforeEach(() => {
    mockSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as CopilotSettings;
    jest.clearAllMocks();
  });
  describe("createCompanionDescriptor()", () => {
    it("keeps identity, setup notice and explicit resume failure policy in the registry descriptor", () => {
      expect(create()).toMatchObject({
        id: "antigravity",
        displayName: "Antigravity (Gemini)",
        requiresExplicitNewSessionOnResumeFailure: true,
      });
      expect(create().executionNotice).toContain("automatically approves");
    });
    describe("getInstallState()", () => {
      it("reports a missing CLI", () => {
        expect(create().getInstallState(mockSettings)).toEqual({ kind: "absent" });
      });
      it("blocks starting Antigravity until this vault has given explicit consent", () => {
        mockSettings.agentMode.backends.antigravity = {
          binaryPath: "/agy",
          binaryVersion: "1.3.0",
        };
        expect(create().getInstallState(mockSettings)).toMatchObject({
          kind: "error",
          message: expect.stringContaining("automatic tools"),
        });
      });
      it("reports a configured and consented CLI as ready", () => {
        mockSettings.agentMode.backends.antigravity = {
          binaryPath: "/agy",
          binaryVersion: "1.3.0",
          automaticToolsConsent: true,
        };
        expect(create().getInstallState(mockSettings)).toEqual({ kind: "ready", source: "custom" });
      });
    });
    describe("subscribeInstallState()", () => {
      it("does not refresh a process for a saved model preference but does notify on revoked consent", () => {
        const notify = jest.fn();
        create().subscribeInstallState({} as CopilotPlugin, notify);
        const next = JSON.parse(JSON.stringify(mockSettings)) as CopilotSettings;
        next.agentMode.backends.antigravity = {
          defaultModel: { baseModelId: "gemini", effort: null },
        };
        mockSubscription?.(mockSettings, next);
        expect(notify).not.toHaveBeenCalled();
        next.agentMode.backends.antigravity.automaticToolsConsent = true;
        mockSubscription?.(mockSettings, next);
        expect(notify).toHaveBeenCalledTimes(1);
      });
    });
    describe("applySelection()", () => {
      it("applies the model then its advertised effort configuration", async () => {
        const session = {
          applyModelWireId: jest.fn().mockResolvedValue(undefined),
          getState: () => ({
            model: {
              current: { baseModelId: "previous", effort: null },
              availableModels: [
                { baseModelId: "gemini", effortOptions: [{ value: "high", label: "high" }] },
              ],
              apply: { kind: "setConfigOption", effortConfigId: "reasoning_effort" },
            },
          }),
          setConfigOption: jest.fn().mockResolvedValue(undefined),
        } as unknown as Parameters<BackendDescriptor["applySelection"]>[0];
        await create().applySelection(session, { baseModelId: "gemini", effort: "high" });
        expect(session.applyModelWireId).toHaveBeenCalledWith("gemini");
        expect(session.setConfigOption).toHaveBeenCalledWith("reasoning_effort", "high");
      });
    });
    describe("model-specific effort selection", () => {
      it.each([null, "invalid", "high"])(
        "resolves saved effort %p against the new model",
        async (effort) => {
          const session = {
            applyModelWireId: jest.fn().mockResolvedValue(undefined),
            getState: () => ({
              model: {
                current: { baseModelId: "gemini", effort: "high" },
                availableModels: [
                  {
                    baseModelId: "gemini",
                    effortOptions: [
                      { value: "low", label: "low" },
                      { value: "high", label: "high" },
                    ],
                  },
                ],
                apply: {
                  kind: "setConfigOption",
                  configId: "model",
                  effortConfigId: "reasoning_effort",
                },
              },
            }),
            setConfigOption: jest.fn().mockResolvedValue(undefined),
          } as unknown as Parameters<BackendDescriptor["applySelection"]>[0];
          await create().applySelection(session, { baseModelId: "gemini", effort });
          expect(session.applyModelWireId).not.toHaveBeenCalled();
          expect(session.setConfigOption).toHaveBeenCalledWith(
            "reasoning_effort",
            effort === "high" ? "high" : "low"
          );
        }
      );
      it("does not send effort for a model without offered levels", async () => {
        const session = {
          applyModelWireId: jest.fn().mockResolvedValue(undefined),
          getState: () => ({
            model: {
              current: { baseModelId: "plain", effort: null },
              availableModels: [{ baseModelId: "plain", effortOptions: [] }],
              apply: { kind: "setConfigOption", configId: "model" },
            },
          }),
          setConfigOption: jest.fn(),
        } as unknown as Parameters<BackendDescriptor["applySelection"]>[0];
        await create().applySelection(session, { baseModelId: "plain", effort: "high" });
        expect(session.setConfigOption).not.toHaveBeenCalled();
      });
    });
    describe("onPluginLoad()", () => {
      it("detects an installation without running a vendor installer", async () => {
        await create().onPluginLoad?.({} as CopilotPlugin);
        expect(configureCompanion).toHaveBeenCalledWith(definition);
      });
      it("preserves a configured manual path", async () => {
        mockSettings.agentMode.backends.antigravity = { binaryPath: "/custom/agy" };
        await create().onPluginLoad?.({} as CopilotPlugin);
        expect(configureCompanion).not.toHaveBeenCalled();
      });
    });
  });
  describe("CompanionBackend", () => {
    describe("buildSpawnDescriptor()", () => {
      it("rejects missing consent before launching any agent", async () => {
        await expect(spawn().buildSpawnDescriptor({ vaultBasePath: "/vault" })).rejects.toThrow(
          "Enable Antigravity"
        );
        expect(verifyCompanion).not.toHaveBeenCalled();
      });
      it("launches the packaged adapter with Copilot instructions and local CLI configuration", async () => {
        mockSettings.agentMode.backends.antigravity = {
          binaryPath: "/agy",
          automaticToolsConsent: true,
        };
        const result = await spawn().buildSpawnDescriptor({ vaultBasePath: "/vault" });
        expect(resolveCompanionAdapter).toHaveBeenCalledWith(
          "/vault",
          "custom-config/plugins/copilot",
          "antigravity"
        );
        expect(result).toMatchObject({
          command: "/runtime/node.exe",
          args: ["/plugin/companion.cjs"],
          cwd: "/vault",
          env: {
            ELECTRON_RUN_AS_NODE: "1",
            COMPANION_CLI_PATH: "/agy",
            COMPANION_SYSTEM_PROMPT: "Copilot vault instructions",
          },
        });
      });
    });
  });
});
