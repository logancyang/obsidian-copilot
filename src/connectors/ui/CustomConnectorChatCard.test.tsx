import { MAX_PROVIDED_TOOL_NAME_LENGTH } from "@/agentMode/session/copilotMcpServer";
import {
  ensureConnectorsEntitlement,
  useIsConnectorsEnabled,
} from "@/connectors/connectorsEntitlement";
import { CustomConnectors } from "@/connectors/custom/customConnectors";
import type { CustomConnectorConfig } from "@/connectors/custom/customConnectorConfig";
import { FakeProcess } from "@/connectors/custom/testing/fakeCustomProcess";
import { fakeKeychain } from "@/connectors/custom/testing/fakeKeychain";
import {
  CustomConnectorChatCard,
  CustomConnectorChatCardView,
  type ProposedCustomConnector,
} from "@/connectors/ui/CustomConnectorChatCard";
import { AppContext } from "@/context";
import { navigateToPlusPage } from "@/plusUtils";
import { getSettings, setSettings } from "@/settings/model";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "obsidian";
import React from "react";

jest.mock("@/connectors/connectorsEntitlement", () => ({
  ensureConnectorsEntitlement: jest.fn(),
  useIsConnectorsEnabled: jest.fn(),
}));
jest.mock("@/plusUtils", () => ({ navigateToPlusPage: jest.fn() }));
jest.mock("@/logger", () => ({ logWarn: jest.fn() }));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/871";
const COMMAND = "node /Users/me/servers/fake-notes/stdio-server.mjs --verbose";
const FAKE_NOTES: CustomConnectorConfig = {
  id: "fakenotes",
  name: "Fake Notes",
  command: "node",
  args: ["/Users/me/servers/fake-notes/stdio-server.mjs", "--verbose"],
  envNames: ["FAKE_KEY"],
};
const KEYCHAIN_ID = "copilot-vtestvault-custom-connector-fakenotes";

function setUp() {
  setSettings({ customConnectors: [] });
  const { keychain, secrets } = fakeKeychain();
  const device = new Map<string, unknown>();
  const custom = new CustomConnectors({
    keychain,
    deviceStorage: {
      load: (key) => device.get(key) ?? null,
      save: (key, value) => void device.set(key, value),
    },
    catalogIds: ["notion"],
    isEnabled: () => true,
    maxToolNameLength: MAX_PROVIDED_TOOL_NAME_LENGTH,
    startProcess: (options, crash) => new FakeProcess(options, crash),
  });
  return { custom, secrets };
}

function renderCard(
  custom: CustomConnectors,
  overrides: Partial<ProposedCustomConnector> = {}
): { onDismiss: jest.Mock; onAdded: jest.Mock; rerender: (card: ProposedCustomConnector) => void } {
  const onDismiss = jest.fn();
  const onAdded = jest.fn();
  const cardOf = (card: ProposedCustomConnector) => (
    <AppContext.Provider value={new App()}>
      <CustomConnectorChatCard
        card={card}
        customConnectors={custom}
        onDismiss={onDismiss}
        onAdded={onAdded}
      />
    </AppContext.Provider>
  );
  const card: ProposedCustomConnector = {
    proposal: FAKE_NOTES,
    updates: null,
    addedId: null,
    ...overrides,
  };
  const view = render(cardOf(card));
  return { onDismiss, onAdded, rerender: (next) => view.rerender(cardOf(next)) };
}

function button(name: string): HTMLButtonElement {
  return screen.getByRole("button", { name });
}

describe("CustomConnectorChatCard", () => {
  beforeEach(() => {
    jest.mocked(useIsConnectorsEnabled).mockReturnValue(true);
    jest.mocked(ensureConnectorsEntitlement).mockResolvedValue(true);
  });

  describe("CustomConnectorChatCard()", () => {
    it(`${ISSUE} shows the proposed connector with its whole command and a hidden input per key, and Add stays off until every key is typed`, () => {
      const { custom } = setUp();
      renderCard(custom);

      expect(screen.getByText("Add custom connector")).toBeTruthy();
      expect(screen.getByText("Fake Notes")).toBeTruthy();
      expect(screen.getByText(`Local · ${COMMAND}`).className).toContain("tw-break-all");
      const key = screen.getByLabelText<HTMLInputElement>("FAKE_KEY");
      expect(key.type).toBe("password");
      expect(button("Add").disabled).toBe(true);

      fireEvent.change(key, { target: { value: "typed-key" } });

      expect(button("Add").disabled).toBe(false);
    });

    it(`${ISSUE} adds the connector on Add, keeping the typed key in this device's keychain and only its name in settings, and records it on the card`, async () => {
      const { custom, secrets } = setUp();
      const { onAdded } = renderCard(custom);

      fireEvent.change(screen.getByLabelText("FAKE_KEY"), { target: { value: "typed-key" } });
      fireEvent.click(button("Add"));

      await waitFor(() => expect(onAdded).toHaveBeenCalledWith("fakenotes"));
      expect(getSettings().customConnectors).toEqual([FAKE_NOTES]);
      expect(JSON.stringify(getSettings())).not.toContain("typed-key");
      expect(secrets.get(KEYCHAIN_ID)).toBe(JSON.stringify({ FAKE_KEY: "typed-key" }));
    });

    it(`${ISSUE} adds nothing when the entitlement check fails`, async () => {
      jest.mocked(ensureConnectorsEntitlement).mockResolvedValue(false);
      const { custom } = setUp();
      const { onAdded } = renderCard(custom);

      fireEvent.change(screen.getByLabelText("FAKE_KEY"), { target: { value: "typed-key" } });
      fireEvent.click(button("Add"));

      await waitFor(() => expect(ensureConnectorsEntitlement).toHaveBeenCalled());
      expect(onAdded).not.toHaveBeenCalled();
      expect(getSettings().customConnectors).toEqual([]);
    });

    it(`${ISSUE} lets the user turn the proposal down with Not now`, () => {
      const { custom } = setUp();
      const { onDismiss } = renderCard(custom);

      fireEvent.click(button("Not now"));

      expect(onDismiss).toHaveBeenCalled();
    });

    it(`${ISSUE} follows the connector it added: connected with its tool count`, async () => {
      const { custom } = setUp();
      const parsed = custom.parse(
        JSON.stringify({ name: "Fake Notes", command: "node", env: { FAKE_KEY: "k" } })
      );
      if (parsed.ok) custom.add(parsed.connectors);

      renderCard(custom, { addedId: "fakenotes" });

      expect(
        await screen.findByText("Fake Notes connected with 2 tools. Every agent can use it now.")
      ).toBeTruthy();
    });

    it(`${ISSUE} says why the connector it added couldn't start, and that the agent can propose a fix`, async () => {
      const { custom } = setUp();
      const parsed = custom.parse(JSON.stringify({ name: "Fake Notes", command: "node" }));
      if (parsed.ok) custom.add(parsed.connectors);

      renderCard(custom, { proposal: { ...FAKE_NOTES, envNames: [] }, addedId: "fakenotes" });

      expect(await screen.findByText("Couldn't start · FAKE_KEY is not set")).toBeTruthy();
      expect(screen.getByText("Send a message and the agent can propose a fix.")).toBeTruthy();
    });

    it(`${ISSUE} updates the connector an earlier card in this chat added, keeping a stored key left blank`, async () => {
      const { custom, secrets } = setUp();
      const parsed = custom.parse(
        JSON.stringify({ name: "Fake Notes", command: "node", env: { FAKE_KEY: "first-key" } })
      );
      if (parsed.ok) custom.add(parsed.connectors);
      const { onAdded } = renderCard(custom, { updates: "fakenotes" });

      expect(screen.getByText("Update custom connector")).toBeTruthy();
      expect(screen.getByLabelText<HTMLInputElement>("FAKE_KEY").placeholder).toBe(
        "Leave blank to keep the stored value"
      );
      fireEvent.click(button("Update"));

      await waitFor(() => expect(onAdded).toHaveBeenCalledWith("fakenotes"));
      expect(getSettings().customConnectors).toEqual([FAKE_NOTES]);
      expect(secrets.get(KEYCHAIN_ID)).toBe(JSON.stringify({ FAKE_KEY: "first-key" }));
    });

    it(`${ISSUE} adds the connector again when the one it would update was removed in Settings`, async () => {
      const { custom } = setUp();
      const { onAdded } = renderCard(custom, { updates: "gone" });

      expect(screen.getByText("Add custom connector")).toBeTruthy();
      fireEvent.change(screen.getByLabelText("FAKE_KEY"), { target: { value: "typed-key" } });
      fireEvent.click(button("Add"));

      await waitFor(() => expect(onAdded).toHaveBeenCalledWith("fakenotes"));
    });

    it(`${ISSUE} offers plans instead of Add to a user without the Supporter preview`, () => {
      jest.mocked(useIsConnectorsEnabled).mockReturnValue(false);
      const { custom } = setUp();
      renderCard(custom);

      expect(screen.getByText("Add Fake Notes with Connectors")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
      fireEvent.click(button("See plans"));

      expect(navigateToPlusPage).toHaveBeenCalledWith("connectors_chat");
    });
  });

  describe("CustomConnectorChatCardView()", () => {
    const view = (status: React.ComponentProps<typeof CustomConnectorChatCardView>["status"]) =>
      render(
        <CustomConnectorChatCardView
          proposal={{ id: "acme", name: "Acme", url: "https://mcp.acme.test/mcp", headerNames: [] }}
          locked={false}
          updating={false}
          storedValueNames={new Set()}
          status={status}
          onAdd={jest.fn()}
          onDismiss={jest.fn()}
          onSeePlans={jest.fn()}
        />
      );

    it(`${ISSUE} shows a remote proposal's URL, and Add is on when it needs no key`, () => {
      view(null);

      expect(screen.getByText("Remote · https://mcp.acme.test/mcp")).toBeTruthy();
      expect(button("Add").disabled).toBe(false);
    });

    it(`${ISSUE} hands the typed keys to Add once and then clears the fields, so a later proposal reusing the card doesn't hold them`, () => {
      const onAdd = jest.fn();
      render(
        <CustomConnectorChatCardView
          proposal={FAKE_NOTES}
          locked={false}
          updating={false}
          storedValueNames={new Set()}
          status={null}
          onAdd={onAdd}
          onDismiss={jest.fn()}
          onSeePlans={jest.fn()}
        />
      );
      const key = screen.getByLabelText<HTMLInputElement>("FAKE_KEY");

      fireEvent.change(key, { target: { value: "typed-key" } });
      fireEvent.click(button("Add"));

      expect(onAdd).toHaveBeenCalledWith({ FAKE_KEY: "typed-key" });
      expect(key.value).toBe("");
    });

    it("shows a connector still starting without asking for a fix", () => {
      view({ kind: "starting" });

      expect(screen.getByText("Starting…")).toBeTruthy();
      expect(screen.queryByText("Send a message and the agent can propose a fix.")).toBeNull();
    });

    it(`${ISSUE} says a key wasn't accepted and that the agent can propose a fix`, () => {
      view({ kind: "key-not-accepted" });

      expect(screen.getByText("Key not accepted")).toBeTruthy();
      expect(screen.getByText("Send a message and the agent can propose a fix.")).toBeTruthy();
    });
  });
});
