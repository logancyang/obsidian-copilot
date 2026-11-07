import { CONNECTOR_CATALOG } from "@/connectors/catalog";
import { ConnectionManager, type ConnectorAuthPort } from "@/connectors/connectionManager";
import { useIsConnectorsEnabled } from "@/connectors/connectorsEntitlement";
import type { AccessTokenResult } from "@/connectors/oauth/connectorAuth";
import { ConnectorsAttentionBanner } from "@/agentMode/ui/ConnectorsAttentionBanner";
import { AppContext } from "@/context";
import { setSettings } from "@/settings/model";
import { openCopilotSettings } from "@/settings/openSettings";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { App } from "obsidian";
import React from "react";

jest.mock("@/connectors/connectorsEntitlement", () => ({
  useIsConnectorsEnabled: jest.fn(),
}));
jest.mock("@/settings/openSettings", () => ({
  openCopilotSettings: jest.fn(),
}));

const mockedEnabled = jest.mocked(useIsConnectorsEnabled);
const mockedOpenSettings = jest.mocked(openCopilotSettings);

const BANNER_TEXT = "You have connectors that need your attention";
const LINEAR_CONNECTION = { id: "c-linear", serviceId: "linear" };

function linearManager(initial: AccessTokenResult["status"] = "connected") {
  let status: AccessTokenResult =
    initial === "connected" ? { status: "connected", accessToken: "token" } : { status: initial };
  const auth = {
    hasLogin: () => true,
    accessToken: jest.fn(async () => status),
    login: jest.fn(),
    disconnect: jest.fn(async () => {}),
  } satisfies ConnectorAuthPort;
  const manager = new ConnectionManager({ auth, catalog: CONNECTOR_CATALOG });
  return {
    manager,
    setStatus: (next: AccessTokenResult) => {
      status = next;
    },
  };
}

function renderBanner(manager: ConnectionManager | undefined) {
  const app = new App();
  render(
    <AppContext.Provider value={app}>
      <ConnectorsAttentionBanner manager={manager} />
    </AppContext.Provider>
  );
  return { app };
}

describe("ConnectorsAttentionBanner", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedEnabled.mockReturnValue(true);
    setSettings({ connectors: [LINEAR_CONNECTION] });
  });

  afterEach(() => {
    setSettings({ connectors: [] });
  });

  describe("ConnectorsAttentionBanner()", () => {
    it("shows nothing while every connector is connected", async () => {
      const { manager } = linearManager();
      renderBanner(manager);
      await act(() => manager.checkStatus());

      expect(screen.queryByText(BANNER_TEXT)).toBeNull();
    });

    it("appears when a connector's login is revoked and goes away once it is connected again, without a reload", async () => {
      const { manager, setStatus } = linearManager();
      renderBanner(manager);
      await act(() => manager.checkStatus());

      setStatus({ status: "needs-login" });
      await act(() => manager.accessToken(LINEAR_CONNECTION.id));
      expect(screen.getByText(BANNER_TEXT)).toBeTruthy();

      setStatus({ status: "connected", accessToken: "fresh" });
      await act(() => manager.accessToken(LINEAR_CONNECTION.id));
      expect(screen.queryByText(BANNER_TEXT)).toBeNull();
    });

    it("stays hidden when a connector only couldn't be reached, since Copilot retries it in the next chat (https://github.com/Brevilabs/obsidian-copilot-private/issues/859)", async () => {
      const { manager } = linearManager("unreachable");
      renderBanner(manager);
      await act(() => manager.checkStatus());

      expect(screen.queryByText(BANNER_TEXT)).toBeNull();
    });

    it("stays hidden for a non-Supporter and while the entitlement is still being verified (https://github.com/Brevilabs/obsidian-copilot-private/issues/859)", async () => {
      const { manager } = linearManager("needs-login");
      await manager.checkStatus();

      mockedEnabled.mockReturnValue(false);
      renderBanner(manager);
      mockedEnabled.mockReturnValue(undefined);
      renderBanner(manager);

      expect(screen.queryByText(BANNER_TEXT)).toBeNull();
    });

    it("shows nothing on mobile, where there is no connection manager (https://github.com/Brevilabs/obsidian-copilot-private/issues/859)", () => {
      renderBanner(undefined);

      expect(screen.queryByText(BANNER_TEXT)).toBeNull();
    });

    it("opens Settings → Connectors from its button", async () => {
      const { manager } = linearManager("needs-login");
      await manager.checkStatus();
      const { app } = renderBanner(manager);

      fireEvent.click(screen.getByRole("button", { name: "Manage" }));

      expect(mockedOpenSettings).toHaveBeenCalledWith(app, window, "connectors");
    });
  });
});
