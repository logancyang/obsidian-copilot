import { CONNECTOR_SERVICES, type ConnectorCatalogEntry } from "@/connectors/catalog";
import type { WaitingLogin } from "@/connectors/connectionManager";
import {
  ConnectedStatus,
  ConnectorRow,
  FailedLoginStatus,
  LoginButton,
  RowMenu,
  StatusLine,
  TextButton,
  WaitingConnectorRow,
} from "@/connectors/ui/ConnectorRow";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";

function service(id: string): ConnectorCatalogEntry {
  const entry = CONNECTOR_SERVICES.get(id);
  if (!entry) throw new Error(`No catalog entry ${id}`);
  return entry;
}

function waitingLogin(loginUrl: string | null): WaitingLogin {
  return { connectionId: "c1", serviceId: "notion", loginUrl: () => loginUrl, cancel: jest.fn() };
}

describe("ConnectorRow", () => {
  describe("ConnectorRow()", () => {
    it("shows the service's name, detail, actions and footer in a list item named after the service", () => {
      render(
        <ConnectorRow
          service={service("notion")}
          detail="Connected"
          actions={<button type="button">Reconnect</button>}
          footer="Didn't see a browser window?"
        />
      );

      const row = within(screen.getByRole("listitem", { name: "Notion" }));
      expect(row.getByText("Connected")).toBeTruthy();
      expect(row.getByRole("button", { name: "Reconnect" })).toBeTruthy();
      expect(row.getByText("Didn't see a browser window?")).toBeTruthy();
    });

    it("shows a tag beside the name, and a letter tile for a connector without a logo", () => {
      render(<ConnectorRow service={{ name: "acme docs" }} tag="Custom" detail="2 tools" />);

      const row = within(screen.getByRole("listitem", { name: "acme docs" }));
      expect(row.getByText("Custom")).toBeTruthy();
      expect(row.getByText("A")).toBeTruthy();
    });

    it("leaves out the actions and footer when it has none", () => {
      render(<ConnectorRow service={service("notion")} detail="Connected" />);

      expect(within(screen.getByRole("listitem")).queryByRole("button")).toBeNull();
    });
  });

  describe("StatusLine()", () => {
    it("colors the whole status red when it needs attention", () => {
      render(<StatusLine tone="attention">Needs login</StatusLine>);

      expect(screen.getByText("Needs login").parentElement?.className).toContain("tw-text-error");
    });

    it("keeps the status text in the row's color when it is fine", () => {
      render(<StatusLine tone="ok">Connected</StatusLine>);

      expect(screen.getByText("Connected").parentElement?.className).not.toContain("tw-text-error");
    });
  });

  describe("ConnectedStatus()", () => {
    it("says Connected with the account name and a tool count that opens the tools", () => {
      const onShowTools = jest.fn();
      const { container } = render(
        <ConnectedStatus accountLabel="Acme workspace" toolCount={12} onShowTools={onShowTools} />
      );

      expect(container.textContent).toBe("Connected · Acme workspace · 12 tools");
      fireEvent.click(screen.getByRole("button", { name: "12 tools" }));
      expect(onShowTools).toHaveBeenCalledTimes(1);
    });

    it("counts a single tool in the singular", () => {
      render(<ConnectedStatus toolCount={1} onShowTools={jest.fn()} />);

      expect(screen.getByRole("button", { name: "1 tool" })).toBeTruthy();
    });

    it("says only Connected while the tools aren't known yet", () => {
      const { container } = render(<ConnectedStatus toolCount={null} onShowTools={jest.fn()} />);

      expect(container.textContent).toBe("Connected");
      expect(screen.queryByRole("button")).toBeNull();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/878 shows 0 tools as text, since there are no tools to open", () => {
      const { container } = render(<ConnectedStatus toolCount={0} onShowTools={jest.fn()} />);

      expect(container.textContent).toBe("Connected · 0 tools");
      expect(screen.queryByRole("button")).toBeNull();
    });
  });

  describe("TextButton()", () => {
    it("is a button that runs its click handler", () => {
      const onClick = jest.fn();
      render(<TextButton onClick={onClick}>open it again</TextButton>);

      fireEvent.click(screen.getByRole("button", { name: "open it again" }));
      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });

  describe("WaitingConnectorRow()", () => {
    const writeText = jest.fn(async () => {});
    beforeEach(() => {
      writeText.mockClear();
      Object.assign(navigator, { clipboard: { writeText } });
    });

    it("says it is waiting for the browser and cancels the login on Cancel", () => {
      const login = waitingLogin("https://login.example/authorize");
      render(<WaitingConnectorRow service={service("notion")} waitingLogin={login} />);

      expect(screen.getByRole("status").textContent).toBe(
        "Waiting for you to log in in your browser…"
      );
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(login.cancel).toHaveBeenCalledTimes(1);
    });

    it("copies the current login link and says it was copied", async () => {
      render(
        <WaitingConnectorRow
          service={service("notion")}
          waitingLogin={waitingLogin("https://login.example/authorize")}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: "Copy the login link" }));
      expect(writeText).toHaveBeenCalledWith("https://login.example/authorize");
      expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
    });

    it("opens the current login link in the browser again", () => {
      const open = jest.spyOn(window, "open").mockReturnValue(null);
      render(
        <WaitingConnectorRow
          service={service("notion")}
          waitingLogin={waitingLogin("https://login.example/authorize")}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: "open it again" }));
      expect(open).toHaveBeenCalledWith("https://login.example/authorize", "_blank");
      open.mockRestore();
    });

    it("neither copies nor opens anything while the login has no link yet", () => {
      const open = jest.spyOn(window, "open").mockReturnValue(null);
      render(<WaitingConnectorRow service={service("notion")} waitingLogin={waitingLogin(null)} />);

      fireEvent.click(screen.getByRole("button", { name: "Copy the login link" }));
      fireEvent.click(screen.getByRole("button", { name: "open it again" }));
      expect(writeText).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
      open.mockRestore();
    });
  });

  describe("FailedLoginStatus()", () => {
    it("states why the login didn't finish, without a report link for an ordinary failure", () => {
      render(
        <FailedLoginStatus
          service={service("linear")}
          failedLogin={{ connectionId: "c1", serviceId: "linear", reason: "timed-out" }}
        />
      );

      expect(screen.getByText("The login timed out. Try again when you're ready.")).toBeTruthy();
      expect(screen.queryByRole("link")).toBeNull();
    });

    it("links a login the service rejected to a report about that service", () => {
      render(
        <FailedLoginStatus
          service={service("linear")}
          failedLogin={{ connectionId: "c1", serviceId: "linear", reason: "rejected" }}
        />
      );

      expect(screen.getByText(/Linear didn't accept Copilot's login\./)).toBeTruthy();
      const href = screen.getByRole("link", { name: "Let us know" }).getAttribute("href") ?? "";
      expect(new URL(href).searchParams.get("title")).toBe("Connector login rejected: Linear");
    });
  });

  describe("LoginButton()", () => {
    it("runs its action when no other login is waiting", () => {
      const onClick = jest.fn();
      render(
        <LoginButton blockedBy={null} onClick={onClick}>
          Connect
        </LoginButton>
      );

      fireEvent.click(screen.getByRole("button", { name: "Connect" }));
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("is disabled and names the waiting login while another service's login waits", () => {
      const onClick = jest.fn();
      render(
        <LoginButton blockedBy="Notion" onClick={onClick}>
          Connect
        </LoginButton>
      );

      const button = screen.getByRole("button", { name: "Connect" });
      fireEvent.click(button);
      expect(button).toHaveProperty("disabled", true);
      expect(onClick).not.toHaveBeenCalled();
      expect(button.parentElement?.getAttribute("title")).toBe(
        "Finish or cancel the Notion login first"
      );
    });
  });

  describe("RowMenu()", () => {
    beforeAll(() => {
      if (!("PointerEvent" in window)) {
        (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
      }
      Element.prototype.hasPointerCapture = () => false;
      Element.prototype.releasePointerCapture = () => {};
    });

    const openMenu = () =>
      fireEvent.pointerDown(screen.getByRole("button", { name: "More actions for Acme" }), {
        button: 0,
        ctrlKey: false,
      });

    it("lists its items under a button named after the row, and runs the chosen one", async () => {
      const onEdit = jest.fn();
      render(
        <RowMenu
          name="Acme"
          items={[
            { label: "Edit", icon: null, onSelect: onEdit },
            { label: "Remove", icon: null, onSelect: jest.fn(), destructive: true },
          ]}
        />
      );

      openMenu();
      const items = await screen.findAllByRole("menuitem");
      expect(items.map((item) => item.textContent)).toEqual(["Edit", "Remove"]);
      expect(items[1].className).toContain("tw-text-error");
      fireEvent.click(items[0]);
      expect(onEdit).toHaveBeenCalledTimes(1);
    });

    it("keeps a disabled item from running", async () => {
      const onSelect = jest.fn();
      render(
        <RowMenu
          name="Acme"
          items={[{ label: "Reconnect", icon: null, onSelect, disabled: true }]}
        />
      );

      openMenu();
      fireEvent.click(await screen.findByRole("menuitem", { name: "Reconnect" }));
      expect(onSelect).not.toHaveBeenCalled();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/858 opens an item's dialog only once the menu has closed, and leaves focus in that dialog", async () => {
      const dialogButton = document.body.appendChild(document.createElement("button"));
      let menuShownWithDialog: boolean | undefined;
      const onSelect = jest.fn(() => {
        menuShownWithDialog = screen.queryByRole("menu") !== null;
        dialogButton.focus();
      });
      render(
        <RowMenu name="Acme" items={[{ label: "Edit", icon: null, onSelect, opensDialog: true }]} />
      );

      openMenu();
      fireEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));

      await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
      expect(menuShownWithDialog).toBe(false);
      expect(document.activeElement).toBe(dialogButton);
      dialogButton.remove();
    });
  });
});
