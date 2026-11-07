import type {
  ConnectionState,
  ConnectorsSnapshot,
  WaitingLogin,
} from "@/connectors/connectionManager";
import {
  editableConfigText,
  parseCustomConnectors,
  type CustomConnectorConfig,
} from "@/connectors/custom/customConnectorConfig";
import type {
  CustomConnectorsSnapshot,
  CustomConnectorState,
} from "@/connectors/custom/customConnectors";
import { CustomConnectorModal } from "@/connectors/ui/CustomConnectorModal";
import {
  ensureConnectorsEntitlement,
  useIsConnectorsEnabled,
} from "@/connectors/connectorsEntitlement";
import type { LoginOutcome } from "@/connectors/oauth/connectorAuth";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { TabContent } from "@/components/ui/setting-tabs";
import { AppContext } from "@/context";
import { PluginProvider } from "@/contexts/PluginContext";
import { TabProvider, useTab } from "@/contexts/TabContext";
import type CopilotPlugin from "@/main";
import { ConnectorsSettings } from "@/settings/v2/components/ConnectorsSettings";
import { SettingsSubPageHost } from "@/settings/v2/SettingsSubPage";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App, Notice } from "obsidian";
import React from "react";

jest.mock("@/connectors/connectorsEntitlement", () => ({
  ensureConnectorsEntitlement: jest.fn(),
  useIsConnectorsEnabled: jest.fn(),
}));
jest.mock("@/components/modals/ConfirmModal", () => ({
  ConfirmModal: jest.fn().mockImplementation(() => ({ open: jest.fn() })),
}));
jest.mock("@/connectors/ui/CustomConnectorModal", () => ({
  CustomConnectorModal: jest.fn().mockImplementation(() => ({ open: jest.fn() })),
}));

const mockedEnabled = jest.mocked(useIsConnectorsEnabled);
const mockedEnsure = jest.mocked(ensureConnectorsEntitlement);
const MockedConfirmModal = jest.mocked(ConfirmModal);
const MockedCustomConnectorModal = jest.mocked(CustomConnectorModal);

const GITHUB: CustomConnectorConfig = {
  id: "github",
  name: "GitHub",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-github"],
  envNames: ["GITHUB_TOKEN"],
};

function fakeCustomConnectors(connectors: CustomConnectorState[] = []) {
  const snapshot: CustomConnectorsSnapshot = { connectors, needsAttention: false };
  return {
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
    parse: jest.fn((text: string) => parseCustomConnectors(text, new Set())),
    add: jest.fn(),
    edit: jest.fn(),
    remove: jest.fn(),
    setTurnedOff: jest.fn(),
    refresh: jest.fn(async () => {}),
    storedValueNames: jest.fn(() => new Set(["GITHUB_TOKEN"])),
  };
}

function lastModalForm() {
  const [, title, form] = MockedCustomConnectorModal.mock.calls.at(-1) ?? [];
  if (!form) throw new Error("No custom connector dialog opened");
  return { title, ...form };
}

function fakeManager(connections: ConnectionState[]) {
  let snapshot: ConnectorsSnapshot = {
    connections,
    waitingLogin: null,
    failedLogin: null,
    needsAttention: connections.some(({ status }) => status === "needs-login"),
  };
  const cancelLogin = jest.fn();
  const manager = {
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
    connect: jest.fn(),
    reconnect: jest.fn((connectionId: string) => {
      snapshot = {
        ...snapshot,
        waitingLogin: waitingLogin(connectionId, "linear", cancelLogin),
      };
      return new Promise<LoginOutcome>(() => {});
    }),
    disconnect: jest.fn(async () => {}),
    dismissFailedLogin: jest.fn(),
  };
  return {
    manager,
    cancelLogin,
    setSnapshot: (next: Partial<ConnectorsSnapshot>) => {
      snapshot = { ...snapshot, ...next };
    },
  };
}

function waitingLogin(connectionId: string, serviceId: string, cancel: () => void): WaitingLogin {
  return { connectionId, serviceId, loginUrl: () => null, cancel };
}

function SettingsTabs(): React.ReactElement {
  const { selectedTab, setSelectedTab } = useTab();
  return (
    <>
      <TabContent id="connectors" isSelected={selectedTab === "connectors"}>
        <ConnectorsSettings />
      </TabContent>
      <output aria-label="Selected tab">{selectedTab}</output>
      <button type="button" onClick={() => setSelectedTab("command")}>
        Commands tab
      </button>
    </>
  );
}

function renderSettings(
  manager: ReturnType<typeof fakeManager>["manager"] | undefined,
  connectorTools = manager && { checkAgain: jest.fn(async () => {}) },
  customConnectors = manager && fakeCustomConnectors()
) {
  const app = new App();
  const plugin = {
    app,
    connectionManager: manager,
    connectorTools,
    customConnectors,
  } as unknown as CopilotPlugin;
  return render(
    <AppContext.Provider value={app}>
      <PluginProvider plugin={plugin}>
        <TabProvider initialTab="connectors">
          <SettingsSubPageHost>
            <SettingsTabs />
          </SettingsSubPageHost>
        </TabProvider>
      </PluginProvider>
    </AppContext.Provider>
  );
}

const LINEAR_NEEDS_LOGIN: ConnectionState = {
  id: "c2",
  serviceId: "linear",
  status: "needs-login",
};

describe("ConnectorsSettings", () => {
  beforeAll(() => {
    if (!("PointerEvent" in window)) {
      (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
    }
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedEnabled.mockReturnValue(true);
    mockedEnsure.mockResolvedValue(true);
  });

  describe("ConnectorsSettings()", () => {
    it("says connectors are desktop-only where no connection manager runs", () => {
      renderSettings(undefined);

      expect(screen.getByText("Connectors are available on desktop.")).toBeTruthy();
    });

    it("shows the Supporter upsell instead of the list when the entitlement is missing", () => {
      mockedEnabled.mockReturnValue(false);
      renderSettings(fakeManager([LINEAR_NEEDS_LOGIN]).manager);

      expect(
        screen.getByRole("heading", { name: /Connectors is a preview for Supporters/ })
      ).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
    });

    it("keeps the list while the entitlement is still being verified", () => {
      mockedEnabled.mockReturnValue(undefined);
      renderSettings(fakeManager([LINEAR_NEEDS_LOGIN]).manager);

      expect(screen.getByRole("listitem", { name: "Linear" })).toBeTruthy();
    });

    it("takes a Supporter to the license key on the Basic tab", () => {
      mockedEnabled.mockReturnValue(false);
      renderSettings(fakeManager([]).manager);

      fireEvent.click(
        screen.getByRole("button", { name: "Already a Supporter? Enter your license key" })
      );

      expect(screen.getByRole("status", { name: "Selected tab" }).textContent).toBe("basic");
    });

    it("opens the plans page tagged with the connectors settings placement", () => {
      mockedEnabled.mockReturnValue(false);
      const open = jest.spyOn(window, "open").mockReturnValue(null);
      renderSettings(fakeManager([]).manager);

      fireEvent.click(screen.getByRole("button", { name: "See plans" }));

      const [url] = open.mock.calls[0] as [string];
      expect(new URL(url).searchParams.get("utm_medium")).toBe("connectors_settings");
      open.mockRestore();
    });

    it("checks the entitlement before reconnecting", async () => {
      const { manager } = fakeManager([LINEAR_NEEDS_LOGIN]);
      renderSettings(manager);

      fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));

      await waitFor(() => expect(manager.reconnect).toHaveBeenCalledWith("c2"));
      expect(mockedEnsure).toHaveBeenCalledTimes(1);
    });

    it("connects a service again when its first login didn't finish", async () => {
      const fake = fakeManager([]);
      fake.manager.connect.mockResolvedValue({ status: "cancelled" });
      fake.setSnapshot({
        failedLogin: { connectionId: "new", serviceId: "notion", reason: "timed-out" },
      });
      renderSettings(fake.manager);

      fireEvent.click(screen.getByRole("button", { name: "Try again" }));

      await waitFor(() => expect(fake.manager.connect).toHaveBeenCalledWith("notion"));
      expect(mockedEnsure).toHaveBeenCalledTimes(1);
    });

    it("starts no login when the entitlement check says the user isn't a Supporter", async () => {
      mockedEnsure.mockResolvedValue(false);
      const { manager } = fakeManager([LINEAR_NEEDS_LOGIN]);
      renderSettings(manager);

      fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));

      await act(() => mockedEnsure.mock.results[0].value as Promise<boolean>);
      expect(manager.reconnect).not.toHaveBeenCalled();
    });

    it("shows the login error as a Notice when a login can't start", async () => {
      const { manager } = fakeManager([LINEAR_NEEDS_LOGIN]);
      manager.reconnect.mockImplementation(() => {
        throw new Error("Finish or cancel the Notion login first.");
      });
      renderSettings(manager);

      fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));

      await waitFor(() =>
        expect(Notice).toHaveBeenCalledWith("Finish or cancel the Notion login first.")
      );
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/858 contacts an unreachable service again on Try again", () => {
      const { manager } = fakeManager([{ id: "c3", serviceId: "miro", status: "unreachable" }]);
      const connectorTools = { checkAgain: jest.fn(async () => {}) };
      renderSettings(manager, connectorTools);

      fireEvent.click(screen.getByRole("button", { name: "Try again" }));

      expect(connectorTools.checkAgain).toHaveBeenCalledWith("c3");
    });

    it("disconnects only after the user confirms the service's dialog", async () => {
      const { manager } = fakeManager([LINEAR_NEEDS_LOGIN]);
      renderSettings(manager);

      fireEvent.pointerDown(screen.getByRole("button", { name: "More actions for Linear" }), {
        button: 0,
        ctrlKey: false,
      });
      fireEvent.click(
        within(screen.getByRole("menu")).getByRole("menuitem", { name: "Disconnect" })
      );

      await waitFor(() => expect(MockedConfirmModal).toHaveBeenCalled());
      expect(MockedConfirmModal).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Function),
        "Agents lose access to Linear on all your devices, and Copilot signs out of it. You can connect it again anytime.",
        "Disconnect Linear?",
        "Disconnect",
        "Cancel",
        undefined,
        "destructive"
      );
      expect(manager.disconnect).not.toHaveBeenCalled();
      const confirm = MockedConfirmModal.mock.calls[0][1];
      void confirm();
      expect(manager.disconnect).toHaveBeenCalledWith("c2");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/858 cancels a login started here when settings closes, so it can't block the next login", async () => {
      const fake = fakeManager([LINEAR_NEEDS_LOGIN]);
      const { unmount } = renderSettings(fake.manager);
      fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
      await waitFor(() => expect(fake.manager.reconnect).toHaveBeenCalled());
      expect(fake.cancelLogin).not.toHaveBeenCalled();

      unmount();

      expect(fake.cancelLogin).toHaveBeenCalledTimes(1);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/858 cancels a login started here when the user switches to another settings tab", async () => {
      const fake = fakeManager([LINEAR_NEEDS_LOGIN]);
      renderSettings(fake.manager);
      fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
      await waitFor(() => expect(fake.manager.reconnect).toHaveBeenCalled());

      fireEvent.click(screen.getByRole("button", { name: "Commands tab" }));

      expect(fake.cancelLogin).toHaveBeenCalledTimes(1);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/858 leaves a login started from a chat card waiting when settings closes", () => {
      const fake = fakeManager([LINEAR_NEEDS_LOGIN]);
      const cancelCardLogin = jest.fn();
      fake.setSnapshot({ waitingLogin: waitingLogin("c2", "linear", cancelCardLogin) });
      const { unmount } = renderSettings(fake.manager);

      unmount();

      expect(cancelCardLogin).not.toHaveBeenCalled();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/874 opens Browse connectors as a settings sub-page in place of the list, and Back returns to the list", () => {
      renderSettings(fakeManager([LINEAR_NEEDS_LOGIN]).manager);

      fireEvent.click(screen.getByRole("button", { name: "Browse connectors" }));
      expect(screen.getByRole("heading", { name: "Browse connectors" })).toBeTruthy();
      expect(screen.queryByRole("heading", { name: "Connectors" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      expect(screen.getByRole("heading", { name: "Connectors" })).toBeTruthy();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/874 keeps a login started on Browse waiting after Back, and cancels it once the user switches to another settings tab", async () => {
      const fake = fakeManager([LINEAR_NEEDS_LOGIN]);
      renderSettings(fake.manager);
      fireEvent.click(screen.getByRole("button", { name: "Browse connectors" }));
      fireEvent.click(
        within(screen.getByRole("listitem", { name: "Linear" })).getByRole("button", {
          name: "Reconnect",
        })
      );
      await waitFor(() => expect(fake.manager.reconnect).toHaveBeenCalledWith("c2"));

      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      expect(fake.cancelLogin).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Commands tab" }));
      expect(fake.cancelLogin).toHaveBeenCalledTimes(1);
    });

    it("connects a service from Browse after checking the entitlement", async () => {
      const { manager } = fakeManager([]);
      renderSettings(manager);
      fireEvent.click(screen.getByRole("button", { name: "Browse connectors" }));

      fireEvent.click(
        within(screen.getByRole("listitem", { name: "Notion" })).getByRole("button", {
          name: "Connect",
        })
      );

      await waitFor(() => expect(manager.connect).toHaveBeenCalledWith("notion"));
      expect(mockedEnsure).toHaveBeenCalledTimes(1);
    });

    it("clears a login that didn't finish when the user moves between the list and Browse", () => {
      const fake = fakeManager([LINEAR_NEEDS_LOGIN]);
      renderSettings(fake.manager);

      fireEvent.click(screen.getByRole("button", { name: "Browse connectors" }));
      expect(fake.manager.dismissFailedLogin).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      expect(fake.manager.dismissFailedLogin).toHaveBeenCalledTimes(2);
    });

    it("clears a login that didn't finish when the user leaves the tab", () => {
      const fake = fakeManager([LINEAR_NEEDS_LOGIN]);
      fake.setSnapshot({
        failedLogin: { connectionId: "c2", serviceId: "linear", reason: "timed-out" },
      });
      const { unmount } = renderSettings(fake.manager);
      expect(fake.manager.dismissFailedLogin).not.toHaveBeenCalled();

      unmount();

      expect(fake.manager.dismissFailedLogin).toHaveBeenCalledTimes(1);
    });

    it("lists this device's custom connectors beside the services", () => {
      const custom = fakeCustomConnectors([
        { config: GITHUB, status: { kind: "connected", toolCount: 4 } },
      ]);
      renderSettings(fakeManager([LINEAR_NEEDS_LOGIN]).manager, undefined, custom);

      expect(
        screen.getAllByRole("listitem").map((item) => item.getAttribute("aria-label"))
      ).toEqual(["Linear", "GitHub"]);
      expect(
        within(screen.getByRole("listitem", { name: "GitHub" })).getByText("4 tools")
      ).toBeTruthy();
    });

    it("opens the Add custom connector dialog after checking the entitlement, and adds the servers it previews", async () => {
      const custom = fakeCustomConnectors();
      renderSettings(fakeManager([]).manager, undefined, custom);

      fireEvent.click(screen.getByRole("button", { name: "Add custom connector" }));

      await waitFor(() => expect(MockedCustomConnectorModal).toHaveBeenCalledTimes(1));
      expect(mockedEnsure).toHaveBeenCalledTimes(1);
      const form = lastModalForm();
      expect(form).toMatchObject({
        title: "Add custom connector",
        helper:
          "Paste the MCP server config from its README. Values in env and headers stay in this device's keychain.",
        submitLabel: "Add",
      });
      const text = '{"name": "Echo", "command": "echo-server"}';
      const parsed = form.parse(text);
      expect(custom.parse).toHaveBeenCalledWith(text);
      if (!parsed.ok) throw new Error(parsed.error);
      form.onSubmit(text, parsed.connectors);
      expect(custom.add).toHaveBeenCalledWith(parsed.connectors);
    });

    it("opens no Add dialog when the entitlement check says the user isn't a Supporter", async () => {
      mockedEnsure.mockResolvedValue(false);
      renderSettings(fakeManager([]).manager);

      fireEvent.click(screen.getByRole("button", { name: "Add custom connector" }));

      await act(() => mockedEnsure.mock.results[0].value as Promise<boolean>);
      expect(MockedCustomConnectorModal).not.toHaveBeenCalled();
    });

    it("opens the same Add dialog from Browse connectors", async () => {
      renderSettings(fakeManager([]).manager);
      fireEvent.click(screen.getByRole("button", { name: "Browse connectors" }));

      fireEvent.click(screen.getByRole("button", { name: "add a custom connector" }));

      await waitFor(() => expect(lastModalForm()).toMatchObject({ title: "Add custom connector" }));
    });

    it("opens Edit with the connector's config, every value blank and the names of the values this device stores, accepting one server, and saves through edit", () => {
      const custom = fakeCustomConnectors([{ config: GITHUB, status: { kind: "needs-key" } }]);
      renderSettings(fakeManager([]).manager, undefined, custom);

      fireEvent.click(screen.getByRole("button", { name: "Add API key" }));

      const form = lastModalForm();
      expect(form).toMatchObject({
        title: "Edit GitHub",
        helper: "Leave a value blank to keep the one stored on this device.",
        initialText: editableConfigText(GITHUB),
        storedValueNames: new Set(["GITHUB_TOKEN"]),
        submitLabel: "Save",
      });
      expect(custom.storedValueNames).toHaveBeenCalledWith("github");
      expect(
        form.parse(JSON.stringify({ mcpServers: { A: { command: "a" }, B: { command: "b" } } }))
      ).toEqual({ ok: false, error: "Paste one server to edit this connector." });
      form.onSubmit("edited text", []);
      expect(custom.edit).toHaveBeenCalledWith("github", "edited text");
    });

    it("starts a custom connector that couldn't start again on Try again", () => {
      const custom = fakeCustomConnectors([
        { config: GITHUB, status: { kind: "couldnt-start", reason: "npx: not found" } },
      ]);
      renderSettings(fakeManager([]).manager, undefined, custom);

      fireEvent.click(screen.getByRole("button", { name: "Try again" }));

      expect(custom.refresh).toHaveBeenCalledTimes(1);
    });

    it("turns a custom connector off on this device from its menu", async () => {
      const custom = fakeCustomConnectors([
        { config: GITHUB, status: { kind: "connected", toolCount: 4 } },
      ]);
      renderSettings(fakeManager([]).manager, undefined, custom);

      fireEvent.pointerDown(screen.getByRole("button", { name: "More actions for GitHub" }), {
        button: 0,
        ctrlKey: false,
      });
      fireEvent.click(await screen.findByRole("menuitem", { name: "Turn off on this device" }));

      expect(custom.setTurnedOff).toHaveBeenCalledWith("github", true);
    });

    it("removes a custom connector only after the user confirms its dialog", async () => {
      const custom = fakeCustomConnectors([
        { config: GITHUB, status: { kind: "connected", toolCount: 4 } },
      ]);
      renderSettings(fakeManager([]).manager, undefined, custom);

      fireEvent.pointerDown(screen.getByRole("button", { name: "More actions for GitHub" }), {
        button: 0,
        ctrlKey: false,
      });
      fireEvent.click(await screen.findByRole("menuitem", { name: "Remove" }));

      await waitFor(() => expect(MockedConfirmModal).toHaveBeenCalled());
      expect(MockedConfirmModal).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Function),
        "Agents lose access to GitHub on all your devices. You can add it again anytime.",
        "Remove GitHub?",
        "Remove",
        "Cancel",
        undefined,
        "destructive"
      );
      expect(custom.remove).not.toHaveBeenCalled();
      void MockedConfirmModal.mock.calls[0][1]();
      expect(custom.remove).toHaveBeenCalledWith("github");
    });
  });
});
