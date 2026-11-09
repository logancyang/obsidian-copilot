import type {
  ConnectionState,
  ConnectorsSnapshot,
  WaitingLogin,
} from "@/connectors/connectionManager";
import type { ServiceToolInfo } from "@/connectors/connectorTools";
import type { CustomConnectorState } from "@/connectors/custom/customConnectors";
import {
  ConnectedConnectors,
  type ConnectedConnectorsProps,
} from "@/connectors/ui/ConnectedConnectors";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";

function snapshotOf(
  connections: ConnectionState[],
  rest: Partial<ConnectorsSnapshot> = {}
): ConnectorsSnapshot {
  return {
    connections,
    waitingLogin: null,
    failedLogin: null,
    needsAttention: connections.some(({ status }) => status === "needs-login"),
    ...rest,
  };
}

function waitingFor(connectionId: string, serviceId: string): WaitingLogin {
  return {
    connectionId,
    serviceId,
    loginUrl: () => "https://login.example/authorize",
    cancel: jest.fn(),
  };
}

function renderList(props: Partial<ConnectedConnectorsProps> & { snapshot: ConnectorsSnapshot }) {
  const handlers = {
    customConnectors: [] as readonly CustomConnectorState[],
    toolsByConnection: new Map() as ReadonlyMap<string, readonly ServiceToolInfo[]>,
    onBrowse: jest.fn(),
    onAddCustom: jest.fn(),
    customActions: {
      onEdit: jest.fn(),
      onTryAgain: jest.fn(),
      onSetTurnedOff: jest.fn(),
      onRemove: jest.fn(),
      onShowTools: jest.fn(),
    },
    onConnect: jest.fn(),
    onReconnect: jest.fn(),
    onCheckAgain: jest.fn(async () => {}),
    onDisconnect: jest.fn(),
    onShowTools: jest.fn(),
  };
  const { rerender } = render(<ConnectedConnectors {...handlers} {...props} />);
  return {
    ...handlers,
    showSnapshot: (snapshot: ConnectorsSnapshot) =>
      rerender(<ConnectedConnectors {...handlers} {...props} snapshot={snapshot} />),
  };
}

const CUSTOM_NEEDS_KEY: CustomConnectorState = {
  config: { id: "acme", name: "Acme Docs", url: "https://a.test/mcp", headerNames: ["Key"] },
  status: { kind: "needs-key" },
};
const CUSTOM_CONNECTED: CustomConnectorState = {
  config: { id: "echo", name: "Echo", command: "echo-server", args: [], envNames: [] },
  status: { kind: "connected", tools: [{ name: "t1" }, { name: "t2" }] },
};
const CUSTOM_OFF: CustomConnectorState = {
  config: { id: "zeta", name: "Zeta", command: "zeta", args: [], envNames: [] },
  status: { kind: "off" },
};

function row(name: string): HTMLElement {
  return screen.getByRole("listitem", { name });
}

describe("ConnectedConnectors", () => {
  beforeAll(() => {
    if (!("PointerEvent" in window)) {
      (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
    }
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};
  });

  describe("ConnectedConnectors()", () => {
    it("invites the user to browse connectors when nothing is connected", () => {
      const { onBrowse } = renderList({ snapshot: snapshotOf([]) });

      expect(
        screen.getByRole("heading", { name: "Connect the services you work in" })
      ).toBeTruthy();
      expect(
        screen.getByText("Logins stay in this device's keychain. Copilot never sees your password.")
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Browse connectors" }));
      expect(onBrowse).toHaveBeenCalledTimes(1);
    });

    it("titles the list Connectors and lists those needing a login first, then unreachable ones, then the rest by name", () => {
      renderList({
        snapshot: snapshotOf([
          { id: "c1", serviceId: "notion", status: "connected", accountLabel: "Acme workspace" },
          { id: "c2", serviceId: "linear", status: "needs-login" },
          { id: "c3", serviceId: "miro", status: "unreachable" },
          { id: "c4", serviceId: "granola", status: "connected" },
        ]),
      });

      expect(screen.getByRole("heading", { name: "Connectors" })).toBeTruthy();
      expect(screen.getByText("Connect agents with external services.")).toBeTruthy();
      expect(screen.queryByText(/keychain/)).toBeNull();
      expect(
        screen.getAllByRole("listitem").map((item) => item.getAttribute("aria-label"))
      ).toEqual(["Linear", "Miro", "Granola", "Notion"]);
    });

    it("offers Add custom connector beside Browse connectors on the empty state and below the list", () => {
      const { onAddCustom, showSnapshot } = renderList({ snapshot: snapshotOf([]) });

      fireEvent.click(screen.getByRole("button", { name: "Add custom connector" }));
      showSnapshot(snapshotOf([{ id: "c1", serviceId: "notion", status: "connected" }]));
      fireEvent.click(screen.getByRole("button", { name: "Add custom connector" }));

      expect(onAddCustom).toHaveBeenCalledTimes(2);
    });

    it("lists custom connectors with the services, those needing the user first and those off last", () => {
      renderList({
        snapshot: snapshotOf([
          { id: "c1", serviceId: "notion", status: "connected" },
          { id: "c2", serviceId: "linear", status: "needs-login" },
        ]),
        customConnectors: [CUSTOM_OFF, CUSTOM_CONNECTED, CUSTOM_NEEDS_KEY],
      });

      expect(
        screen.getAllByRole("listitem").map((item) => item.getAttribute("aria-label"))
      ).toEqual(["Acme Docs", "Linear", "Echo", "Notion", "Zeta"]);
      expect(within(row("Acme Docs")).getByText("Custom")).toBeTruthy();
    });

    it("shows the list instead of the empty state when only custom connectors are added", () => {
      renderList({ snapshot: snapshotOf([]), customConnectors: [CUSTOM_CONNECTED] });

      expect(screen.getByRole("heading", { name: "Connectors" })).toBeTruthy();
      expect(
        screen.queryByRole("heading", { name: "Connect the services you work in" })
      ).toBeNull();
      expect(within(row("Echo")).getByText("2 tools")).toBeTruthy();
    });

    it("passes a custom row's actions through", () => {
      const { customActions } = renderList({
        snapshot: snapshotOf([]),
        customConnectors: [CUSTOM_NEEDS_KEY],
      });

      fireEvent.click(within(row("Acme Docs")).getByRole("button", { name: "Add API key" }));

      expect(customActions.onEdit).toHaveBeenCalledWith("acme");
    });

    it("shows each status in words, with the account name when the service gives one", () => {
      renderList({
        snapshot: snapshotOf([
          { id: "c1", serviceId: "notion", status: "connected", accountLabel: "Acme workspace" },
          { id: "c2", serviceId: "linear", status: "needs-login" },
          { id: "c3", serviceId: "miro", status: "unreachable" },
          { id: "c4", serviceId: "granola", status: "connected" },
        ]),
      });

      expect(within(row("Notion")).getByText("Connected · Acme workspace")).toBeTruthy();
      expect(within(row("Granola")).getByText("Connected")).toBeTruthy();
      expect(within(row("Linear")).getByText("Needs login")).toBeTruthy();
      expect(
        within(row("Miro")).getByText(
          "Couldn't reach Miro just now. Copilot tries again in your next chat."
        )
      ).toBeTruthy();
    });

    it("counts a connected service's tools once Copilot has listed them, and opens them from the count", () => {
      const { onShowTools, customActions } = renderList({
        snapshot: snapshotOf([
          { id: "c1", serviceId: "notion", status: "connected", accountLabel: "Acme workspace" },
          { id: "c4", serviceId: "granola", status: "connected" },
          { id: "c3", serviceId: "miro", status: "unreachable" },
        ]),
        toolsByConnection: new Map([
          ["c1", [{ name: "search" }, { name: "create_page" }]],
          ["c3", [{ name: "board" }]],
        ]),
        customConnectors: [CUSTOM_CONNECTED],
      });

      expect(row("Notion").textContent).toContain("Connected · Acme workspace · 2 tools");
      expect(within(row("Granola")).getByText("Connected")).toBeTruthy();
      expect(within(row("Granola")).queryByRole("button", { name: /tool/ })).toBeNull();
      expect(within(row("Miro")).queryByRole("button", { name: /tool/ })).toBeNull();

      fireEvent.click(within(row("Notion")).getByRole("button", { name: "2 tools" }));
      expect(onShowTools).toHaveBeenCalledWith("c1");
      fireEvent.click(within(row("Echo")).getByRole("button", { name: "2 tools" }));
      expect(customActions.onShowTools).toHaveBeenCalledWith("echo");
    });

    it("reconnects a connection that needs a login from its row", () => {
      const { onReconnect } = renderList({
        snapshot: snapshotOf([{ id: "c2", serviceId: "linear", status: "needs-login" }]),
      });

      fireEvent.click(within(row("Linear")).getByRole("button", { name: "Reconnect" }));

      expect(onReconnect).toHaveBeenCalledWith("c2");
    });

    it("checks an unreachable connection again when the user clicks Try again", () => {
      const { onCheckAgain, onReconnect } = renderList({
        snapshot: snapshotOf([{ id: "c3", serviceId: "miro", status: "unreachable" }]),
      });

      fireEvent.click(within(row("Miro")).getByRole("button", { name: "Try again" }));

      expect(onCheckAgain).toHaveBeenCalledWith("c3");
      expect(onReconnect).not.toHaveBeenCalled();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/858 keeps an unreachable row as couldn't reach, with Try again disabled, until the check finishes", async () => {
      let finishCheck = () => {};
      const { onCheckAgain, showSnapshot } = renderList({
        snapshot: snapshotOf([{ id: "c3", serviceId: "miro", status: "unreachable" }]),
      });
      onCheckAgain.mockReturnValue(new Promise<void>((resolve) => (finishCheck = resolve)));
      const tryAgain = () => within(row("Miro")).getByRole("button", { name: "Try again" });

      fireEvent.click(tryAgain());
      showSnapshot(snapshotOf([{ id: "c3", serviceId: "miro", status: "connected" }]));

      expect((tryAgain() as HTMLButtonElement).disabled).toBe(true);
      expect(within(row("Miro")).queryByText("Connected")).toBeNull();
      await act(async () => finishCheck());
      expect(within(row("Miro")).getByText("Connected")).toBeTruthy();
    });

    it("offers Reconnect and Disconnect in each row's more-actions menu", async () => {
      const { onReconnect, onDisconnect } = renderList({
        snapshot: snapshotOf([{ id: "c1", serviceId: "notion", status: "connected" }]),
      });
      const openMenu = () =>
        fireEvent.pointerDown(screen.getByRole("button", { name: "More actions for Notion" }), {
          button: 0,
          ctrlKey: false,
        });

      openMenu();
      fireEvent.click(await screen.findByRole("menuitem", { name: "Reconnect" }));
      openMenu();
      fireEvent.click(await screen.findByRole("menuitem", { name: "Disconnect" }));

      expect(onReconnect).toHaveBeenCalledWith("c1");
      await waitFor(() => expect(onDisconnect).toHaveBeenCalledWith("c1"));
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/858 asks to confirm Disconnect only once its menu has closed, so the confirm keeps focus in a settings popout", async () => {
      const confirmCancel = document.body.appendChild(document.createElement("button"));
      let menuShownWithConfirm: boolean | undefined;
      const onDisconnect = jest.fn(() => {
        menuShownWithConfirm = screen.queryByRole("menu") !== null;
        confirmCancel.focus();
      });
      renderList({
        snapshot: snapshotOf([{ id: "c1", serviceId: "notion", status: "connected" }]),
        onDisconnect,
      });

      fireEvent.pointerDown(screen.getByRole("button", { name: "More actions for Notion" }), {
        button: 0,
        ctrlKey: false,
      });
      fireEvent.click(await screen.findByRole("menuitem", { name: "Disconnect" }));

      await waitFor(() => expect(onDisconnect).toHaveBeenCalledWith("c1"));
      expect(menuShownWithConfirm).toBe(false);
      expect(document.activeElement).toBe(confirmCancel);
      confirmCancel.remove();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/858 opens the more-actions menu inside its row, so a settings modal keeps focus in the menu instead of closing it", async () => {
      renderList({
        snapshot: snapshotOf([{ id: "c1", serviceId: "notion", status: "connected" }]),
      });

      fireEvent.pointerDown(screen.getByRole("button", { name: "More actions for Notion" }), {
        button: 0,
        ctrlKey: false,
      });

      expect(await within(row("Notion")).findByRole("menu")).toBeTruthy();
    });

    it("shows a reconnect waiting for the browser with Cancel and ways to reopen the login", () => {
      const waitingLogin = waitingFor("c2", "linear");
      renderList({
        snapshot: snapshotOf([{ id: "c2", serviceId: "linear", status: "needs-login" }], {
          waitingLogin,
        }),
      });

      const linear = within(row("Linear"));
      expect(linear.getByRole("status").textContent).toBe(
        "Waiting for you to log in in your browser…"
      );
      expect(linear.getByRole("button", { name: "Copy the login link" })).toBeTruthy();
      expect(linear.getByRole("button", { name: "open it again" })).toBeTruthy();
      fireEvent.click(linear.getByRole("button", { name: "Cancel" }));
      expect(waitingLogin.cancel).toHaveBeenCalledTimes(1);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/858 shows a first login waiting for the browser after settings is reopened, with Cancel, above the empty state when nothing is connected yet", () => {
      const waitingLogin = waitingFor("new-id", "notion");
      renderList({ snapshot: snapshotOf([], { waitingLogin }) });

      const notion = within(row("Notion"));
      expect(notion.getByRole("status").textContent).toBe(
        "Waiting for you to log in in your browser…"
      );
      expect(notion.getByRole("button", { name: "Copy the login link" })).toBeTruthy();
      fireEvent.click(notion.getByRole("button", { name: "Cancel" }));
      expect(waitingLogin.cancel).toHaveBeenCalledTimes(1);
      expect(
        screen.getByRole("heading", { name: "Connect the services you work in" })
      ).toBeTruthy();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/858 lists a first login waiting for the browser above the connected services", () => {
      renderList({
        snapshot: snapshotOf([{ id: "c2", serviceId: "linear", status: "connected" }], {
          waitingLogin: waitingFor("new-id", "notion"),
        }),
      });

      expect(screen.getByRole("heading", { name: "Connectors" })).toBeTruthy();
      expect(
        screen.getAllByRole("listitem").map((item) => item.getAttribute("aria-label"))
      ).toEqual(["Notion", "Linear"]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/858 shows why a first login didn't finish, and connects again on Try again", () => {
      const { onConnect } = renderList({
        snapshot: snapshotOf([], {
          failedLogin: { connectionId: "new-id", serviceId: "notion", reason: "unreachable" },
        }),
      });

      const notion = within(row("Notion"));
      expect(notion.getByText("Couldn't reach Notion. Check your connection.")).toBeTruthy();
      fireEvent.click(notion.getByRole("button", { name: "Try again" }));
      expect(onConnect).toHaveBeenCalledWith("notion");
    });

    it("disables other rows' Reconnect while another login waits, and says why", () => {
      renderList({
        snapshot: snapshotOf(
          [
            { id: "c2", serviceId: "linear", status: "needs-login" },
            { id: "c5", serviceId: "todoist", status: "needs-login" },
          ],
          { waitingLogin: waitingFor("c2", "linear") }
        ),
      });

      const reconnect = within(row("Todoist")).getByRole("button", { name: "Reconnect" });
      expect((reconnect as HTMLButtonElement).disabled).toBe(true);
      expect(reconnect.parentElement?.getAttribute("title")).toBe(
        "Finish or cancel the Linear login first"
      );
    });

    it("shows why a reconnect didn't finish, with Try again", () => {
      const { onReconnect } = renderList({
        snapshot: snapshotOf([{ id: "c2", serviceId: "linear", status: "needs-login" }], {
          failedLogin: { connectionId: "c2", serviceId: "linear", reason: "cancelled-on-service" },
        }),
      });

      const linear = within(row("Linear"));
      expect(linear.getByText("Login was cancelled on Linear's page.")).toBeTruthy();
      fireEvent.click(linear.getByRole("button", { name: "Try again" }));
      expect(onReconnect).toHaveBeenCalledWith("c2");
    });

    it("links a login the service rejected to a prefilled report", () => {
      renderList({
        snapshot: snapshotOf([{ id: "c2", serviceId: "linear", status: "needs-login" }], {
          failedLogin: { connectionId: "c2", serviceId: "linear", reason: "rejected" },
        }),
      });

      const link = within(row("Linear")).getByRole("link", { name: "Let us know" });
      const url = new URL(link.getAttribute("href") ?? "");
      expect(url.origin + url.pathname).toBe(
        "https://github.com/logancyang/obsidian-copilot/issues/new"
      );
      expect(url.searchParams.get("title")).toBe("Connector login rejected: Linear");
    });
  });
});
