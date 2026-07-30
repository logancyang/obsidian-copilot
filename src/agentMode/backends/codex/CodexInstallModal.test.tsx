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
  InstallCommandRow: () => null,
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
    "Copilot could not verify this as the maintained Codex ACP adapter. The superseded adapter cannot provide current Codex models. Update with: npm install -g @agentclientprotocol/codex-acp, then select the new codex-acp path.",
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

    it("renders and refreshes the adapter compatibility state", () => {
      render(<CodexConfigBody onClose={jest.fn()} />);

      expect(screen.getByText(CODEX_ACP_UPDATE_MESSAGE)).toBeTruthy();
      expect(mockGetCodexInstallState).toHaveBeenCalled();
      expect(mockSubscribeCodexInstallState).toHaveBeenCalled();
      expect(mockRefreshCodexInstallState).toHaveBeenCalledWith(expect.anything(), true);
    });
  });
});
