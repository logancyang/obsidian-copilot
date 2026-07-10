import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { AgentSettings } from "./AgentSettings";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

jest.mock("obsidian", () => ({ Notice: jest.fn(), Platform: { isMobile: false } }));

jest.mock("@/components/ui/copyable-command", () => ({
  CopyableCommand: ({ command }: { command: string }) => (
    <code data-testid="replacement-command">{command}</code>
  ),
}));

jest.mock("@/settings/model", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  useSettingsValue: () => ({ agentMode: { activeBackend: "opencode", backends: {} } }),
  setSettings: jest.fn(),
  updateSetting: jest.fn(),
}));

// Mock the chat-backend options hook to avoid pulling the heavy @/modelManagement
// dependency chain (ByokPanel -> ConfirmModal extends Modal) into the test.
jest.mock("@/hooks/useChatBackendModelOptions", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  useChatBackendModelOptions: () => ({ options: [], resolveSelectionId: () => undefined }),
}));

const Icon: React.FC<{ className?: string }> = () => <svg data-testid="icon" />;

const installStates: Record<string, { kind: string; [key: string]: unknown }> = {
  opencode: { kind: "ready", source: "managed" },
  claude: { kind: "ready", source: "custom" },
  codex: { kind: "ready", source: "custom" },
};

function makeDescriptor(id: string, displayName: string) {
  return {
    id,
    displayName,
    Icon,
    getInstallState: () => installStates[id],
    getResolvedBinaryPath: () => null,
    openInstallUI: jest.fn(),
    onPluginLoad: jest.fn().mockResolvedValue(undefined),
    SettingsPanel: () => <div data-testid={`panel-${id}`}>settings panel</div>,
  };
}

const DESCRIPTORS = [
  makeDescriptor("opencode", "OpenCode"),
  makeDescriptor("claude", "Claude"),
  makeDescriptor("codex", "Codex"),
];

jest.mock("@/agentMode", () => ({
  listBackendDescriptors: () => DESCRIPTORS,
  InstallBadge: ({ state }: { state: { kind: string } }) => (
    <span data-testid="install-badge">
      {state.kind === "blocked" ? "Update required" : "Ready"}
    </span>
  ),
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook export
  useBackendInstallState: (descriptor: { getInstallState: () => unknown }) =>
    descriptor.getInstallState(),
  McpServersPanel: () => <div data-testid="mcp-panel">mcp</div>,
  AgentDefaultModelSetting: ({ descriptor }: { descriptor: { id: string } }) => (
    <div data-testid={`default-model-${descriptor.id}`}>default model</div>
  ),
}));

jest.mock("@/contexts/PluginContext", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real `usePlugin` hook; the name must match the export
  usePlugin: () => ({
    app: {},
    agentSessionManager: {
      getCachedBackendState: () => ({ model: "x" }),
      preloadModels: jest.fn().mockResolvedValue(undefined),
    },
  }),
}));

jest.mock("./ChatModelEnableList", () => ({
  ChatModelEnableList: () => <div data-testid="chat-model-list">chat models</div>,
}));

jest.mock("./ConfiguredModelEnableList", () => ({
  ConfiguredModelEnableList: ({ descriptor }: { descriptor: { id: string } }) => (
    <div data-testid={`model-list-${descriptor.id}`}>model list</div>
  ),
}));

describe("AgentSettings", () => {
  beforeEach(() => {
    installStates.opencode = { kind: "ready", source: "managed" };
    installStates.claude = { kind: "ready", source: "custom" };
    installStates.codex = { kind: "ready", source: "custom" };
    for (const descriptor of DESCRIPTORS) descriptor.onPluginLoad.mockClear();
  });

  it("renders the four sub-tabs in order: OpenCode, Claude, Codex, Quick Chat", () => {
    render(<AgentSettings />);
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["OpenCode", "Claude", "Codex", "Quick Chat"]);
  });

  it("keeps global items (Default backend + MCP) outside the tab strip", () => {
    render(<AgentSettings />);
    const tablist = screen.getByRole("tablist");
    expect(within(tablist).queryByText("Default backend")).toBeNull();
    expect(within(tablist).queryByTestId("mcp-panel")).toBeNull();
    expect(screen.getByText("Default backend")).not.toBeNull();
    expect(screen.getByTestId("mcp-panel")).not.toBeNull();
  });

  it("shows the first backend's content by default and the default-model picker above the model list", () => {
    render(<AgentSettings />);
    const picker = screen.getByTestId("default-model-opencode");
    const list = screen.getByTestId("model-list-opencode");
    expect(picker).not.toBeNull();
    expect(list).not.toBeNull();
    // DOCUMENT_POSITION_FOLLOWING means `list` comes after `picker` in the DOM.
    expect(picker.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Other backends' panels are not mounted while their tab is unselected.
    expect(screen.queryByTestId("default-model-codex")).toBeNull();
  });

  it("switches to the selected backend's content", () => {
    render(<AgentSettings />);
    expect(screen.queryByTestId("model-list-codex")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Codex" }));
    expect(screen.getByTestId("model-list-codex")).not.toBeNull();
    expect(screen.queryByTestId("model-list-opencode")).toBeNull();
  });

  it("shows the Quick Chat model list on the Quick Chat tab", () => {
    render(<AgentSettings />);
    expect(screen.queryByTestId("chat-model-list")).toBeNull();
    fireEvent.click(screen.getByText("Quick Chat"));
    expect(screen.getByTestId("chat-model-list")).not.toBeNull();
  });

  it("shows an incompatible-version message and hides ready-only model controls", () => {
    const message =
      "Claude Code 2.1.205 is not supported. Copilot requires Claude Code 2.1.206 or newer.";
    installStates.claude = {
      kind: "incompatible",
      source: "custom",
      currentVersion: "2.1.205",
      minVersion: "2.1.206",
      message,
    };

    render(<AgentSettings />);
    fireEvent.click(screen.getByRole("tab", { name: "Claude" }));

    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.queryByTestId("default-model-claude")).toBeNull();
    expect(screen.queryByTestId("model-list-claude")).toBeNull();
  });

  it("shows blocked Codex migration details and supports re-detection", async () => {
    installStates.codex = {
      kind: "blocked",
      reason: "The superseded adapter is installed.",
      remediation: "npm uninstall legacy && npm install replacement",
      details: { adapterVersion: "0.8.1", cliVersion: "0.143.0", cliSource: "bundled" },
    };

    render(<AgentSettings />);
    fireEvent.click(screen.getByRole("tab", { name: "Codex" }));

    expect(screen.getAllByText("Update required")).not.toHaveLength(0);
    expect(screen.getByText("The superseded adapter is installed.")).not.toBeNull();
    expect(screen.getByText(/Adapter 0\.8\.1/).textContent).toBe(
      "Adapter 0.8.1 · Effective CLI 0.143.0 (bundled)"
    );
    expect(screen.getByTestId("replacement-command").textContent).toBe(
      "npm uninstall legacy && npm install replacement"
    );

    fireEvent.click(screen.getByRole("button", { name: "Re-detect" }));
    expect(DESCRIPTORS[2].onPluginLoad).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole("button", { name: "Re-detect" })).not.toBeNull());
  });
});
