import type { InstallState } from "@/agentMode/session/types";
import { render, screen } from "@testing-library/react";
import React from "react";
import {
  getCodexInstallState,
  refreshCodexInstallState,
  subscribeCodexInstallState,
} from "./descriptor";
import { CODEX_ACP_UPDATE_MESSAGE } from "./codexCompatibility";
import { CodexConfigBody } from "./CodexInstallModal";

let installState: InstallState = {
  kind: "error",
  message: CODEX_ACP_UPDATE_MESSAGE,
};

jest.mock("@/agentMode/backends/shared/BinaryPathSetting", () => ({
  BinaryPathSetting: () => null,
}));

jest.mock("@/agentMode/backends/shared/ConfigDialogShell", () => ({
  ConfigDialogShell: ({
    status,
    children,
  }: {
    status: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <div>
      {status}
      {children}
    </div>
  ),
  ConfigSection: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
}));

jest.mock("@/agentMode/backends/shared/InstallCommandRow", () => ({
  InstallCommandRow: ({ command, label }: { command: string; label?: string }) => (
    <div>
      {label}: {command}
    </div>
  ),
}));

jest.mock("@/agentMode/backends/shared/installStatus", () => ({
  InstallStatusLine: ({ state }: { state: InstallState }) => (
    <div>{state.kind === "error" ? state.message : state.kind}</div>
  ),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({
    agentMode: { backends: { codex: { binaryPath: "/legacy/codex-acp" } } },
  })),
  useSettingsValue: jest.fn(() => ({
    agentMode: { backends: { codex: { binaryPath: "/legacy/codex-acp" } } },
  })),
}));

jest.mock("./descriptor", () => ({
  CODEX_ACP_UPDATE_MESSAGE:
    "Copilot could not verify this as the maintained Codex ACP adapter. The superseded adapter cannot provide current Codex models. Run npm uninstall -g @zed-industries/codex-acp, then npm install -g @agentclientprotocol/codex-acp, and select the new codex-acp path.",
  CODEX_BINARY_NAME: "codex-acp",
  CODEX_INSTALL_COMMAND: "npm install -g @agentclientprotocol/codex-acp",
  codexAcpDetectionSearchDirs: jest.fn(() => []),
  detectCodexAcpPath: jest.fn(),
  getCodexInstallState: jest.fn(() => installState),
  refreshCodexInstallState: jest.fn(() => Promise.resolve(installState)),
  subscribeCodexInstallState: jest.fn(() => () => {}),
  updateCodexFields: jest.fn(),
}));

const mockGetCodexInstallState = getCodexInstallState as jest.MockedFunction<
  typeof getCodexInstallState
>;
const mockRefreshCodexInstallState = refreshCodexInstallState as jest.MockedFunction<
  typeof refreshCodexInstallState
>;
const mockSubscribeCodexInstallState = subscribeCodexInstallState as jest.MockedFunction<
  typeof subscribeCodexInstallState
>;

describe("CodexInstallModal", () => {
  describe("CodexConfigBody()", () => {
    beforeEach(() => {
      installState = {
        kind: "error",
        message: CODEX_ACP_UPDATE_MESSAGE,
      };
      jest.clearAllMocks();
    });

    it("shows ordered migration commands and rechecks an incompatible adapter", () => {
      render(<CodexConfigBody onClose={jest.fn()} />);

      expect(screen.getByText(CODEX_ACP_UPDATE_MESSAGE)).toBeTruthy();
      expect(screen.getByText(/1. Remove the superseded adapter/)).toBeTruthy();
      expect(screen.getByText(/2. Install the maintained adapter/)).toBeTruthy();
      expect(mockGetCodexInstallState).toHaveBeenCalled();
      expect(mockSubscribeCodexInstallState).toHaveBeenCalled();
      expect(mockRefreshCodexInstallState).toHaveBeenCalledWith(expect.anything(), true);
    });

    it("does not force a settled adapter recheck when Configure opens", () => {
      installState = { kind: "ready", source: "custom" };

      render(<CodexConfigBody onClose={jest.fn()} />);

      expect(screen.queryByText(/npm uninstall -g @zed-industries\/codex-acp/)).not.toBeTruthy();
      expect(screen.getByText(/npm install -g @agentclientprotocol\/codex-acp/)).toBeTruthy();
      expect(mockRefreshCodexInstallState).toHaveBeenCalledWith(expect.anything(), false);
    });

    it("shows the removal step before installing when no adapter path is configured", () => {
      installState = { kind: "absent" };

      render(<CodexConfigBody onClose={jest.fn()} />);

      expect(screen.getByText(/1. Remove the superseded adapter/)).toBeTruthy();
      expect(screen.getByText(/2. Install the maintained adapter/)).toBeTruthy();
      expect(mockRefreshCodexInstallState).toHaveBeenCalledWith(expect.anything(), true);
    });

    it("shows one native PowerShell migration command on Windows", () => {
      render(<CodexConfigBody onClose={jest.fn()} platform="win32" />);

      expect(screen.queryByText(/1. Remove the superseded adapter/)).not.toBeTruthy();
      expect(
        screen.getByText(
          /irm https:\/\/raw\.githubusercontent\.com\/logancyang\/obsidian-copilot\/78723aec5ebe3a1fa271ebf437511550a97f3266/
        )
      ).toBeTruthy();
      expect(
        screen.getByText(/Replace with the maintained adapter \(Windows PowerShell\)/)
      ).toBeTruthy();
    });
  });
});
