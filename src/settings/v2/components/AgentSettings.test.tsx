import type { BackendAuthStatus } from "@/agentMode/session/types";
const mockAuthStatuses: Record<string, BackendAuthStatus | null> = {};
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { setSettings } from "@/settings/model";
import { playNotificationSound } from "@/utils/notificationSound";
import { AgentSettings } from "./AgentSettings";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

jest.mock("@/utils/notificationSound", () => {
  const actual = jest.requireActual<object>("@/utils/notificationSound");
  return { ...actual, playNotificationSound: jest.fn() };
});

let mockSettings: {
  agentMode: {
    activeBackend: string;
    backends: Record<string, unknown>;
    notificationSound: boolean;
    notificationSoundId: string;
  };
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
const managedInstallStates: Record<string, { kind: string; [key: string]: unknown }> = {};
const runManagedInstall = jest.fn().mockResolvedValue(undefined);

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
    auth: id === "opencode" ? undefined : {},
    Icon,
    getInstallState: () => installStates[id],
    getResolvedBinaryPath: () => resolvedPaths[id] ?? null,
    openInstallUI: jest.fn(),
    SettingsPanel: () => <div data-testid={`panel-${id}`}>settings panel</div>,
    ...(id === "codex"
      ? {
          managedInstall: {
            getState: () => managedInstallStates.codex ?? { kind: "idle" },
            subscribe: () => () => {},
            run: runManagedInstall,
          },
        }
      : {}),
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
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the actual hook export
  useBackendAuthState: (descriptor: { id: string }) => ({
    status: mockAuthStatuses[descriptor.id],
  }),
  AgentBackendHeader: jest.requireActual<
    typeof import("@/agentMode/backends/shared/ui/AgentBackendHeader")
  >("@/agentMode/backends/shared/ui/AgentBackendHeader").AgentBackendHeader,
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
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook export
  useManagedInstallActionState: (descriptor: { id: string }) =>
    managedInstallStates[descriptor.id] ?? { kind: "idle" },
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
    mockAuthStatuses.claude = { signedIn: true };
    mockAuthStatuses.codex = { signedIn: true };
    mockSettings = {
      agentMode: {
        activeBackend: "opencode",
        backends: {},
        notificationSound: true,
        notificationSoundId: "piano",
      },
      enableSelfHostMode: false,
    };
    (setSettings as jest.Mock).mockClear();
    (playNotificationSound as jest.Mock).mockClear();
    installStates.opencode = { kind: "ready", source: "managed" };
    installStates.claude = { kind: "ready", source: "custom" };
    installStates.codex = { kind: "ready", source: "custom" };
    delete managedInstallStates.codex;
    runManagedInstall.mockReset().mockResolvedValue(undefined);
    mockGetCachedModelCatalog.mockReset().mockReturnValue({ availableModels: [] });
    mockPreloadModels.mockReset().mockResolvedValue(undefined);
    resolvedPaths = {};
  });

  it.each(["claude", "codex"])(
    "https://github.com/Brevilabs/obsidian-copilot-private/issues/379 reflects %s account readiness in the settings header",
    (id) => {
      mockSettings.agentMode.activeBackend = id;
      mockAuthStatuses[id] = { signedIn: false };
      const view = render(<AgentSettings />);
      fireEvent.click(screen.getByRole("tab", { name: id === "claude" ? "Claude" : "Codex" }));
      expect(screen.getByText("Sign in required")).toBeTruthy();
      expect(screen.queryByText("Ready")).toBeNull();
      mockAuthStatuses[id] = null;
      view.rerender(<AgentSettings />);
      expect(screen.getByText("Checking sign-in…")).toBeTruthy();
      mockAuthStatuses[id] = { signedIn: true };
      view.rerender(<AgentSettings />);
      expect(screen.getByText("Ready")).toBeTruthy();
    }
  );

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

  it("mutes the chime when the notification sound switch is turned off", () => {
    render(<AgentSettings />);
    const toggle = screen.getByRole("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(toggle);

    const applyUpdate = (setSettings as jest.Mock).mock.calls[0][0] as (
      current: typeof mockSettings
    ) => { agentMode: typeof mockSettings.agentMode };
    expect(applyUpdate(mockSettings)).toEqual({
      agentMode: { ...mockSettings.agentMode, notificationSound: false },
    });
  });

  it("plays a sound as soon as one is picked, and remembers the pick", () => {
    render(<AgentSettings />);

    fireEvent.change(screen.getByDisplayValue("Piano key"), { target: { value: "doorbell" } });

    const applyUpdate = (setSettings as jest.Mock).mock.calls[0][0] as (
      current: typeof mockSettings
    ) => { agentMode: typeof mockSettings.agentMode };
    expect(applyUpdate(mockSettings).agentMode.notificationSoundId).toBe("doorbell");
    expect(playNotificationSound).toHaveBeenCalledWith("doorbell");
  });

  it("hides the sound picker while the notification sound is off", () => {
    mockSettings.agentMode.notificationSound = false;

    render(<AgentSettings />);

    expect(screen.queryByText("Sound")).toBeNull();
    expect(screen.getByText("Notification")).not.toBeNull();
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

  it.each(DESCRIPTORS)(
    "opens $displayName configuration while the binary is absent",
    (descriptor) => {
      installStates[descriptor.id] = { kind: "absent" };
      render(<AgentSettings />);
      fireEvent.click(screen.getByRole("tab", { name: descriptor.displayName }));
      fireEvent.click(screen.getByRole("button", { name: "Configure" }));
      expect(descriptor.openInstallUI).toHaveBeenCalledTimes(1);
      expect(screen.queryByText("Recommended")).toBeNull();
      expect(screen.queryByRole("button", { name: "Download opencode" })).toBeNull();
    }
  );

  it("shows the resolved binary when configuration finishes installing OpenCode", async () => {
    installStates.opencode = { kind: "absent" };
    render(<AgentSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Configure" }));
    expect(DESCRIPTORS[0].openInstallUI).toHaveBeenCalledTimes(1);

    act(() => {
      installStates.opencode = { kind: "ready", source: "managed" };
      resolvedPaths.opencode = MANAGED_BINARY_PATH;
      publishInstallState();
    });

    expect(await screen.findByText("Ready")).not.toBeNull();
    expect(screen.getByText(MANAGED_BINARY_PATH)).not.toBeNull();
    expect(screen.getByRole("button", { name: "Configure" })).not.toBeNull();
  });

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/368 shares managed update progress and Retry in settings", () => {
    installStates.codex = {
      kind: "incompatible",
      source: "managed",
      currentVersion: "1.9.0",
      minVersion: "1.10.0",
      message: "Codex adapter 1.9.0 does not match this Copilot release (1.10.0).",
    };
    const view = render(<AgentSettings />);
    fireEvent.click(screen.getByRole("tab", { name: "Codex" }));
    fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));
    expect(runManagedInstall).toHaveBeenCalledTimes(1);

    managedInstallStates.codex = { kind: "running", label: "Installing… 30%" };
    view.rerender(<AgentSettings />);
    expect(screen.getByText("Installing… 30%")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upgrading…" }).hasAttribute("disabled")).toBe(true);

    managedInstallStates.codex = { kind: "error", message: "npm unavailable" };
    view.rerender(<AgentSettings />);
    expect(screen.getByText("npm unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(runManagedInstall).toHaveBeenCalledTimes(2);
  });
});
