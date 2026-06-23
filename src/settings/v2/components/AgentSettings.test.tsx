import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { AgentSettings } from "./AgentSettings";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

jest.mock("obsidian", () => ({ Platform: { isMobile: false } }));

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

function makeDescriptor(id: string, displayName: string) {
  return {
    id,
    displayName,
    Icon,
    getInstallState: () => ({ kind: "ready" as const }),
    getResolvedBinaryPath: () => null,
    openInstallUI: jest.fn(),
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
  InstallBadge: () => <span data-testid="install-badge" />,
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
});
