import { translateBackendState } from "@/agentMode/session/translateBackendState";
import type {
  BackendConfigOption,
  BackendState,
  ModelSelectionSession,
  RawModeState,
} from "@/agentMode/session/types";
import type CopilotPlugin from "@/main";
import { getSettings, setSettings, type CopilotSettings } from "@/settings/model";
import { AntigravityBackendDescriptor } from "./descriptor";
import { pinTempHome, type TempHome } from "./testing/tempHome";

jest.mock("os", () => ({ ...jest.requireActual<object>("os"), homedir: jest.fn() }));
jest.mock("@/utils/binaryPath", () => ({
  ...jest.requireActual<object>("@/utils/binaryPath"),
  WELL_KNOWN_BIN_DIRS: [],
}));
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

const MODEL_IDS = [
  "gemini-3.8-flash",
  "claude-sonnet-4-6",
  "claude-opus-4-6-thinking",
  "gpt-oss-120b-medium",
];

function sessionConfigOptions(
  currentModel: string,
  thoughtLevels: string[] | null,
  currentLevel?: string
): BackendConfigOption[] {
  const options: BackendConfigOption[] = [
    {
      id: "model",
      type: "select",
      category: "model",
      name: "Model",
      currentValue: currentModel,
      options: MODEL_IDS.map((value) => ({ value, name: value })),
    },
  ];
  if (thoughtLevels) {
    options.push({
      id: "thought_level",
      type: "select",
      category: "thought_level",
      name: "Thinking",
      currentValue: currentLevel ?? thoughtLevels[thoughtLevels.length - 1],
      options: thoughtLevels.map((value) => ({ value, name: value })),
    });
  }
  return options;
}

const ANTIGRAVITY_MODES: RawModeState = {
  currentModeId: "default",
  availableModes: ["default", "accept-edits", "auto", "plan"].map((id) => ({ id, name: id })),
};

function stateFor(
  currentModel: string,
  thoughtLevels: string[] | null,
  currentLevel?: string
): BackendState {
  return translateBackendState(
    {
      models: null,
      modes: ANTIGRAVITY_MODES,
      configOptions: sessionConfigOptions(currentModel, thoughtLevels, currentLevel),
    },
    AntigravityBackendDescriptor
  );
}

function fakeSession(initial: BackendState, afterModelSwitch?: BackendState) {
  let state = initial;
  const session = {
    getState: () => state,
    applyModelWireId: jest.fn(async () => {
      if (afterModelSwitch) state = afterModelSwitch;
    }),
    setConfigOption: jest.fn(async () => undefined),
  } satisfies ModelSelectionSession;
  return session;
}

function settingsWith(partial: Partial<CopilotSettings>): CopilotSettings {
  return { agentMode: { backends: {} }, ...partial } as unknown as CopilotSettings;
}

describe("descriptor", () => {
  describe("AntigravityBackendDescriptor", () => {
    describe("wire", () => {
      it("lists each base model once with the thinking levels its session reports", () => {
        const state = stateFor("gemini-3.8-flash", ["low", "medium", "high"]);

        expect(state.model?.availableModels.map((entry) => entry.baseModelId)).toEqual(MODEL_IDS);
        expect(state.model?.current).toEqual({ baseModelId: "gemini-3.8-flash", effort: "high" });
        expect(state.model?.availableModels[0].effortOptions.map((option) => option.value)).toEqual(
          ["low", "medium", "high"]
        );
      });

      it("sends a selection as its bare model id, since thinking travels in its own option", () => {
        expect(
          AntigravityBackendDescriptor.wire.encode({
            baseModelId: "claude-sonnet-4-6",
            effort: "high",
          })
        ).toBe("claude-sonnet-4-6");
      });
    });

    describe("applySelection()", () => {
      it("switches the model, then applies the thinking level the new model offers", async () => {
        const session = fakeSession(
          stateFor("gemini-3.8-flash", ["low", "medium", "high"]),
          stateFor("claude-opus-4-6-thinking", ["low", "medium", "high", "max"], "high")
        );

        await AntigravityBackendDescriptor.applySelection(session, {
          baseModelId: "claude-opus-4-6-thinking",
          effort: "max",
        });

        expect(session.applyModelWireId).toHaveBeenCalledWith("claude-opus-4-6-thinking");
        expect(session.setConfigOption).toHaveBeenCalledWith("thought_level", "max");
      });

      it("changes only the thinking level when the model is already selected", async () => {
        const session = fakeSession(stateFor("gemini-3.8-flash", ["low", "medium", "high"]));

        await AntigravityBackendDescriptor.applySelection(session, {
          baseModelId: "gemini-3.8-flash",
          effort: "low",
        });

        expect(session.applyModelWireId).not.toHaveBeenCalled();
        expect(session.setConfigOption).toHaveBeenCalledWith("thought_level", "low");
      });

      it("leaves thinking unset for a model that reports no thinking option", async () => {
        const session = fakeSession(
          stateFor("gemini-3.8-flash", ["low", "medium", "high"]),
          stateFor("gpt-oss-120b-medium", null)
        );

        await AntigravityBackendDescriptor.applySelection(session, {
          baseModelId: "gpt-oss-120b-medium",
          effort: "high",
        });

        expect(session.applyModelWireId).toHaveBeenCalledWith("gpt-oss-120b-medium");
        expect(session.setConfigOption).not.toHaveBeenCalled();
      });

      it("sends nothing when the session already runs the selected model and thinking level", async () => {
        const session = fakeSession(stateFor("gemini-3.8-flash", ["low", "medium", "high"]));

        await AntigravityBackendDescriptor.applySelection(session, {
          baseModelId: "gemini-3.8-flash",
          effort: "high",
        });

        expect(session.applyModelWireId).not.toHaveBeenCalled();
        expect(session.setConfigOption).not.toHaveBeenCalled();
      });

      it("keeps the agent's model when this session does not offer the selected one", async () => {
        const session = fakeSession(stateFor("gemini-3.8-flash", ["low", "medium", "high"]));

        await AntigravityBackendDescriptor.applySelection(session, {
          baseModelId: "gemini-4-argon",
          effort: "low",
        });

        expect(session.applyModelWireId).not.toHaveBeenCalled();
        expect(session.setConfigOption).not.toHaveBeenCalled();
      });
    });

    describe("applyInitialSessionConfig()", () => {
      function agentSession(state: BackendState) {
        return fakeSession(state) as unknown as Parameters<
          NonNullable<typeof AntigravityBackendDescriptor.applyInitialSessionConfig>
        >[0] &
          ReturnType<typeof fakeSession>;
      }

      const SAVED_LOW = settingsWith({
        agentMode: {
          backends: {
            antigravity: { defaultModel: { baseModelId: "gemini-3.8-flash", effort: "low" } },
          },
        },
      } as unknown as Partial<CopilotSettings>);

      it("reapplies the saved thinking level to a reopened chat, which the agent resets to high", async () => {
        const session = agentSession(stateFor("gemini-3.8-flash", ["low", "medium", "high"]));

        await AntigravityBackendDescriptor.applyInitialSessionConfig!(session, SAVED_LOW);

        expect(session.setConfigOption).toHaveBeenCalledWith("thought_level", "low");
        expect(session.applyModelWireId).not.toHaveBeenCalled();
      });

      it("leaves a chat alone when it was started from a seeded selection", async () => {
        const session = agentSession(stateFor("gemini-3.8-flash", ["low", "medium", "high"]));

        await AntigravityBackendDescriptor.applyInitialSessionConfig!(session, SAVED_LOW, {
          baseModelId: "gemini-3.8-flash",
          effort: "high",
        });

        expect(session.setConfigOption).not.toHaveBeenCalled();
      });
    });

    describe("getModeMapping()", () => {
      it("offers Default, Plan and Auto through Antigravity's matching session modes", () => {
        const mode = stateFor("gemini-3.8-flash", null).mode;

        expect(mode?.options.map((option) => option.value)).toEqual(["default", "plan", "auto"]);
        expect(mode?.current).toBe("default");
        expect(mode?.apply).toEqual({
          default: { kind: "setMode", nativeId: "default" },
          plan: { kind: "setMode", nativeId: "plan" },
          auto: { kind: "setMode", nativeId: "auto" },
        });
      });

      it("shows no current mode while the agent is in accept-edits, which Copilot has no mode for", () => {
        const state = translateBackendState(
          {
            models: null,
            modes: { ...ANTIGRAVITY_MODES, currentModeId: "accept-edits" },
            configOptions: null,
          },
          AntigravityBackendDescriptor
        );

        expect(state.mode?.current).toBeNull();
      });
    });

    describe("getEnabledModelEntries()", () => {
      it("lists the Antigravity models enabled in Copilot's model settings", () => {
        const settings = settingsWith({
          backends: { antigravity: { enabledModels: ["cm-flash"] } },
          configuredModels: [
            {
              configuredModelId: "cm-flash",
              providerId: "prov-antigravity",
              info: { id: "gemini-3.8-flash", displayName: "Gemini 3.8 Flash" },
              configuredAt: 0,
            },
          ],
        });

        expect(AntigravityBackendDescriptor.getEnabledModelEntries!(settings)).toEqual([
          expect.objectContaining({
            baseModelId: "gemini-3.8-flash",
            name: "Gemini 3.8 Flash",
            credentialState: "ok",
          }),
        ]);
      });
    });

    describe("dataDestination()", () => {
      it("names Google's cloud as where chat data goes", () => {
        expect(AntigravityBackendDescriptor.dataDestination!(settingsWith({}), null)).toEqual({
          kind: "cloud",
          label: "Google",
        });
      });
    });

    describe("install state", () => {
      let home: TempHome;

      beforeEach(() => {
        home = pinTempHome();
      });

      afterEach(() => home.restore());

      describe("getInstallState()", () => {
        it("reports ready once agy is installed and absent before", () => {
          expect(AntigravityBackendDescriptor.getInstallState(settingsWith({}))).toEqual({
            kind: "absent",
          });

          home.installAgy();

          expect(AntigravityBackendDescriptor.getInstallState(settingsWith({}))).toEqual({
            kind: "ready",
            source: "custom",
          });
        });
      });

      describe("getResolvedBinaryPath()", () => {
        it("returns the agy that a chat would launch", () => {
          const agy = home.installAgy();

          expect(AntigravityBackendDescriptor.getResolvedBinaryPath!(settingsWith({}))).toBe(agy);
        });
      });
    });

    describe("subscribeInstallState()", () => {
      it("notifies when the saved agy path changes and stops after unsubscribing", () => {
        const original = getSettings().agentMode;
        const listener = jest.fn();
        const unsubscribe = AntigravityBackendDescriptor.subscribeInstallState(
          {} as CopilotPlugin,
          listener
        );
        const savePath = (binaryPath: string) =>
          setSettings((current) => ({
            agentMode: {
              ...current.agentMode,
              backends: { ...current.agentMode.backends, antigravity: { binaryPath } },
            },
          }));
        try {
          savePath("/custom/agy");
          unsubscribe();
          savePath("/other/agy");

          expect(listener).toHaveBeenCalledTimes(1);
        } finally {
          unsubscribe();
          setSettings({ agentMode: original });
        }
      });
    });
  });
});
