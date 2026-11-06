import type { BackendAuthStatus } from "@/agentMode/session/types";
const mockAuthStatuses: Record<string, BackendAuthStatus | null> = {};
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { setSettings } from "@/settings/model";
import { playNotificationSound } from "@/utils/notificationSound";
import { SettingsSubPageHost } from "@/settings/v2/SettingsSubPage";
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

let resolvedPaths: Record<string, string | null> = {};

const MANAGED_BINARY_PATH = "/opt/copilot/opencode/bin/opencode";

const installStateListeners = new Set<() => void>();
function publishInstallState() {
  for (const listener of installStateListeners) listener();
}

const claudeRuleStore = {
  list: jest.fn(),
  remove: jest.fn(),
};

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
    ...(id === "claude" ? { approvedRules: claudeRuleStore } : {}),
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

function renderAgentSettings() {
  return render(<AgentSettings />, { wrapper: SettingsSubPageHost });
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
  describe("AgentSettings()", () => {
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
      claudeRuleStore.list
        .mockReset()
        .mockResolvedValue([
          { id: "rule-git", allows: "Bash(git status:*)", appliesTo: { kind: "agent" } },
        ]);
      claudeRuleStore.remove.mockReset().mockResolvedValue(undefined);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/865 offers Edit approved rules only on tabs of agents that can list their saved rules", () => {
      renderAgentSettings();
      expect(screen.queryByRole("button", { name: "Edit approved rules" })).toBeNull();

      fireEvent.click(screen.getByRole("tab", { name: "Claude" }));

      expect(screen.getByRole("button", { name: "Edit approved rules" })).not.toBeNull();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/865 replaces the whole settings view with the agent's approved rules, and Back restores it on the same agent tab", async () => {
      render(
        <SettingsSubPageHost>
          <h1>Copilot settings</h1>
          <AgentSettings />
          <section aria-label="General">General settings</section>
        </SettingsSubPageHost>
      );
      fireEvent.click(screen.getByRole("tab", { name: "Claude" }));

      fireEvent.click(screen.getByRole("button", { name: "Edit approved rules" }));

      expect(await screen.findByText("Bash(git status:*)")).not.toBeNull();
      expect(screen.queryByRole("heading", { name: "Copilot settings" })).toBeNull();
      expect(screen.queryByRole("tablist")).toBeNull();
      expect(screen.queryByRole("tabpanel")).toBeNull();
      expect(screen.queryByRole("region", { name: "General" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Back" }));

      expect(screen.queryByText("Bash(git status:*)")).toBeNull();
      expect(screen.getByRole("heading", { name: "Copilot settings" })).not.toBeNull();
      expect(screen.getByRole("region", { name: "General" })).not.toBeNull();
      expect(screen.getByRole("tab", { name: "Claude" }).getAttribute("aria-selected")).toBe(
        "true"
      );
      expect(within(screen.getByRole("tabpanel")).getByTestId("panel-claude")).not.toBeNull();
    });

    it.each(["claude", "codex"])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/379 reflects %s account readiness in the settings header",
      (id) => {
        mockSettings.agentMode.activeBackend = id;
        mockAuthStatuses[id] = { signedIn: false };
        const view = renderAgentSettings();
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
      renderAgentSettings();

      await waitFor(() => expect(mockGetCachedModelCatalog).toHaveBeenCalledWith("opencode"));
      expect(mockPreloadModels).not.toHaveBeenCalled();
    });

    it("preloads models when the shared catalog is unavailable", async () => {
      mockGetCachedModelCatalog.mockReturnValue(null);

      renderAgentSettings();

      await waitFor(() => expect(mockPreloadModels).toHaveBeenCalledWith("opencode"));
    });

    it("renders the four sub-tabs in order: OpenCode, Claude, Codex, Quick Chat", () => {
      renderAgentSettings();
      const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
      expect(tabs).toEqual(["OpenCode", "Claude", "Codex", "Quick Chat"]);
    });

    it("keeps the default agent picker outside the tab strip", () => {
      renderAgentSettings();
      const tablist = screen.getByRole("tablist");
      expect(within(tablist).queryByText("Default agent")).toBeNull();
      expect(screen.getByText("Default agent")).not.toBeNull();
    });

    it("mutes the chime when the notification sound switch is turned off", () => {
      renderAgentSettings();
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
      renderAgentSettings();

      fireEvent.change(screen.getByDisplayValue("Piano key"), { target: { value: "doorbell" } });

      const applyUpdate = (setSettings as jest.Mock).mock.calls[0][0] as (
        current: typeof mockSettings
      ) => { agentMode: typeof mockSettings.agentMode };
      expect(applyUpdate(mockSettings).agentMode.notificationSoundId).toBe("doorbell");
      expect(playNotificationSound).toHaveBeenCalledWith("doorbell");
    });

    it("shows the first backend's content by default and the default-model picker above the model list", () => {
      renderAgentSettings();
      const picker = screen.getByTestId("default-model-opencode");
      const list = screen.getByTestId("model-list-opencode");
      expect(picker).not.toBeNull();
      expect(list).not.toBeNull();
      expect(picker.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.queryByTestId("default-model-codex")).toBeNull();
    });

    it("switches to the selected backend's content", () => {
      renderAgentSettings();
      expect(screen.queryByTestId("model-list-codex")).toBeNull();
      fireEvent.click(screen.getByRole("tab", { name: "Codex" }));
      expect(screen.getByTestId("model-list-codex")).not.toBeNull();
      expect(screen.queryByTestId("model-list-opencode")).toBeNull();
    });

    it("shows the Quick Chat model list on the Quick Chat tab", () => {
      renderAgentSettings();
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

      renderAgentSettings();
      fireEvent.click(screen.getByRole("tab", { name: "Claude" }));

      expect(screen.getByText(message)).toBeTruthy();
      expect(screen.queryByTestId("default-model-claude")).toBeNull();
      expect(screen.queryByTestId("model-list-claude")).toBeNull();
    });

    it("shows a cloud-egress banner on a cloud backend under Self-Host Mode, not on a self-hostable one", () => {
      mockSettings.enableSelfHostMode = true;
      renderAgentSettings();
      expect(screen.queryByText("Cloud service.")).toBeNull();
      fireEvent.click(screen.getByRole("tab", { name: "Claude" }));
      expect(screen.getByText("Cloud service.")).toBeTruthy();
    });

    it.each(DESCRIPTORS)(
      "opens $displayName configuration while the binary is absent",
      (descriptor) => {
        installStates[descriptor.id] = { kind: "absent" };
        renderAgentSettings();
        fireEvent.click(screen.getByRole("tab", { name: descriptor.displayName }));
        fireEvent.click(screen.getByRole("button", { name: "Configure" }));
        expect(descriptor.openInstallUI).toHaveBeenCalledTimes(1);
        expect(screen.queryByText("Recommended")).toBeNull();
        expect(screen.queryByRole("button", { name: "Download opencode" })).toBeNull();
      }
    );

    it("shows the resolved binary when configuration finishes installing OpenCode", async () => {
      installStates.opencode = { kind: "absent" };
      renderAgentSettings();
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

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/531 opens configuration for outdated agents and shares update progress and failures", () => {
      installStates.codex = {
        kind: "incompatible",
        source: "managed",
        currentVersion: "1.9.0",
        minVersion: "1.10.0",
        message: "Codex adapter 1.9.0 does not match this Copilot release (1.10.0).",
      };
      const view = renderAgentSettings();
      fireEvent.click(screen.getByRole("tab", { name: "Codex" }));
      fireEvent.click(screen.getByRole("button", { name: "Configure" }));
      expect(DESCRIPTORS.find((d) => d.id === "codex")!.openInstallUI).toHaveBeenCalledTimes(1);
      expect(runManagedInstall).not.toHaveBeenCalled();

      managedInstallStates.codex = { kind: "running", label: "Installing… 30%" };
      view.rerender(<AgentSettings />);
      expect(screen.getByText("Installing… 30%")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Configure" }).hasAttribute("disabled")).toBe(
        false
      );

      managedInstallStates.codex = { kind: "error", message: "npm unavailable" };
      view.rerender(<AgentSettings />);
      expect(screen.getByText("npm unavailable")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Configure" }));
      expect(DESCRIPTORS.find((d) => d.id === "codex")!.openInstallUI).toHaveBeenCalledTimes(2);
      expect(runManagedInstall).not.toHaveBeenCalled();
    });
  });
});
