import { CONNECTOR_CATALOG } from "@/connectors/catalog";
import { ConnectionManager, type ConnectorAuthPort } from "@/connectors/connectionManager";
import {
  ensureConnectorsEntitlement,
  useIsConnectorsEnabled,
} from "@/connectors/connectorsEntitlement";
import type { ConnectorLoginTarget, LoginOutcome } from "@/connectors/oauth/connectorAuth";
import { ConnectorChatCard, type ConnectorChatCardProps } from "@/connectors/ui/ConnectorChatCard";
import { AppContext } from "@/context";
import { navigateToPlusPage } from "@/plusUtils";
import { setSettings } from "@/settings/model";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "obsidian";
import React from "react";

jest.mock("@/connectors/connectorsEntitlement", () => ({
  ensureConnectorsEntitlement: jest.fn(),
  useIsConnectorsEnabled: jest.fn(),
}));
jest.mock("@/plusUtils", () => ({ navigateToPlusPage: jest.fn() }));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/860";
const mockedEnabled = jest.mocked(useIsConnectorsEnabled);
const mockedEnsure = jest.mocked(ensureConnectorsEntitlement);

function fakeServices(loggedIn: string[] = []) {
  const logins = new Set(loggedIn);
  const finishes = new Map<string, (outcome: LoginOutcome) => void>();
  const auth = {
    hasLogin: (id: string) => logins.has(id),
    accessToken: jest.fn(async () => ({ status: "needs-login" as const })),
    login: jest.fn((target: ConnectorLoginTarget) => {
      const outcome = new Promise<LoginOutcome>((resolve) => {
        finishes.set(target.serviceName, (result) => {
          if (result.status === "connected") logins.add(target.connectionId);
          resolve(result);
        });
      });
      return {
        connectionId: target.connectionId,
        serviceName: target.serviceName,
        outcome,
        loginUrl: () => `https://login.test/${target.serviceName}`,
        cancel: () => finishes.get(target.serviceName)?.({ status: "cancelled" }),
      };
    }),
    disconnect: jest.fn(async () => {}),
  } satisfies ConnectorAuthPort;
  const manager = new ConnectionManager({ auth, catalog: CONNECTOR_CATALOG });
  const finish = (serviceName: string, outcome: LoginOutcome) =>
    act(() => finishes.get(serviceName)?.(outcome));
  return { manager, auth, finish };
}

function renderCard(
  props: Partial<ConnectorChatCardProps> & Pick<ConnectorChatCardProps, "manager">
) {
  const onDismiss = jest.fn();
  const view = render(
    <AppContext.Provider value={new App()}>
      <ConnectorChatCard serviceId="notion" onDismiss={onDismiss} {...props} />
    </AppContext.Provider>
  );
  return { ...view, onDismiss };
}

function button(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

describe("ConnectorChatCard", () => {
  beforeAll(() => {
    let counter = 0;
    Object.defineProperty(window.crypto, "randomUUID", {
      configurable: true,
      value: () => `connection-${++counter}`,
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedEnabled.mockReturnValue(true);
    mockedEnsure.mockResolvedValue(true);
    setSettings({ connectors: [] });
  });

  afterEach(() => {
    setSettings({ connectors: [] });
  });

  describe("ConnectorChatCard()", () => {
    it(`${ISSUE} offers to connect a service that isn't connected, and Not now dismisses the card`, () => {
      const { manager } = fakeServices();
      const { onDismiss } = renderCard({ manager });

      expect(screen.getByText("Connect Notion")).toBeTruthy();
      expect(
        screen.getByText("Log in once and every agent can use your Notion account.")
      ).toBeTruthy();
      fireEvent.click(button("Not now"));

      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it(`${ISSUE} runs the entitlement check, then the settings login, and waits with Cancel and the login link`, async () => {
      const { manager, auth } = fakeServices();
      renderCard({ manager });

      fireEvent.click(button("Connect"));

      await waitFor(() =>
        expect(screen.getByRole("status").textContent).toBe("Finish logging in in your browser…")
      );
      expect(mockedEnsure).toHaveBeenCalledTimes(1);
      expect(auth.login).toHaveBeenCalledWith(
        expect.objectContaining({ serverUrl: "https://mcp.notion.com/mcp", serviceName: "Notion" })
      );
      expect(button("No browser window? Copy the login link")).toBeTruthy();

      fireEvent.click(button("Cancel"));
      await waitFor(() => expect(button("Connect")).toBeTruthy());
    });

    it(`${ISSUE} connects nothing when the entitlement check fails`, async () => {
      mockedEnsure.mockResolvedValue(false);
      const { manager, auth } = fakeServices();
      renderCard({ manager });

      fireEvent.click(button("Connect"));

      await waitFor(() => expect(mockedEnsure).toHaveBeenCalled());
      expect(auth.login).not.toHaveBeenCalled();
    });

    it(`${ISSUE} says the service is connected once the login finishes`, async () => {
      const { manager, finish } = fakeServices();
      renderCard({ manager });
      fireEvent.click(button("Connect"));
      await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());

      finish("Notion", { status: "connected" });

      expect(await screen.findByText("Notion connected. Every agent can use it now.")).toBeTruthy();
    });

    it(`${ISSUE} shows a Reconnect card for a service whose login expired, and Reconnect logs in again on the same connection`, async () => {
      setSettings({ connectors: [{ id: "c-notion", serviceId: "notion" }] });
      const { manager, auth } = fakeServices();
      renderCard({ manager });

      expect(screen.getByText("Your Notion login expired")).toBeTruthy();
      expect(screen.getByText("Reconnect, then ask the agent to try again.")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Not now" })).toBeNull();
      fireEvent.click(button("Reconnect"));

      await waitFor(() =>
        expect(auth.login).toHaveBeenCalledWith(
          expect.objectContaining({ connectionId: "c-notion" })
        )
      );
    });

    it(`${ISSUE} says Copilot couldn't reach a service whose login still works, without asking the user to log in again`, () => {
      setSettings({ connectors: [{ id: "c-notion", serviceId: "notion" }] });
      const { manager } = fakeServices(["c-notion"]);
      renderCard({ manager });

      act(() => manager.reportFailure("c-notion", "unreachable"));

      expect(screen.getByText("Couldn't reach Notion")).toBeTruthy();
      expect(screen.getByText("Copilot tries again in your next chat.")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
    });

    it(`${ISSUE} says why a login didn't finish and offers Try again`, async () => {
      const { manager, auth, finish } = fakeServices();
      renderCard({ manager });
      fireEvent.click(button("Connect"));
      await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());

      finish("Notion", { status: "failed", reason: "cancelled-on-service" });

      expect(await screen.findByText("Login was cancelled on Notion's page.")).toBeTruthy();
      fireEvent.click(button("Try again"));
      await waitFor(() => expect(auth.login).toHaveBeenCalledTimes(2));
    });

    it(`${ISSUE} keeps one login at a time, holding Connect while another service's login waits`, async () => {
      const { manager } = fakeServices();
      renderCard({ manager });

      act(() => void manager.connect("linear"));

      expect((button("Connect") as HTMLButtonElement).disabled).toBe(true);
      expect(button("Connect").parentElement?.getAttribute("title")).toBe(
        "Finish or cancel the Linear login first"
      );
    });

    it(`${ISSUE} offers plans instead of a login to a user without the Supporter preview`, () => {
      mockedEnabled.mockReturnValue(false);
      const { manager } = fakeServices();
      renderCard({ manager });

      expect(screen.getByText("Connect Notion with Connectors")).toBeTruthy();
      expect(screen.getByText("Connectors is a preview for Supporters.")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
      fireEvent.click(button("See plans"));

      expect(navigateToPlusPage).toHaveBeenCalledWith("connectors_chat");
    });
  });
});
