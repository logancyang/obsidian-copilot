import { OpencodeAbsentInstallActions } from "@/agentMode/backends/opencode/OpencodeInlineInstall";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { AgentSettings } from "./AgentSettings";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

// The inline install row is rendered for real (it is the panel's absent-state
// branch and the first thing a new user touches), so the binary manager behind
// it is the only thing stubbed.
const install = jest.fn();
// The inline row subscribes to the manager's runtime store, so the stub has to
// expose it with stable identities — an inline arrow per call would make
// `useSyncExternalStore` resubscribe on every commit.
const opencodeRuntimeListeners = new Set<() => void>();
// One frozen snapshot, not a fresh object per call: `useSyncExternalStore`
// compares by identity, so returning a new literal each time re-renders forever.
const IDLE_RUNTIME = Object.freeze({ kind: "idle" as const });
const opencodeManagerStub = {
  install,
  adoptExistingBinary: jest.fn().mockResolvedValue("/usr/local/bin/opencode"),
  cancelCurrentOperation: jest.fn(),
  subscribeRuntimeState: (onChange: () => void) => {
    opencodeRuntimeListeners.add(onChange);
    return () => opencodeRuntimeListeners.delete(onChange);
  },
  getRuntimeState: () => IDLE_RUNTIME,
};
jest.mock("@/agentMode/backends/opencode/descriptor", () => ({
  getOpencodeBinaryManager: () => opencodeManagerStub,
  detectOpencodeCliPath: jest.fn(),
  OpencodeBackendDescriptor: { openInstallUI: jest.fn() },
}));

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

/** Binary path each backend reports as resolved; absent means "not installed". */
let resolvedPaths: Record<string, string | null> = {};

/** Outside any home directory, so the display form is the path verbatim. */
const MANAGED_BINARY_PATH = "/opt/copilot/opencode/bin/opencode";

/**
 * Stands in for the settings subscription the real descriptors use, so a test can
 * move a backend's install state the way a finished install does and see the
 * panel react instead of re-rendering it by hand.
 */
const installStateListeners = new Set<() => void>();
function publishInstallState() {
  for (const listener of installStateListeners) listener();
}

function makeDescriptor(id: string, displayName: string, selfHostable = false) {
  return {
    id,
    displayName,
    selfHostable,
    Icon,
    getInstallState: () => installStates[id],
    getResolvedBinaryPath: () => resolvedPaths[id] ?? null,
    openInstallUI: jest.fn(),
    SettingsPanel: () => <div data-testid={`panel-${id}`}>settings panel</div>,
    // Only a backend the plugin can install itself ships inline actions; the
    // panel's absent-state branch keys off that.
    ...(id === "opencode" ? { AbsentInstallActions: OpencodeAbsentInstallActions } : {}),
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
  // The real badge, so "Ready" is the word the user actually sees.
  InstallBadge: jest.requireActual<typeof import("@/agentMode/backends/shared/installStatus")>(
    "@/agentMode/backends/shared/installStatus"
  ).InstallBadge,
  useBackendInstallState: (descriptor: { getInstallState: () => unknown }) => {
    const subscribe = React.useCallback((listener: () => void) => {
      installStateListeners.add(listener);
      return () => installStateListeners.delete(listener);
    }, []);
    const read = () => descriptor.getInstallState();
    return React.useSyncExternalStore(subscribe, read, read);
  },
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
    jest.clearAllMocks();
    install.mockResolvedValue({ version: "1.2.3", path: MANAGED_BINARY_PATH });
    mockSettings = {
      agentMode: { activeBackend: "opencode", backends: {} },
      enableSelfHostMode: false,
    };
    installStates.opencode = { kind: "ready", source: "managed" };
    installStates.claude = { kind: "ready", source: "custom" };
    installStates.codex = { kind: "ready", source: "custom" };
    mockGetCachedModelCatalog.mockReset().mockReturnValue({ availableModels: [] });
    mockPreloadModels.mockReset().mockResolvedValue(undefined);
    resolvedPaths = {};
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

  it("labels the section Agents without an alpha badge", () => {
    render(<AgentSettings />);
    expect(screen.getByText("Agents")).not.toBeNull();
    expect(screen.queryByText("alpha")).toBeNull();
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

  it("replaces Configure with the backend's inline install actions while it is absent", () => {
    installStates.opencode = { kind: "absent" };
    render(<AgentSettings />);
    expect(screen.getByRole("button", { name: "Download opencode" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Configure" })).toBeNull();
    expect(screen.getByText("Recommended")).not.toBeNull();
    expect(screen.getByText(/add providers on the BYOK tab/)).not.toBeNull();
  });

  it("keeps the Configure button for an absent backend that ships no inline actions", () => {
    installStates.claude = { kind: "absent" };
    render(<AgentSettings />);
    fireEvent.click(screen.getByRole("tab", { name: "Claude" }));
    expect(screen.getByRole("button", { name: "Configure" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Download opencode" })).toBeNull();
    // The BYOK hint would be wrong advice for a backend with its own account.
    expect(screen.queryByText("Recommended")).toBeNull();
    expect(screen.queryByText(/add providers on the BYOK tab/)).toBeNull();
  });

  it("drops the inline install actions once the backend reports ready", () => {
    render(<AgentSettings />);
    expect(screen.queryByRole("button", { name: "Download opencode" })).toBeNull();
    expect(screen.getByRole("button", { name: "Configure" })).not.toBeNull();
  });

  it("turns the absent row into the ready row when a first inline install lands", async () => {
    installStates.opencode = { kind: "absent" };
    install.mockImplementation(async () => {
      // What the manager does on success: persist the binary it just installed,
      // which is what the panel computes its install state from.
      installStates.opencode = { kind: "ready", source: "managed" };
      resolvedPaths.opencode = MANAGED_BINARY_PATH;
      publishInstallState();
      return { version: "1.2.3", path: MANAGED_BINARY_PATH };
    });
    render(<AgentSettings />);

    fireEvent.click(screen.getByRole("button", { name: "Download opencode" }));

    // The whole point of the inline row: the user never leaves the Basic tab and
    // never opens the Configure dialog to get from "not installed" to usable.
    expect(await screen.findByText("Ready")).not.toBeNull();
    expect(screen.getByText(MANAGED_BINARY_PATH)).not.toBeNull();
    expect(screen.getByRole("button", { name: "Configure" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Download opencode" })).toBeNull();
  });
});
