import { simpleBinaryBackendProcess } from "@/agentMode/backends/shared/simpleBinaryBackend";
import type { PermissionOption } from "@/agentMode/session/types";
import { codexAuth } from "./codexAuth";
import type CopilotPlugin from "@/main";
import { getSettings, setSettings, type CopilotSettings } from "@/settings/model";
import { detectBinary } from "@/utils/detectBinary";
import { resolveCodexAcpBinary } from "./codexBinaryResolver";
import { CODEX_BUNDLE_VERSION } from "./codexArchive";
import { CodexBackendDescriptor, detectCodexAcpPath, getCodexBinaryManager } from "./descriptor";
import { isSupportedCodexAcpPath, resolveSupportedCodexAcpPackage } from "./codexVersion";

jest.mock("@/agentMode/backends/shared/simpleBinaryBackend", () => ({
  simpleBinaryBackendProcess: jest.fn(),
}));
jest.mock("@/utils/detectBinary", () => ({ detectBinary: jest.fn() }));
jest.mock("./codexBinaryResolver", () => ({
  codexAcpSearchDirs: jest.fn(),
  resolveCodexAcpBinary: jest.fn(),
}));
jest.mock("./codexVersion", () => ({
  ...jest.requireActual("./codexVersion"),
  isSupportedCodexAcpPath: jest.fn(),
  resolveSupportedCodexAcpPackage: jest.fn(),
}));

const mockedDetectBinary = jest.mocked(detectBinary);
const mockedResolveCodexAcpBinary = jest.mocked(resolveCodexAcpBinary);
const mockedIsSupportedCodexAcpPath = jest.mocked(isSupportedCodexAcpPath);
const mockedResolveSupportedPackage = jest.mocked(resolveSupportedCodexAcpPackage);

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
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 exposes the configured Codex browser sign-in capability", () => {
      expect(CodexBackendDescriptor.auth).toBe(codexAuth);
    });
    describe("getInstallState()", () => {
      it.each([
        ["legacy path", {}, "1.9.0", { kind: "ready", source: "custom" }],
        [
          "managed older bundle",
          { binarySource: "managed", binaryVersion: "1.9.0-r1" },
          "1.9.0-r1",
          { kind: "incompatible", source: "managed" },
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
          { kind: "incompatible", source: "managed" },
        ],
        [
          "managed pin",
          { binarySource: "managed", binaryVersion: CODEX_BUNDLE_VERSION },
          CODEX_BUNDLE_VERSION,
          { kind: "ready", source: "managed" },
        ],
      ])(
        "https://github.com/Brevilabs/obsidian-copilot-private/issues/379 classifies a supported %s by ownership",
        (_label, fields, actualVersion, expected) => {
          mockedResolveSupportedPackage.mockReturnValue({
            entryPath: "/codex/index.js",
            version: actualVersion,
          });

          expect(
            CodexBackendDescriptor.getInstallState(
              settingsWithCodex({ binaryPath: "/codex/index.js", ...fields })
            )
          ).toMatchObject(expected);
        }
      );
    });
    describe("createBackendProcess()", () => {
      it.each(["exit", "failed start", "failed live start"])(
        "https://github.com/Brevilabs/obsidian-copilot-private/issues/380 holds the binary reservation through %s until no child can use it",
        async (end) => {
          const original = getSettings().agentMode;
          const release = jest.fn();
          const reserve = jest
            .spyOn(getCodexBinaryManager(), "reserveBinary")
            .mockReturnValue(release);
          const start = jest.fn().mockResolvedValue(undefined);
          let exit!: () => void;
          const backend = {
            start,
            isRunning: () => end === "failed live start",
            onExit: (cb: () => void) => {
              exit = cb;
              return () => {};
            },
          };
          jest
            .mocked(simpleBinaryBackendProcess)
            .mockReturnValue(backend as unknown as ReturnType<typeof simpleBinaryBackendProcess>);
          setSettings((cur) => ({
            agentMode: {
              ...cur.agentMode,
              backends: { ...cur.agentMode.backends, codex: { binaryPath: "/owned/codex-acp" } },
            },
          }));
          try {
            const process = CodexBackendDescriptor.createBackendProcess(
              {} as Parameters<typeof CodexBackendDescriptor.createBackendProcess>[0]
            );
            start.mockImplementationOnce(async () => {
              expect(reserve).toHaveBeenCalledWith("/owned/codex-acp");
              expect(release).not.toHaveBeenCalled();
              if (end !== "exit") throw new Error("launch failed");
            });
            if (end !== "exit") await expect(process.start!()).rejects.toThrow("launch failed");
            else await process.start!();
            if (end === "failed start") expect(release).toHaveBeenCalledTimes(1);
            else expect(release).not.toHaveBeenCalled();
            exit();
            exit();
            expect(release).toHaveBeenCalledTimes(1);
          } finally {
            reserve.mockRestore();
            setSettings({ agentMode: original });
          }
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
