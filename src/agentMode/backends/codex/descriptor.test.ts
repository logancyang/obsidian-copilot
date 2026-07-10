import {
  CODEX_ACP_INSTALL_COMMAND,
  CODEX_ACP_MIGRATION_COMMAND,
  CODEX_ACP_MIN_VERSION,
  CODEX_CLI_MIN_VERSION,
} from "@/constants";
import { resetSettings, setSettings, type CodexProbeMetadata } from "@/settings/model";
import { CodexBinaryManager, codexProbeSettingsFingerprint } from "./CodexBinaryManager";
import {
  CODEX_INSTALL_COMMAND,
  CODEX_MIGRATION_COMMAND,
  CodexBackendDescriptor,
  resolveCodexNodePath,
  subscribeCodexInstallState,
} from "./descriptor";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

const BINARY_PATH = "/usr/local/bin/codex-acp";

function supportedProbe(): CodexProbeMetadata {
  const settings = { binaryPath: BINARY_PATH };
  return {
    kind: "supported",
    launcherPath: BINARY_PATH,
    launcherKind: "executable",
    settingsFingerprint: codexProbeSettingsFingerprint(settings),
    probedAt: "2026-07-10T12:00:00.000Z",
    adapterVersion: CODEX_ACP_MIN_VERSION,
    cliVersion: CODEX_CLI_MIN_VERSION,
    cliSource: "bundled",
  };
}

function setCodexSettings(probe?: CodexProbeMetadata): void {
  setSettings({
    agentMode: {
      byok: {},
      mcpServers: [],
      activeBackend: "codex",
      debugFullFrames: false,
      welcomeDismissed: false,
      skills: { folder: "copilot/skills" },
      backends: { codex: { binaryPath: BINARY_PATH, probe } },
    },
  });
}

describe("CodexBackendDescriptor installation contract", () => {
  beforeEach(() => {
    resetSettings();
  });

  it("uses the replacement package install and migration commands", () => {
    expect(CODEX_INSTALL_COMMAND).toBe(CODEX_ACP_INSTALL_COMMAND);
    expect(CODEX_MIGRATION_COMMAND).toBe(CODEX_ACP_MIGRATION_COMMAND);
    expect(CODEX_INSTALL_COMMAND).toContain("@agentclientprotocol/codex-acp");
    expect(CODEX_INSTALL_COMMAND).not.toContain("@zed-industries/codex-acp");
  });

  it("reports supported adapter and CLI versions from persisted health", () => {
    const probe = supportedProbe();
    const settings = {
      agentMode: { backends: { codex: { binaryPath: BINARY_PATH, probe } } },
    } as never;

    expect(CodexBackendDescriptor.getInstallState(settings)).toEqual({
      kind: "ready",
      source: "custom",
      details: {
        adapterVersion: CODEX_ACP_MIN_VERSION,
        cliVersion: CODEX_CLI_MIN_VERSION,
        cliSource: "bundled",
      },
    });
  });

  it("never reports a legacy probe as ready", () => {
    const base = { binaryPath: BINARY_PATH };
    const settings = {
      agentMode: {
        backends: {
          codex: {
            ...base,
            probe: {
              kind: "legacy",
              launcherPath: BINARY_PATH,
              settingsFingerprint: codexProbeSettingsFingerprint(base),
              probedAt: "2026-07-10T12:00:00.000Z",
              adapterVersion: "0.8.1",
              reason: "Legacy adapter",
            },
          },
        },
      },
    } as never;

    expect(CodexBackendDescriptor.getInstallState(settings)).toMatchObject({
      kind: "blocked",
      remediation: CODEX_ACP_MIGRATION_COMMAND,
    });
  });

  it("refreshes changed launcher inputs and notifies after probe health changes", () => {
    setCodexSettings(supportedProbe());
    const callback = jest.fn();
    const refreshInstallState = jest.fn().mockResolvedValue({});
    const unsubscribe = subscribeCodexInstallState(() => ({ refreshInstallState }), callback);

    setSettings((current) => ({
      agentMode: {
        ...current.agentMode,
        backends: {
          ...current.agentMode.backends,
          codex: {
            ...current.agentMode.backends.codex,
            enabledModels: ["gpt-5"],
          },
        },
      },
    }));
    expect(callback).not.toHaveBeenCalled();
    expect(refreshInstallState).not.toHaveBeenCalled();

    setSettings((current) => ({
      agentMode: {
        ...current.agentMode,
        backends: {
          ...current.agentMode.backends,
          codex: {
            ...current.agentMode.backends.codex,
            envOverrides: { CODEX_PATH: "/custom/codex" },
          },
        },
      },
    }));
    expect(refreshInstallState).toHaveBeenCalledTimes(1);
    expect(callback).not.toHaveBeenCalled();

    setSettings((current) => ({
      agentMode: {
        ...current.agentMode,
        backends: {
          ...current.agentMode.backends,
          codex: {
            ...current.agentMode.backends.codex,
            probe: {
              kind: "absent",
              launcherPath: BINARY_PATH,
              settingsFingerprint: codexProbeSettingsFingerprint(current.agentMode.backends.codex),
              probedAt: "2026-07-10T12:01:00.000Z",
            },
          },
        },
      },
    }));
    expect(callback).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("refreshes manager health on plugin load", async () => {
    const refresh = jest
      .spyOn(CodexBinaryManager.prototype, "refreshInstallState")
      .mockResolvedValue(supportedProbe());

    await CodexBackendDescriptor.onPluginLoad?.({} as never);

    expect(refresh).toHaveBeenCalledTimes(1);
    refresh.mockRestore();
  });
});

describe("CodexBackendDescriptor modes and Windows launcher", () => {
  it("maps Ask, Plan, and Auto to replacement adapter mode ids", () => {
    expect(CodexBackendDescriptor.getModeMapping?.(null, null)).toEqual({
      kind: "setMode",
      canonical: { default: "agent", plan: "read-only", auto: "agent-full-access" },
      readOnlyModeId: "read-only",
    });
  });

  it("uses the resolver-detected Node executable for the Windows npm entry", () => {
    const entry =
      "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@agentclientprotocol\\codex-acp\\dist\\index.js";
    const nodePath = "C:\\Program Files\\nodejs\\node.exe";
    const existing = new Set([entry, nodePath]);

    expect(
      resolveCodexNodePath({
        homeDir: "C:\\Users\\me",
        platform: "win32",
        env: {
          APPDATA: "C:\\Users\\me\\AppData\\Roaming",
          Path: "C:\\Program Files\\nodejs",
        },
        fs: {
          existsSync: (candidate) => existing.has(candidate),
          readFileSync: () => "",
          readdirSync: () => [],
        },
      })
    ).toBe(nodePath);
  });
});
