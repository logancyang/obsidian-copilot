import { CONNECTOR_SERVICES, type ConnectorCatalogEntry } from "@/connectors/catalog";
import type { WaitingLogin } from "@/connectors/connectionManager";
import {
  ConnectorRow,
  FailedLoginStatus,
  LoginButton,
  StatusLine,
  TextButton,
  WaitingConnectorRow,
} from "@/connectors/ui/ConnectorRow";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
});
