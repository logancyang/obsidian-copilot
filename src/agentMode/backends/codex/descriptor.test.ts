import * as fs from "node:fs";

import type { InstallState, PermissionOption } from "@/agentMode/session/types";
import type { CopilotSettings } from "@/settings/model";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import {
  getCodexCompatibility,
  refreshCodexCompatibility,
  subscribeCodexCompatibility,
} from "./codexCompatibility";
import {
  CodexBackendDescriptor,
  detectCodexAcpPath,
  getCodexInstallState,
  refreshCodexInstallState,
  subscribeCodexInstallState,
} from "./descriptor";

jest.mock("node:fs", () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  readdirSync: jest.fn(),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(),
  subscribeToSettingsChange: jest.fn(),
  updateAgentModeBackendFields: jest.fn(),
}));

jest.mock("./CodexInstallModal", () => ({
  CodexInstallModal: jest.fn(),
}));

jest.mock("./codexCompatibility", () => ({
  CODEX_INSTALL_COMMAND: "npm install -g @agentclientprotocol/codex-acp",
  getCodexCompatibility: jest.fn(),
  refreshCodexCompatibility: jest.fn(),
  subscribeCodexCompatibility: jest.fn(),
}));

const mockGetSettings = getSettings as jest.MockedFunction<typeof getSettings>;
const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockSubscribeToSettingsChange = subscribeToSettingsChange as jest.MockedFunction<
  typeof subscribeToSettingsChange
>;
const mockGetCompatibility = getCodexCompatibility as jest.MockedFunction<
  typeof getCodexCompatibility
>;
const mockRefreshCompatibility = refreshCodexCompatibility as jest.MockedFunction<
  typeof refreshCodexCompatibility
>;
const mockSubscribeCompatibility = subscribeCodexCompatibility as jest.MockedFunction<
  typeof subscribeCodexCompatibility
>;

function settingsWithCodexPath(
  binaryPath?: string,
  envOverrides?: Record<string, string>
): CopilotSettings {
  return {
    agentMode: {
      backends: {
        codex: { binaryPath, envOverrides },
      },
    },
  } as unknown as CopilotSettings;
}

describe("descriptor", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  describe("detectCodexAcpPath()", () => {
    it("uses a case-insensitive Codex PATH override to find a Windows npm shim", async () => {
      const originalPlatform = process.platform;
      const originalPathEntries = Object.entries(process.env).filter(
        ([key]) => key.toLowerCase() === "path"
      );
      const expected = "D:\\portable-node\\bin\\codex-acp.cmd";
      Object.defineProperty(process, "platform", { value: "win32" });
      for (const [key] of originalPathEntries) delete process.env[key];
      process.env.PATH = "C:\\Windows\\System32";
      mockGetSettings.mockReturnValue(
        settingsWithCodexPath(undefined, {
          APPDATA: "C:\\Users\\me\\AppData\\Roaming",
          Path: "D:\\portable-node\\bin",
        })
      );
      mockExistsSync.mockImplementation((candidate) => candidate === expected);

      try {
        await expect(detectCodexAcpPath()).resolves.toBe(expected);
      } finally {
        Object.defineProperty(process, "platform", { value: originalPlatform });
        for (const key of Object.keys(process.env)) {
          if (key.toLowerCase() === "path") delete process.env[key];
        }
        for (const [key, value] of originalPathEntries) process.env[key] = value;
      }
    });
  });

  describe("getCodexInstallState()", () => {
    it("returns a stable absent state when no executable is selected or present", () => {
      const first = getCodexInstallState(settingsWithCodexPath(), () => false);

      expect(first).toEqual({ kind: "absent" });
      expect(getCodexInstallState(settingsWithCodexPath("/missing/codex-acp"), () => false)).toBe(
        first
      );
      expect(mockGetCompatibility).not.toHaveBeenCalled();
    });

    it("returns the compatibility state for an executable that exists", () => {
      const checking: InstallState = { kind: "checking", source: "custom" };
      mockGetCompatibility.mockReturnValue(checking);

      expect(
        getCodexInstallState(settingsWithCodexPath("/usr/local/bin/codex-acp"), () => true)
      ).toBe(checking);
      expect(mockGetCompatibility).toHaveBeenCalledWith("/usr/local/bin/codex-acp", undefined);
    });
  });

  describe("refreshCodexInstallState()", () => {
    it("skips compatibility probing when no executable exists", async () => {
      await expect(
        refreshCodexInstallState(settingsWithCodexPath("/missing/codex-acp"), true, () => false)
      ).resolves.toEqual({ kind: "absent" });
      expect(mockRefreshCompatibility).not.toHaveBeenCalled();
    });

    it("refreshes compatibility for the selected executable", async () => {
      const ready: InstallState = { kind: "ready", source: "custom" };
      mockRefreshCompatibility.mockResolvedValue(ready);

      await expect(
        refreshCodexInstallState(
          settingsWithCodexPath("/usr/local/bin/codex-acp"),
          true,
          () => true
        )
      ).resolves.toBe(ready);
      expect(mockRefreshCompatibility).toHaveBeenCalledWith("/usr/local/bin/codex-acp", {
        force: true,
        envOverrides: undefined,
      });
    });
  });

  describe("subscribeCodexInstallState()", () => {
    it("returns the compatibility store unsubscribe function", () => {
      const listener = jest.fn();
      const unsubscribe = jest.fn();
      mockSubscribeCompatibility.mockReturnValue(unsubscribe);

      expect(subscribeCodexInstallState(listener)).toBe(unsubscribe);
      expect(mockSubscribeCompatibility).toHaveBeenCalledWith(expect.any(Function), listener);
    });

    it("provides the currently selected path and environment to the scoped subscription", () => {
      const settings = settingsWithCodexPath("/current/codex-acp", {
        PATH: "/portable/node",
      });
      mockGetSettings.mockReturnValue(settings);
      mockSubscribeCompatibility.mockReturnValue(jest.fn());

      subscribeCodexInstallState(jest.fn());
      const getCurrent = mockSubscribeCompatibility.mock.calls[0][0];

      expect(getCurrent()).toEqual({
        binaryPath: "/current/codex-acp",
        envOverrides: { PATH: "/portable/node" },
      });
    });
  });

  describe("CodexBackendDescriptor.subscribeInstallState()", () => {
    it("publishes checking immediately and refreshes after the selected path changes", async () => {
      let settingsListener:
        | ((previous: CopilotSettings, next: CopilotSettings) => void)
        | undefined;
      const unsubscribeSettings = jest.fn();
      const unsubscribeCompatibility = jest.fn();
      mockSubscribeToSettingsChange.mockImplementation((listener) => {
        settingsListener = listener;
        return unsubscribeSettings;
      });
      mockSubscribeCompatibility.mockReturnValue(unsubscribeCompatibility);
      mockRefreshCompatibility.mockResolvedValue({ kind: "ready", source: "custom" });
      const listener = jest.fn();

      const unsubscribe = CodexBackendDescriptor.subscribeInstallState({} as never, listener);
      settingsListener?.(
        settingsWithCodexPath("/legacy/codex-acp"),
        settingsWithCodexPath("/maintained/codex-acp")
      );
      await Promise.resolve();

      expect(listener).toHaveBeenCalledTimes(1);
      expect(mockRefreshCompatibility).toHaveBeenCalledWith("/maintained/codex-acp", {
        force: true,
        envOverrides: undefined,
      });
      expect(mockRefreshCompatibility.mock.invocationCallOrder[0]).toBeLessThan(
        listener.mock.invocationCallOrder[0]
      );

      unsubscribe();
      expect(unsubscribeSettings).toHaveBeenCalledTimes(1);
      expect(unsubscribeCompatibility).toHaveBeenCalledTimes(1);
    });

    it("refreshes compatibility after the configured environment changes", async () => {
      let settingsListener:
        | ((previous: CopilotSettings, next: CopilotSettings) => void)
        | undefined;
      mockSubscribeToSettingsChange.mockImplementation((listener) => {
        settingsListener = listener;
        return jest.fn();
      });
      mockSubscribeCompatibility.mockReturnValue(jest.fn());
      mockRefreshCompatibility.mockResolvedValue({ kind: "ready", source: "custom" });

      CodexBackendDescriptor.subscribeInstallState({} as never, jest.fn());
      settingsListener?.(
        settingsWithCodexPath("/codex-acp", { PATH: "/old/node" }),
        settingsWithCodexPath("/codex-acp", { PATH: "/new/node" })
      );
      await Promise.resolve();

      expect(mockRefreshCompatibility).toHaveBeenCalledWith("/codex-acp", {
        force: true,
        envOverrides: { PATH: "/new/node" },
      });
    });
  });

  describe("CodexBackendDescriptor.onPluginLoad()", () => {
    it("forces a compatibility refresh for an existing saved path", async () => {
      const settings = settingsWithCodexPath("/legacy/codex-acp");
      mockGetSettings.mockReturnValue(settings);
      mockRefreshCompatibility.mockResolvedValue({
        kind: "error",
        message: "update codex-acp",
      });

      await CodexBackendDescriptor.onPluginLoad?.({} as never);

      expect(mockRefreshCompatibility).toHaveBeenCalledWith("/legacy/codex-acp", {
        force: true,
        envOverrides: undefined,
      });
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
