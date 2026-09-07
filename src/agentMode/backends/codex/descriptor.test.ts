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
import type { PermissionOption, RawModelState } from "@/agentMode/session/types";

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

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/219 reports the agent's active model and effort as the current selection", () => {
        const state = translateBackendState(
          { models: ADVERTISED_CATALOG, modes: null, configOptions: null },
          CodexBackendDescriptor
        );

        expect(state.model?.current).toEqual({ baseModelId: "gpt-5.6-sol", effort: "high" });
      });
    });

    describe("applySelection()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/219 sends the bracketed wire id for the chosen effort", async () => {
        const applyModelWireId = jest.fn();
        const session = { applyModelWireId, getState: () => null } as unknown as AgentSession;

        await CodexBackendDescriptor.applySelection(session, {
          baseModelId: "gpt-5.6-sol",
          effort: "max",
        });

        expect(applyModelWireId).toHaveBeenCalledWith("gpt-5.6-sol[max]");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/219 preserves the missing-catalog error when no effort can be resolved", async () => {
        const applyModelWireId = jest.fn();
        const session = { applyModelWireId, getState: () => null } as unknown as AgentSession;
        await expect(
          CodexBackendDescriptor.applySelection(session, {
            baseModelId: "gpt-5.6-sol",
            effort: null,
          })
        ).rejects.toThrow("Choose an explicit effort");
        expect(applyModelWireId).not.toHaveBeenCalled();
      });

      it.each([null, "removed", "high"])(
        "https://github.com/Brevilabs/obsidian-copilot-private/issues/219 resolves saved effort %p against the live model catalog",
        async (effort) => {
          const state = translateBackendState(
            { models: ADVERTISED_CATALOG, modes: null, configOptions: null },
            CodexBackendDescriptor
          );
          const applyModelWireId = jest.fn();
          const session = { applyModelWireId, getState: () => state } as unknown as AgentSession;
          await CodexBackendDescriptor.applySelection(session, {
            baseModelId: "gpt-5.6-sol",
            effort,
          });
          expect(applyModelWireId).toHaveBeenCalledWith(
            `gpt-5.6-sol[${effort === "high" ? "high" : "low"}]`
          );
        }
      );

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
