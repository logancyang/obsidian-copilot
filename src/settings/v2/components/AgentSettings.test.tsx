import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { AgentSettings } from "./AgentSettings";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

jest.mock("obsidian", () => ({ Platform: { isMobile: false } }));

let mockSettings: {
  agentMode: { activeBackend: string; backends: Record<string, unknown> };
  enableSelfHostMode: boolean;
};
jest.mock("@/settings/model", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  useSettingsValue: () => mockSettings,
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

function makeDescriptor(id: string, displayName: string, selfHostable = false) {
  return {
    id,
    displayName,
    selfHostable,
    Icon,
    getInstallState: () => installStates[id],
    getResolvedBinaryPath: () => null,
    openInstallUI: jest.fn(),
    SettingsPanel: () => <div data-testid={`panel-${id}`}>settings panel</div>,
  };
}

const DESCRIPTORS = [
  makeDescriptor("opencode", "OpenCode", true),
  makeDescriptor("claude", "Claude", false),
  makeDescriptor("codex", "Codex", false),
];

const mockGetCachedModelCatalog = jest.fn();
const mockPreloadModels = jest.fn();

jest.mock("@/agentMode", () => ({
  backendDisplayOrder: () => DESCRIPTORS,
  backendNeedsSelfHostWarning: (
    descriptor: { selfHostable?: boolean },
    settings: { enableSelfHostMode?: boolean }
  ) => Boolean(settings.enableSelfHostMode) && !descriptor.selfHostable,
  InstallBadge: () => <span data-testid="install-badge" />,
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook export
  useBackendInstallState: (descriptor: { getInstallState: () => unknown }) =>
    descriptor.getInstallState(),
  AgentDefaultModelSetting: ({ descriptor }: { descriptor: { id: string } }) => (
    <div data-testid={`default-model-${descriptor.id}`}>default model</div>
  ),
}));

jest.mock("@/contexts/PluginContext", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real `usePlugin` hook; the name must match the export
  usePlugin: () => ({
    app: {},
    agentSessionManager: {
      getCachedModelCatalog: mockGetCachedModelCatalog,
      preloadModels: mockPreloadModels,
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
    mockSettings = {
      agentMode: { activeBackend: "opencode", backends: {} },
      enableSelfHostMode: false,
    };
    installStates.opencode = { kind: "ready", source: "managed" };
    installStates.claude = { kind: "ready", source: "custom" };
    installStates.codex = { kind: "ready", source: "custom" };
    mockGetCachedModelCatalog.mockReset().mockReturnValue({ availableModels: [] });
    mockPreloadModels.mockReset().mockResolvedValue(undefined);
  });

  it("skips model preload when the shared catalog is already available", async () => {
    render(<AgentSettings />);

    await waitFor(() => expect(mockGetCachedModelCatalog).toHaveBeenCalledWith("opencode"));
    expect(mockPreloadModels).not.toHaveBeenCalled();
  });

  it("preloads models when the shared catalog is unavailable", async () => {
    mockGetCachedModelCatalog.mockReturnValue(null);

    render(<AgentSettings />);

    await waitFor(() => expect(mockPreloadModels).toHaveBeenCalledWith("opencode"));
  });

  it("renders the four sub-tabs in order: OpenCode, Claude, Codex, Quick Chat", () => {
    render(<AgentSettings />);
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["OpenCode", "Claude", "Codex", "Quick Chat"]);
  });

  it("keeps the default backend picker outside the tab strip", () => {
    render(<AgentSettings />);
    const tablist = screen.getByRole("tablist");
    expect(within(tablist).queryByText("Default backend")).toBeNull();
    expect(screen.getByText("Default backend")).not.toBeNull();
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

  it("shows a cloud-egress banner on a cloud backend under Self-Host Mode, not on a self-hostable one", () => {
    mockSettings.enableSelfHostMode = true;
    render(<AgentSettings />);
    // OpenCode (self-hostable) is the default tab — no banner.
    expect(screen.queryByText("Cloud service.")).toBeNull();
    // Claude runs in the cloud — the banner appears while Self-Host Mode is on.
    fireEvent.click(screen.getByRole("tab", { name: "Claude" }));
    expect(screen.getByText("Cloud service.")).toBeTruthy();
  });
});
