import { detectBinary } from "@/utils/detectBinary";
import { resolveCodexAcpBinary } from "./codexBinaryResolver";
import { CodexBackendDescriptor, detectCodexAcpPath } from "./descriptor";
import { isSupportedCodexAcpPath } from "./codexVersion";

jest.mock("@/utils/detectBinary", () => ({ detectBinary: jest.fn() }));
jest.mock("./codexBinaryResolver", () => ({
  codexAcpSearchDirs: jest.fn(),
  resolveCodexAcpBinary: jest.fn(),
}));
jest.mock("./codexVersion", () => ({
  ...jest.requireActual("./codexVersion"),
  isSupportedCodexAcpPath: jest.fn(),
}));

const mockedDetectBinary = jest.mocked(detectBinary);
const mockedResolveCodexAcpBinary = jest.mocked(resolveCodexAcpBinary);
const mockedIsSupportedCodexAcpPath = jest.mocked(isSupportedCodexAcpPath);
import type { AgentSession } from "@/agentMode/session/AgentSession";
import { translateBackendState } from "@/agentMode/session/translateBackendState";
import type {
  BackendState,
  EffortOption,
  PermissionOption,
  RawModelState,
} from "@/agentMode/session/types";

/**
 * A session stub exposing only what `applySelection` reads (`getState`) and
 * calls (`applyModelWireId`), so the effort-snapping contract is asserted
 * against the wire id that actually reaches the agent.
 */
function sessionWith(effortOptions: EffortOption[] | null): {
  session: AgentSession;
  applyModelWireId: jest.Mock;
} {
  const applyModelWireId = jest.fn(async () => undefined);
  const state: BackendState | null =
    effortOptions === null
      ? null
      : {
          model: {
            current: { baseModelId: "gpt-5.6-sol", effort: "high" },
            availableModels: [
              { baseModelId: "gpt-5.6-sol", name: "GPT-5.6-Sol", provider: null, effortOptions },
            ],
            apply: { kind: "setModel" },
          },
          mode: null,
        };
  return {
    session: { applyModelWireId, getState: () => state } as unknown as AgentSession,
    applyModelWireId,
  };
}

const SOL_EFFORTS: EffortOption[] = ["low", "medium", "high", "xhigh", "max", "ultra"].map((v) => ({
  value: v,
  label: v,
}));

/**
 * Transcribed from a live `codex-acp@1.1.10` `session/new` reply: one entry per
 * (base model × effort) pair, addressed as `<base>[<effort>]`, with a different
 * effort set per model.
 */
const ADVERTISED_CATALOG: RawModelState = {
  currentModelId: "gpt-5.6-sol[high]",
  availableModels: [
    ...["low", "medium", "high", "xhigh", "max", "ultra"].map((effort) => ({
      modelId: `gpt-5.6-sol[${effort}]`,
      name: `GPT-5.6-Sol (${effort})`,
      description: "Latest frontier agentic coding model.",
    })),
    ...["low", "medium", "high", "xhigh"].map((effort) => ({
      modelId: `gpt-5.5[${effort}]`,
      name: `GPT-5.5 (${effort})`,
      description: "Frontier model for complex coding, research, and real-world work.",
    })),
  ],
};

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
      ])("decodes %s into its base model and effort", (wireId, baseModelId, effort) => {
        expect(CodexBackendDescriptor.wire.decode(wireId)).toEqual({
          selection: { baseModelId, effort },
          provider: null,
        });
      });

      it("decodes an effort level the plugin has never seen, so a new CLI release needs no change", () => {
        expect(CodexBackendDescriptor.wire.decode("gpt-6[hyper]").selection).toEqual({
          baseModelId: "gpt-6",
          effort: "hyper",
        });
      });

      it.each(["gpt-5.6-sol", ""])("reports %p as an effortless base model", (wireId) => {
        expect(CodexBackendDescriptor.wire.decode(wireId)).toEqual({
          selection: { baseModelId: wireId, effort: null },
          provider: null,
        });
      });

      it("encodes a selection back into the bracketed form codex accepts", () => {
        expect(
          CodexBackendDescriptor.wire.encode({ baseModelId: "gpt-5.6-sol", effort: "ultra" })
        ).toBe("gpt-5.6-sol[ultra]");
      });

      it("collapses the advertised cross-product into one entry per base model", () => {
        const state = translateBackendState(
          { models: ADVERTISED_CATALOG, modes: null, configOptions: null },
          CodexBackendDescriptor
        );

        expect(state.model?.availableModels).toEqual([
          expect.objectContaining({ baseModelId: "gpt-5.6-sol", name: "GPT-5.6-Sol" }),
          expect.objectContaining({ baseModelId: "gpt-5.5", name: "GPT-5.5" }),
        ]);
      });

      it("offers each base model only the effort levels the CLI advertises for it", () => {
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

      it("reports the agent's active model and effort as the current selection", () => {
        const state = translateBackendState(
          { models: ADVERTISED_CATALOG, modes: null, configOptions: null },
          CodexBackendDescriptor
        );

        expect(state.model?.current).toEqual({ baseModelId: "gpt-5.6-sol", effort: "high" });
      });
    });

    describe("applySelection()", () => {
      it("sends the bracketed wire id for the chosen effort", async () => {
        const { session, applyModelWireId } = sessionWith(SOL_EFFORTS);

        await CodexBackendDescriptor.applySelection(session, {
          baseModelId: "gpt-5.6-sol",
          effort: "max",
        });

        expect(applyModelWireId).toHaveBeenCalledWith("gpt-5.6-sol[max]");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/219 lets the adapter choose effort through its advertised model option", async () => {
        const state = translateBackendState(
          {
            models: ADVERTISED_CATALOG,
            modes: null,
            configOptions: [
              {
                id: "model-choice",
                type: "select",
                category: "model",
                name: "Model",
                currentValue: "gpt-5.6-sol",
                options: [{ value: "gpt-5.6-sol", name: "Sol" }],
              },
            ],
          },
          CodexBackendDescriptor
        );
        const applyModelWireId = jest.fn();
        const setConfigOption = jest.fn();
        const session = {
          getState: () => state,
          applyModelWireId,
          setConfigOption,
        } as unknown as AgentSession;

        await CodexBackendDescriptor.applySelection(session, {
          baseModelId: "gpt-5.6-sol",
          effort: null,
        });

        expect(setConfigOption).toHaveBeenCalledWith("model-choice", "gpt-5.6-sol");
        expect(applyModelWireId).not.toHaveBeenCalled();
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/219 preserves the reported effort when an older adapter already has the requested model", async () => {
        const { session, applyModelWireId } = sessionWith(SOL_EFFORTS);
        await CodexBackendDescriptor.applySelection(session, {
          baseModelId: "gpt-5.6-sol",
          effort: null,
        });
        expect(applyModelWireId).not.toHaveBeenCalled();
        expect(session.getState()?.model?.current.effort).toBe("high");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/219 rejects a model-only switch on an older adapter without choosing an arbitrary effort", async () => {
        const { session, applyModelWireId } = sessionWith(SOL_EFFORTS);
        await expect(
          CodexBackendDescriptor.applySelection(session, { baseModelId: "gpt-5.5", effort: null })
        ).rejects.toThrow("Choose an explicit effort");
        expect(applyModelWireId).not.toHaveBeenCalled();
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/219 checks the backend report rather than an optimistic startup seed", async () => {
        const { session, applyModelWireId } = sessionWith(SOL_EFFORTS);
        await expect(
          CodexBackendDescriptor.applySelection(
            session,
            { baseModelId: "gpt-5.6-sol", effort: null },
            {
              backendReportedCurrent: { baseModelId: "gpt-5.5", effort: "high" },
            }
          )
        ).rejects.toThrow("Choose an explicit effort");
        expect(applyModelWireId).not.toHaveBeenCalled();
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/219 never sends a bare model ID while the catalog is unavailable", async () => {
        const { session, applyModelWireId } = sessionWith(null);
        await expect(
          CodexBackendDescriptor.applySelection(session, {
            baseModelId: "gpt-5.6-sol",
            effort: null,
          })
        ).rejects.toThrow("Choose an explicit effort");
        expect(applyModelWireId).not.toHaveBeenCalled();
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/219 retains and applies the only advertised effort", async () => {
        const state = translateBackendState(
          {
            models: {
              currentModelId: "example[high]",
              availableModels: [{ modelId: "example[high]", name: "Example (high)" }],
            },
            modes: null,
            configOptions: null,
          },
          CodexBackendDescriptor
        );
        expect(state.model?.availableModels[0].effortOptions).toEqual([
          { value: "high", label: "high" },
        ]);
        expect(state.model?.current).toEqual({ baseModelId: "example", effort: "high" });
        const applyModelWireId = jest.fn();
        await CodexBackendDescriptor.applySelection(
          { getState: () => state, applyModelWireId } as unknown as AgentSession,
          state.model!.current
        );
        expect(applyModelWireId).toHaveBeenCalledWith("example[high]");
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
