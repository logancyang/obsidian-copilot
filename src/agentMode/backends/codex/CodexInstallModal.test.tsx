import type { InstallState } from "@/agentMode/session/types";
import { CODEX_ACP_MIGRATION_COMMAND } from "@/constants";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { CodexConfigBody } from "./CodexInstallModal";

let mockInstallState: InstallState;
const refreshInstallState = jest.fn().mockResolvedValue({});

jest.mock("./CodexBinaryManager", () => ({
  codexInstallState: () => mockInstallState,
}));

/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mock mirrors the hook export */
jest.mock("@/settings/model", () => ({
  useSettingsValue: () => ({ agentMode: { backends: { codex: {} } } }),
}));
/* eslint-enable @eslint-react/hooks-extra/no-unnecessary-use-prefix */

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
  ConfigSection: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
}));

jest.mock("@/agentMode/backends/shared/InstallCommandRow", () => ({
  InstallCommandRow: ({ command, label }: { command: string; label?: string }) => (
    <div data-testid="install-command" data-command={command}>
      {label ?? "Install command"}
    </div>
  ),
}));

jest.mock("@/agentMode/backends/shared/BinaryPathSetting", () => ({
  BinaryPathSetting: ({
    onSave,
    placeholder,
  }: {
    onSave: (path: string) => Promise<string | null>;
    placeholder: string;
  }) => (
    <div>
      <span data-testid="binary-placeholder">{placeholder}</span>
      <button type="button" onClick={() => void onSave("/replacement/codex-acp")}>
        Auto-detect
      </button>
    </div>
  ),
}));

jest.mock("@/agentMode/backends/shared/installStatus", () => ({
  InstallStatusLine: ({ state, detail }: { state: InstallState; detail?: React.ReactNode }) => (
    <div>
      <span>{state.kind === "blocked" ? "Update required" : state.kind}</span>
      {detail}
    </div>
  ),
}));

jest.mock("./descriptor", () => ({
  CODEX_BINARY_NAME: "codex-acp",
  CODEX_INSTALL_COMMAND: "npm install -g @agentclientprotocol/codex-acp",
  codexAcpDetectionSearchDirs: jest.fn(),
  detectCodexAcpPath: jest.fn(),
  getCodexBinaryManager: () => ({ refreshInstallState }),
  updateCodexFields: jest.fn(),
}));

jest.mock("@/utils/detectBinary", () => ({
  validateExecutableFile: jest.fn().mockResolvedValue(null),
}));
jest.mock("obsidian", () => ({ App: class {}, Modal: class {}, Notice: jest.fn() }));

describe("CodexConfigBody", () => {
  beforeEach(() => {
    refreshInstallState.mockClear();
  });

  it("keeps new-user setup focused on the current package and auto-detection", () => {
    mockInstallState = { kind: "absent" };

    render(<CodexConfigBody onClose={jest.fn()} />);

    expect(screen.getByRole("heading", { name: "Install codex-acp" })).not.toBeNull();
    expect(screen.getByTestId("install-command").getAttribute("data-command")).toBe(
      "npm install -g @agentclientprotocol/codex-acp"
    );
    expect(screen.getByRole("button", { name: "Auto-detect" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Choose adapter path" })).not.toBeNull();
    expect(screen.getByTestId("binary-placeholder").textContent).toBe(
      "/absolute/path/to/codex-acp"
    );
    expect(screen.queryByText(/codex-acp\.exe/)).toBeNull();
    expect(screen.queryByText("Replacement command")).toBeNull();
  });

  it("shows blocked versions, reason, and the exact replacement command", () => {
    mockInstallState = {
      kind: "blocked",
      reason: "The superseded @zed-industries/codex-acp adapter is installed.",
      remediation: CODEX_ACP_MIGRATION_COMMAND,
      details: { adapterVersion: "0.8.1", cliVersion: "0.143.0", cliSource: "bundled" },
    };

    render(<CodexConfigBody onClose={jest.fn()} />);

    expect(screen.getAllByText("Update required")).not.toHaveLength(0);
    expect(screen.getByText(/Adapter 0\.8\.1/).textContent).toContain(
      "Adapter 0.8.1 · Effective CLI 0.143.0 (bundled)"
    );
    expect(
      screen.getByText("The superseded @zed-industries/codex-acp adapter is installed.")
    ).not.toBeNull();
    expect(screen.getByTestId("install-command").getAttribute("data-command")).toBe(
      CODEX_ACP_MIGRATION_COMMAND
    );
  });

  it("re-probes when auto-detection finds the same replaced launcher path", async () => {
    mockInstallState = {
      kind: "blocked",
      reason: "The superseded adapter is installed.",
      remediation: CODEX_ACP_MIGRATION_COMMAND,
    };
    render(<CodexConfigBody onClose={jest.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Auto-detect" }));

    await waitFor(() => expect(refreshInstallState).toHaveBeenCalledTimes(1));
  });

  it("shows healthy override provenance as a non-blocking warning", () => {
    mockInstallState = {
      kind: "ready",
      source: "custom",
      details: {
        adapterVersion: "1.1.2",
        cliVersion: "0.151.0",
        cliSource: "override",
        warning: "CODEX_PATH uses /custom/codex outside the bundled compatibility set.",
      },
    };

    render(<CodexConfigBody onClose={jest.fn()} />);

    expect(screen.getByText(/Adapter 1\.1\.2/).textContent).toContain(
      "Adapter 1.1.2 · Effective CLI 0.151.0 (override)"
    );
    expect(screen.getByText(/CODEX_PATH uses/)).not.toBeNull();
    expect(screen.queryByText("Update required")).toBeNull();
  });
});
