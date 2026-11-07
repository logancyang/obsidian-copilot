import type {
  ConnectionState,
  ConnectorsSnapshot,
  WaitingLogin,
} from "@/connectors/connectionManager";
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

const mockedEnabled = jest.mocked(useIsConnectorsEnabled);
const mockedEnsure = jest.mocked(ensureConnectorsEntitlement);
const MockedConfirmModal = jest.mocked(ConfirmModal);

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
  connectorTools = manager && { checkAgain: jest.fn(async () => {}) }
) {
  const app = new App();
  const plugin = { app, connectionManager: manager, connectorTools } as unknown as CopilotPlugin;
  return render(
    <AppContext.Provider value={app}>
      <PluginProvider plugin={plugin}>
        <TabProvider initialTab="connectors">
          <SettingsTabs />
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
  });
});
