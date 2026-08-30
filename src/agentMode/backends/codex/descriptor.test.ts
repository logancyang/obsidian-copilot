import type { PermissionOption } from "@/agentMode/session/types";
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
