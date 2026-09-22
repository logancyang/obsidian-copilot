import { codexAuth } from "./codexAuth";
import type CopilotPlugin from "@/main";
import { getSettings, setSettings, type CopilotSettings } from "@/settings/model";
import { detectBinary } from "@/utils/detectBinary";
import { resolveCodexAcpBinary } from "./codexBinaryResolver";
import { CODEX_PINNED_VERSION } from "./codexArchive";
import { CodexBackendDescriptor, detectCodexAcpPath, getCodexBinaryManager } from "./descriptor";
import { isSupportedCodexAcpPath, inspectCodexAcpPackage, CODEX_MIN_VERSION } from "./codexVersion";

jest.mock("@/utils/detectBinary", () => ({ detectBinary: jest.fn() }));
jest.mock("./codexBinaryResolver", () => ({
  codexAcpSearchDirs: jest.fn(),
  resolveCodexAcpBinary: jest.fn(),
}));
jest.mock("./codexVersion", () => ({
  ...jest.requireActual("./codexVersion"),
  isSupportedCodexAcpPath: jest.fn(),
  inspectCodexAcpPackage: jest.fn(),
}));

const mockedDetectBinary = jest.mocked(detectBinary);
const mockedResolveCodexAcpBinary = jest.mocked(resolveCodexAcpBinary);
const mockedIsSupportedCodexAcpPath = jest.mocked(isSupportedCodexAcpPath);
import { translateBackendState } from "@/agentMode/session/translateBackendState";
import type {
  BackendConfigOption,
  PermissionOption,
  RawModelState,
} from "@/agentMode/session/types";

/**
 * Transcribed from a live `codex-acp@1.1.10` `session/new` reply: one entry per
 * (base model × effort) pair, addressed as `<base>[<effort>]`, with a different
 * effort set per model and a blurb describing that one effort.
 */
const ADVERTISED_CATALOG: RawModelState = {
  currentModelId: "gpt-5.6-sol[high]",
  availableModels: [
    ...["low", "medium", "high", "xhigh", "max", "ultra"].map((effort) => ({
      modelId: `gpt-5.6-sol[${effort}]`,
      name: `GPT-5.6-Sol (${effort})`,
      description: `Latest frontier agentic coding model. Reasoning depth: ${effort}`,
    })),
    ...["low", "medium", "high", "xhigh"].map((effort) => ({
      modelId: `gpt-5.5[${effort}]`,
      name: `GPT-5.5 (${effort})`,
      description: `Frontier model for complex coding. Reasoning depth: ${effort}`,
    })),
  ],
};

/** The `category:"model"` option the same reply carries, listing base models only. */
const ADVERTISED_CONFIG_OPTIONS: BackendConfigOption[] = [
  {
    id: "model",
    type: "select",
    category: "model",
    name: "Model",
    currentValue: "gpt-5.6-sol",
    options: [
      {
        value: "gpt-5.6-sol",
        name: "GPT-5.6-Sol",
        description: "Latest frontier agentic coding model.",
      },
      { value: "gpt-5.5", name: "GPT-5.5", description: "Frontier model for complex coding." },
    ],
  },
];
const mockedResolveSupportedPackage = jest.mocked(inspectCodexAcpPackage);

function settingsWithCodex(codex: Record<string, unknown>): CopilotSettings {
  return {
    agentMode: { backends: { codex } },
  } as unknown as CopilotSettings;
}

describe("descriptor", () => {
  describe("detectCodexAcpPath()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/2916 returns a supported adapter from the known locations", async () => {
      mockedResolveCodexAcpBinary.mockReturnValue("/known/codex-acp");

      await expect(detectCodexAcpPath()).resolves.toBe("/known/codex-acp");
      expect(mockedResolveCodexAcpBinary.mock.calls[0]?.[1]).toBe(mockedIsSupportedCodexAcpPath);
      expect(mockedDetectBinary).not.toHaveBeenCalled();
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/2916 accepts a supported adapter from a custom directory on PATH", async () => {
      const customPath = "/custom/npm/bin/codex-acp";
      mockedResolveCodexAcpBinary.mockReturnValue(null);
      mockedDetectBinary.mockResolvedValue(customPath);
      mockedIsSupportedCodexAcpPath.mockImplementation((candidate) => candidate === customPath);

      await expect(detectCodexAcpPath()).resolves.toBe(customPath);
      expect(mockedIsSupportedCodexAcpPath).toHaveBeenCalledWith(customPath);
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/2916 rejects an unsupported adapter found on PATH", async () => {
      mockedResolveCodexAcpBinary.mockReturnValue(null);
      mockedDetectBinary.mockResolvedValue("/custom/npm/bin/codex-acp");
      mockedIsSupportedCodexAcpPath.mockReturnValue(false);

      await expect(detectCodexAcpPath()).resolves.toBeNull();
    });
  });

  describe("CodexBackendDescriptor", () => {
    describe("wire", () => {
      it.each([
        ["gpt-5.6-sol[low]", "gpt-5.6-sol", "low"],
        ["gpt-5.6-sol[max]", "gpt-5.6-sol", "max"],
        ["gpt-5.6-sol[ultra]", "gpt-5.6-sol", "ultra"],
        ["gpt-5.3-codex-spark[xhigh]", "gpt-5.3-codex-spark", "xhigh"],
      ])(
        "https://github.com/Brevilabs/obsidian-copilot-private/issues/219 decodes %s into its base model and effort",
        (wireId, baseModelId, effort) => {
          expect(CodexBackendDescriptor.wire.decode(wireId)).toEqual({
            selection: { baseModelId, effort },
            provider: null,
          });
        }
      );

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/219 decodes an effort level the plugin has never seen, so a new CLI release needs no change", () => {
        expect(CodexBackendDescriptor.wire.decode("gpt-6[hyper]").selection).toEqual({
          baseModelId: "gpt-6",
          effort: "hyper",
        });
      });

      it.each(["gpt-5.6-sol", ""])(
        "https://github.com/Brevilabs/obsidian-copilot-private/issues/219 reports %p as an effortless base model",
        (wireId) => {
          expect(CodexBackendDescriptor.wire.decode(wireId)).toEqual({
            selection: { baseModelId: wireId, effort: null },
            provider: null,
          });
        }
      );

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/219 encodes a selection back into the bracketed form codex accepts", () => {
        expect(
          CodexBackendDescriptor.wire.encode({ baseModelId: "gpt-5.6-sol", effort: "ultra" })
        ).toBe("gpt-5.6-sol[ultra]");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/219 collapses the advertised cross-product into one entry per base model", () => {
        const state = translateBackendState(
          { models: ADVERTISED_CATALOG, modes: null, configOptions: null },
          CodexBackendDescriptor
        );

        expect(state.model?.availableModels).toEqual([
          expect.objectContaining({ baseModelId: "gpt-5.6-sol", name: "GPT-5.6-Sol" }),
          expect.objectContaining({ baseModelId: "gpt-5.5", name: "GPT-5.5" }),
        ]);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/219 offers each base model only the effort levels the CLI advertises for it", () => {
        const state = translateBackendState(
          { models: ADVERTISED_CATALOG, modes: null, configOptions: null },
          CodexBackendDescriptor
        );
        const efforts = (baseModelId: string) =>
          state.model?.availableModels
            .find((e) => e.baseModelId === baseModelId)
            ?.effortOptions.map((o) => o.value);

        expect(efforts("gpt-5.6-sol")).toEqual(["low", "medium", "high", "xhigh", "max", "ultra"]);
        // The same catalog gives gpt-5.5 no `max`/`ultra` — availability is
        // per-model, never a vocabulary Copilot applies uniformly.
        expect(efforts("gpt-5.5")).toEqual(["low", "medium", "high", "xhigh"]);
      });

      it("describes a collapsed row with the base model's blurb, not the first variant's (https://github.com/Brevilabs/obsidian-copilot-private/issues/219)", () => {
        const state = translateBackendState(
          { models: ADVERTISED_CATALOG, modes: null, configOptions: ADVERTISED_CONFIG_OPTIONS },
          CodexBackendDescriptor
        );

        // The base description must not imply low effort for every variant.
        expect(
          state.model?.availableModels.find((e) => e.baseModelId === "gpt-5.6-sol")?.description
        ).toBe("Latest frontier agentic coding model.");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/219 reports the agent's active model and effort as the current selection", () => {
        const state = translateBackendState(
          { models: ADVERTISED_CATALOG, modes: null, configOptions: null },
          CodexBackendDescriptor
        );

        expect(state.model?.current).toEqual({ baseModelId: "gpt-5.6-sol", effort: "high" });
      });
    });

    describe("prefetchEffortCatalog()", () => {
      it("discovers inactive model effort and restores the probe model https://github.com/Brevilabs/obsidian-copilot-private/issues/550", async () => {
        const effortOptions = [{ value: "high", label: "high" }];
        const setSessionConfigOption = jest.fn(async () => ({
          model: { availableModels: [{ baseModelId: "other", effortOptions }] },
          mode: null,
        }));
        const result = await CodexBackendDescriptor.prefetchEffortCatalog!({
          proc: {
            setSessionConfigOption,
          } as unknown as import("@/agentMode/session/types").BackendProcess,
          sessionId: "probe",
          modelState: {
            current: { baseModelId: "original", effort: "high" },
            availableModels: [],
            apply: { kind: "setConfigOption", configId: "model" },
          },
          enabledModels: [{ baseModelId: "other", name: "Other", credentialState: "ok" }],
          isAborted: () => false,
        });
        expect(result).toEqual({ other: effortOptions });
        expect(setSessionConfigOption.mock.calls).toEqual([
          [{ sessionId: "probe", configId: "model", value: "other" }],
          [{ sessionId: "probe", configId: "model", value: "original" }],
        ]);
      });
    });

    describe("applySelection()", () => {
      function stateFor(modelId: string, efforts: string[]) {
        return translateBackendState(
          {
            models: null,
            modes: null,
            configOptions: [
              ...ADVERTISED_CONFIG_OPTIONS.map((option) =>
                option.type === "select" ? { ...option, currentValue: modelId } : option
              ),
              {
                id: "reasoning_effort",
                category: "thought_level",
                type: "select",
                name: "Effort",
                currentValue: efforts[0],
                options: efforts.map((value) => ({ value, name: value })),
              },
            ],
          },
          CodexBackendDescriptor
        );
      }

      it("switches the bare model before applying effort from its refreshed catalog https://github.com/Brevilabs/obsidian-copilot-private/issues/550", async () => {
        let state = stateFor("gpt-5.6-sol", ["low", "ultra"]);
        const applyModelWireId = jest.fn(async () => {
          state = stateFor("gpt-5.5", ["medium", "high"]);
        });
        const setConfigOption = jest.fn();
        await CodexBackendDescriptor.applySelection(
          { getState: () => state, applyModelWireId, setConfigOption },
          { baseModelId: "gpt-5.5", effort: "ultra" }
        );
        expect(applyModelWireId).toHaveBeenCalledWith("gpt-5.5");
        expect(setConfigOption).toHaveBeenCalledWith("reasoning_effort", "medium");
      });

      it.each([null, "removed", "high"])(
        "resolves saved effort %p from the current model without switching models https://github.com/Brevilabs/obsidian-copilot-private/issues/550",
        async (effort) => {
          const state = stateFor("gpt-5.6-sol", ["low", "high"]);
          const applyModelWireId = jest.fn();
          const setConfigOption = jest.fn();
          await CodexBackendDescriptor.applySelection(
            { getState: () => state, applyModelWireId, setConfigOption },
            { baseModelId: "gpt-5.6-sol", effort }
          );
          expect(applyModelWireId).not.toHaveBeenCalled();
          expect(setConfigOption).toHaveBeenCalledWith(
            "reasoning_effort",
            effort === "high" ? "high" : "low"
          );
        }
      );

      it("uses the backend-reported model instead of an optimistic startup seed https://github.com/Brevilabs/obsidian-copilot-private/issues/550", async () => {
        const state = stateFor("gpt-5.6-sol", ["low", "high"]);
        const applyModelWireId = jest.fn();
        const setConfigOption = jest.fn();
        await CodexBackendDescriptor.applySelection(
          { getState: () => state, applyModelWireId, setConfigOption },
          state.model!.current,
          { backendReportedCurrent: { baseModelId: "gpt-5.5", effort: "high" } }
        );
        expect(applyModelWireId).toHaveBeenCalledWith("gpt-5.6-sol");
        expect(setConfigOption).toHaveBeenCalledWith("reasoning_effort", "low");
      });

      it("leaves effort unset when the selected model advertises no effort option https://github.com/Brevilabs/obsidian-copilot-private/issues/550", async () => {
        const state = translateBackendState(
          { models: null, modes: null, configOptions: ADVERTISED_CONFIG_OPTIONS },
          CodexBackendDescriptor
        );
        const applyModelWireId = jest.fn();
        const setConfigOption = jest.fn();
        await CodexBackendDescriptor.applySelection(
          { getState: () => state, applyModelWireId, setConfigOption },
          { baseModelId: "gpt-5.6-sol", effort: "high" }
        );
        expect(setConfigOption).not.toHaveBeenCalled();
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 exposes the configured Codex browser sign-in capability", () => {
      expect(CodexBackendDescriptor.auth).toBe(codexAuth);
    });
    describe("getInstallState()", () => {
      it.each(["managed", "custom"] as const)(
        "https://github.com/Brevilabs/obsidian-copilot-private/issues/535 reports below-minimum %s runtime as incompatible",
        (source) => {
          mockedResolveSupportedPackage.mockReturnValue({
            entryPath: "/codex/index.js",
            version: "0.0.44",
            runtimeVersion: "0.0.44",
          });
          expect(
            CodexBackendDescriptor.getInstallState(
              settingsWithCodex({
                binaryPath: "/codex/index.js",
                binarySource: source,
                binaryVersion: CODEX_PINNED_VERSION,
              })
            )
          ).toMatchObject({
            kind: "incompatible",
            source,
            currentVersion: "0.0.44",
            minVersion: CODEX_MIN_VERSION,
          });
        }
      );
      it.each([
        ["ENOENT", "absent"],
        ["EINVAL", "error"],
      ])(
        "https://github.com/Brevilabs/obsidian-copilot-private/issues/535 classifies %s inspection failure as %s",
        (code, kind) => {
          mockedResolveSupportedPackage.mockImplementation(() => {
            throw Object.assign(new Error("Invalid package"), { code });
          });
          expect(
            CodexBackendDescriptor.getInstallState(
              settingsWithCodex({ binaryPath: "/codex/index.js" })
            ).kind
          ).toBe(kind);
        }
      );
      it.each([
        ["legacy path", {}, "1.9.0", { kind: "ready", source: "custom" }],
        [
          "managed older bundle",
          { binarySource: "managed", binaryVersion: "1.9.0-r1" },
          "1.9.0-r1",
          { kind: "ready", source: "managed" },
        ],
        [
          "custom mismatch",
          { binarySource: "custom", binaryVersion: "1.9.0" },
          "1.9.0",
          { kind: "ready", source: "custom" },
        ],
        [
          "managed packaging mismatch",
          { binarySource: "managed", binaryVersion: "1.10.0-r2" },
          "1.10.0-r2",
          { kind: "ready", source: "managed" },
        ],
        [
          "managed pin",
          { binarySource: "managed", binaryVersion: CODEX_PINNED_VERSION },
          CODEX_PINNED_VERSION,
          { kind: "ready", source: "managed" },
        ],
      ])(
        "https://github.com/Brevilabs/obsidian-copilot-private/issues/530 keeps a supported %s runnable by ownership",
        (_label, fields, actualVersion, expected) => {
          mockedResolveSupportedPackage.mockReturnValue({
            entryPath: "/codex/index.js",
            version: actualVersion,
            runtimeVersion: actualVersion.replace(/-r\d+$/, ""),
          });

          expect(
            CodexBackendDescriptor.getInstallState(
              settingsWithCodex({ binaryPath: "/codex/index.js", ...fields })
            )
          ).toMatchObject(expected);
        }
      );
    });

    describe("subscribeInstallState()", () => {
      it.each(["binaryPath", "binaryVersion", "binarySource"] as const)(
        "publishes install-state changes when %s changes",
        (field) => {
          const original = getSettings().agentMode;
          const listener = jest.fn();
          const unsubscribe = CodexBackendDescriptor.subscribeInstallState(
            {} as CopilotPlugin,
            listener
          );
          try {
            setSettings((current) => ({
              agentMode: {
                ...current.agentMode,
                backends: {
                  ...current.agentMode.backends,
                  codex: { ...current.agentMode.backends?.codex, [field]: "changed" },
                },
              },
            }));
            expect(listener).toHaveBeenCalledTimes(1);
          } finally {
            unsubscribe();
            setSettings({ agentMode: original });
          }
        }
      );
    });

    describe("managedInstall.run()", () => {
      it("routes the backend-neutral managed action to the Codex manager", async () => {
        const manager = getCodexBinaryManager();
        const install = jest
          .spyOn(manager, "install")
          .mockResolvedValue({ version: "1.10.0", path: "/managed/codex-acp" });
        const listener = jest.fn();
        const subscribe = jest.spyOn(manager, "subscribeRuntimeState");
        try {
          expect(CodexBackendDescriptor.managedInstall?.getState({} as CopilotPlugin)).toEqual({
            kind: "idle",
          });
          const unsubscribe = CodexBackendDescriptor.managedInstall?.subscribe(
            {} as CopilotPlugin,
            listener
          );
          await CodexBackendDescriptor.managedInstall?.run({} as CopilotPlugin);
          expect(subscribe).toHaveBeenCalledWith(listener);
          expect(install).toHaveBeenCalledTimes(1);
          unsubscribe?.();
        } finally {
          install.mockRestore();
          subscribe.mockRestore();
        }
      });
    });

    describe("onPluginLoad()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/530 checks the shipped pin before completing plugin load", async () => {
        const automatic = jest.spyOn(getCodexBinaryManager(), "autoUpgrade").mockResolvedValue();
        try {
          await CodexBackendDescriptor.onPluginLoad?.({} as CopilotPlugin);
          expect(automatic).toHaveBeenCalledWith(
            CODEX_PINNED_VERSION,
            CODEX_MIN_VERSION,
            expect.any(Function)
          );
        } finally {
          automatic.mockRestore();
        }
      });
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/368 clears the singleton failure for each plugin lifecycle", async () => {
        const reset = jest.spyOn(getCodexBinaryManager(), "forgetSettledError");
        await CodexBackendDescriptor.onPluginLoad?.({} as CopilotPlugin);
        expect(reset).toHaveBeenCalledTimes(1);
        reset.mockRestore();
      });
    });

    describe("presentPermissionOption()", () => {
      it.each([
        ["opaque-exec-decision", "acceptWithExecpolicyAmendment"],
        ["opaque-network-decision", "applyNetworkPolicyAmendment"],
      ])("separates the Codex policy rule using %s metadata", (optionId, decision) => {
        const rule = "Allow commands starting with mkdir";
        const option: PermissionOption = {
          optionId,
          name: rule,
          kind: "allow_always",
        };

        expect(
          CodexBackendDescriptor.presentPermissionOption?.(option, { codex: { decision } })
        ).toEqual({
          optionId,
          name: "Allow Always",
          description: rule,
          kind: "allow_always",
        });
      });

      it("uses block language for a persistent network rejection", () => {
        const option: PermissionOption = {
          optionId: "opaque-network-rejection",
          name: "Block api.example.com in the Future",
          kind: "reject_always",
        };

        expect(
          CodexBackendDescriptor.presentPermissionOption?.(option, {
            codex: { decision: "applyNetworkPolicyAmendment" },
          })
        ).toEqual({
          optionId: "opaque-network-rejection",
          name: "Block Always",
          description: "Block api.example.com in the Future",
          kind: "reject_always",
        });
      });

      it("leaves a session decision unchanged even when its opaque id resembles a policy amendment", () => {
        const option: PermissionOption = {
          optionId: "accept_execpolicy_amendment",
          name: "Allow Host for Session",
          kind: "allow_always",
        };

        expect(
          CodexBackendDescriptor.presentPermissionOption?.(option, {
            codex: { decision: "acceptForSession" },
          })
        ).toBe(option);
      });

      it.each([
        undefined,
        null,
        { codex: null },
        { codex: { decision: "unknown" } },
        { codex: { decision: "acceptWithExecpolicyAmendment" } },
      ])("leaves malformed or contradictory metadata unchanged", (metadata) => {
        const option: PermissionOption = {
          optionId: "opaque-decision",
          name: "Backend-provided label",
          kind: "reject_always",
        };

        expect(CodexBackendDescriptor.presentPermissionOption?.(option, metadata)).toBe(option);
      });
    });
  });
});
