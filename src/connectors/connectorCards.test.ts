import { CONNECTOR_CATALOG } from "@/connectors/catalog";
import type { ConnectionState, ConnectorsSnapshot } from "@/connectors/connectionManager";
import {
  connectorCardKey,
  createSuggestConnectorTool,
  dismissConnectorCard,
  EMPTY_CONNECTOR_CARDS,
  markConnectorCardAdded,
  PROPOSE_CUSTOM_CONNECTOR_TOOL,
  showConnectorCard,
  showCustomConnectorCard,
  takeConnectorCardOutcomes,
  type ConnectorCardResult,
  type CustomConnectorCard,
  type CustomConnectorCardResult,
  type ServiceConnectorCard,
} from "@/connectors/connectorCards";
import { connectorRequestUrl } from "@/connectors/connectorLinks";
import type { CustomConnectorStatus } from "@/connectors/custom/customConnectors";
import type { CustomConnectorConfig } from "@/connectors/custom/customConnectorConfig";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/860";
const CUSTOM_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/871";
const FAKE_NOTES: CustomConnectorConfig = {
  id: "fakenotes",
  name: "Fake Notes",
  command: "node",
  args: ["/srv/fake/stdio-server.mjs"],
  envNames: ["FAKE_KEY"],
};

function snapshotOf(connections: ConnectionState[]): ConnectorsSnapshot {
  return { connections, waitingLogin: null, failedLogin: null, needsAttention: false };
}

function toolWith(connections: ConnectionState[] = [], enabled = true) {
  return createSuggestConnectorTool({
    catalog: CONNECTOR_CATALOG,
    getSnapshot: () => snapshotOf(connections),
    isEnabled: () => enabled,
  });
}

function callerAnswering(
  result: ConnectorCardResult,
  customResult: CustomConnectorCardResult = "add"
) {
  return {
    showConnectorCard: jest.fn(() => result),
    showCustomConnectorCard: jest.fn(() => customResult),
  };
}

function card(
  serviceId: string,
  overrides: Partial<ServiceConnectorCard> = {}
): ServiceConnectorCard {
  return {
    serviceId,
    afterUserTurn: 1,
    dismissed: false,
    reported: null,
    ...overrides,
  };
}

function customCard(overrides: Partial<CustomConnectorCard> = {}): CustomConnectorCard {
  return {
    proposal: FAKE_NOTES,
    updates: null,
    addedId: null,
    afterUserTurn: 1,
    dismissed: false,
    reported: null,
    ...overrides,
  };
}

function statusOf(statuses: Record<string, CustomConnectorStatus>) {
  return (id: string): CustomConnectorStatus | undefined => statuses[id];
}

describe("connectorCards", () => {
  describe("createSuggestConnectorTool()", () => {
    it(`${CUSTOM_ISSUE} offers a read-only, always-loaded tool that names the catalog services and takes any service name, so a service outside the catalog can be asked for too`, () => {
      const { definition } = toolWith();

      expect(definition.name).toBe("suggest_connector");
      expect(definition.description).toContain("Notion, ");
      expect(definition.description).not.toMatch(/MCP/);
      expect(definition.inputSchema.properties.service).toEqual({
        type: "string",
        description: "The service's name.",
      });
      expect(definition.annotations.readOnlyHint).toBe(true);
      expect(definition._meta["anthropic/alwaysLoad"]).toBe(true);
    });

    it(`${CUSTOM_ISSUE} finds a catalog service by its name as well as its id`, async () => {
      const caller = callerAnswering("shown");

      await toolWith().call({ service: "notion" }, caller);
      await toolWith().call({ service: "Notion" }, caller);

      expect(caller.showConnectorCard.mock.calls).toEqual([["notion"], ["notion"]]);
    });

    it("shows a card in the calling chat and tells the agent to end its reply until the user answers", async () => {
      const caller = callerAnswering("shown");

      const result = await toolWith().call({ service: "notion" }, caller);

      expect(caller.showConnectorCard).toHaveBeenCalledWith("notion");
      expect(result).toEqual({
        text: "Shown to the user as a card below your reply to connect Notion. End your reply now; their next message says whether they connected it.",
        isError: false,
      });
    });

    it(`${ISSUE} tells the agent not to ask again when the user already turned the card down in this chat, and points the user to Settings → Connectors instead`, async () => {
      const result = await toolWith().call({ service: "notion" }, callerAnswering("dismissed"));

      expect(result.text).toBe(
        "The user chose not to connect Notion in this chat. Continue without it and don't suggest it again; they can connect it later in Settings → Connectors."
      );
    });

    it("says nothing was shown when Copilot can't tell which chat called", async () => {
      const result = await toolWith().call({ service: "notion" }, callerAnswering("unattributed"));

      expect(result.text).toBe(
        "Copilot couldn't tell which chat this came from, so nothing was shown."
      );
    });

    it(`${ISSUE} shows no card for a connected service and tells the agent to use its tools, mentioning Reload only for when they aren't listed yet`, async () => {
      const caller = callerAnswering("shown");

      const result = await toolWith([{ id: "c1", serviceId: "notion", status: "connected" }]).call(
        { service: "notion" },
        caller
      );

      expect(caller.showConnectorCard).not.toHaveBeenCalled();
      expect(result.text).toBe(
        "The user connected Notion. Use its tools; if none are listed yet, they appear once the user clicks Reload at the top of the chat, or in a new chat if no Reload is shown."
      );
    });

    it(`${ISSUE} shows a Reconnect card for a service whose login needs reconnecting, and tells the agent the login expired`, async () => {
      const caller = callerAnswering("shown");

      const result = await toolWith([
        { id: "c1", serviceId: "notion", status: "needs-login" },
      ]).call({ service: "notion" }, caller);

      expect(caller.showConnectorCard).toHaveBeenCalledWith("notion");
      expect(result.text).toBe(
        "Shown to the user as a card below your reply to reconnect Notion, whose login expired. End your reply now; their next message says whether they reconnected it."
      );
    });

    it(`${ISSUE} shows no card for a service Copilot couldn't reach, since its login still works, and tells the agent to continue without it`, async () => {
      const caller = callerAnswering("shown");

      const result = await toolWith([
        { id: "c1", serviceId: "notion", status: "unreachable" },
      ]).call({ service: "notion" }, caller);

      expect(caller.showConnectorCard).not.toHaveBeenCalled();
      expect(result.text).toBe(
        "Copilot couldn't reach Notion just now; its login still works, so no card was shown. Continue without it."
      );
    });

    it(`${ISSUE} shows the Connect card to a user without the Supporter preview even when a connection is stored`, async () => {
      const caller = callerAnswering("shown");

      const result = await toolWith(
        [{ id: "c1", serviceId: "notion", status: "connected" }],
        false
      ).call({ service: "notion" }, caller);

      expect(caller.showConnectorCard).toHaveBeenCalledWith("notion");
      expect(result.text).toMatch(
        /^Shown to the user as a card below your reply to connect Notion\./
      );
    });

    it(`${CUSTOM_ISSUE} answers a service outside the catalog with three choices: a custom connector (asking local or remote), a connector request link, or continuing without it`, async () => {
      const caller = callerAnswering("shown");

      const result = await toolWith().call({ service: "Fake Notes" }, caller);

      expect(caller.showConnectorCard).not.toHaveBeenCalled();
      expect(result).toEqual({
        text: `Fake Notes has no connector in Copilot. Offer the user three choices: set it up as a custom connector, either a local server command or a remote server URL with a key (ask which if they haven't said); request a connector from the Copilot team; or continue without it. For a custom connector, read the server's README with your own tools, check its prerequisites, then call propose_custom_connector. Connector request link: ${connectorRequestUrl("Fake Notes")}`,
        isError: false,
      });
    });

    it("asks for the service's name when the call names none", async () => {
      const result = await toolWith().call({}, callerAnswering("shown"));

      expect(result).toEqual({ text: "service must be a service name.", isError: true });
    });
  });

  describe("PROPOSE_CUSTOM_CONNECTOR_TOOL", () => {
    it(`${CUSTOM_ISSUE} offers a read-only, always-loaded tool that takes one server in the standard config shape and teaches blank values and research`, () => {
      const { definition } = PROPOSE_CUSTOM_CONNECTOR_TOOL;

      expect(definition.name).toBe("propose_custom_connector");
      expect(Object.keys(definition.inputSchema.properties)).toEqual([
        "name",
        "command",
        "args",
        "env",
        "url",
        "headers",
      ]);
      expect(definition.inputSchema.required).toEqual(["name"]);
      expect(definition.description).toContain("README");
      expect(definition.description).toContain('""');
      expect(definition.annotations.readOnlyHint).toBe(true);
      expect(definition._meta["anthropic/alwaysLoad"]).toBe(true);
    });

    it(`${CUSTOM_ISSUE} shows an Add card for a local server with its env names only, and tells the agent nothing runs until the user clicks Add`, async () => {
      const caller = callerAnswering("shown");

      const result = await PROPOSE_CUSTOM_CONNECTOR_TOOL.call(
        {
          name: "Fake Notes",
          command: "node",
          args: ["/srv/fake/stdio-server.mjs"],
          env: { FAKE_KEY: "" },
          caller_session_id: "ses_1",
        },
        caller
      );

      expect(caller.showCustomConnectorCard).toHaveBeenCalledWith(FAKE_NOTES);
      expect(result).toEqual({
        text: "Shown to the user as a card below your reply to add Fake Notes; nothing runs until they click Add. End your reply now; their next message says what happened.",
        isError: false,
      });
    });

    it(`${CUSTOM_ISSUE} shows a card for a remote server with its header names only`, async () => {
      const caller = callerAnswering("shown");

      await PROPOSE_CUSTOM_CONNECTOR_TOOL.call(
        { name: "Acme", url: "https://mcp.acme.test/mcp", headers: { Authorization: "" } },
        caller
      );

      expect(caller.showCustomConnectorCard).toHaveBeenCalledWith({
        id: "acme",
        name: "Acme",
        url: "https://mcp.acme.test/mcp",
        headerNames: ["Authorization"],
      });
    });

    it(`${CUSTOM_ISSUE} tells the agent its card updates the connector the user added from this chat`, async () => {
      const result = await PROPOSE_CUSTOM_CONNECTOR_TOOL.call(
        { name: "Fake Notes", command: "node" },
        callerAnswering("shown", "update")
      );

      expect(result.text).toBe(
        "Shown to the user as a card below your reply to update Fake Notes, which they added in this chat; nothing changes until they click Update. End your reply now; their next message says what happened."
      );
    });

    it.each([
      ["an env value", { command: "node", env: { FAKE_KEY: "sk-123" } }],
      [
        "a header value",
        { url: "https://mcp.acme.test/mcp", headers: { Authorization: "Bearer x" } },
      ],
    ])(
      `${CUSTOM_ISSUE} refuses a proposal with %s filled in, without showing a card, so key values never pass through the agent`,
      async (_label, server) => {
        const caller = callerAnswering("shown");

        const result = await PROPOSE_CUSTOM_CONNECTOR_TOOL.call(
          { name: "Fake Notes", ...server },
          caller
        );

        expect(caller.showCustomConnectorCard).not.toHaveBeenCalled();
        expect(result).toEqual({
          text: 'Leave every env and header value as "". The user types the values into the card, and you never see them.',
          isError: true,
        });
      }
    );

    it.each([
      ["a line break in an arg", { command: "node", args: ["server.js\nrm -rf ~"] }],
      ["a right-to-left override in the command", { command: "node‮sj.revres" }],
      ["a zero-width space in the url", { url: "https://mcp.acme​.test/mcp" }],
    ])(
      `${CUSTOM_ISSUE} refuses a proposal with %s, without showing a card, so the card never shows a command other than the one that runs`,
      async (_label, server) => {
        const caller = callerAnswering("shown");

        const result = await PROPOSE_CUSTOM_CONNECTOR_TOOL.call(
          { name: "Fake Notes", ...server },
          caller
        );

        expect(caller.showCustomConnectorCard).not.toHaveBeenCalled();
        expect(result).toEqual({
          text: "Use only visible characters in the command, args and url.",
          isError: true,
        });
      }
    );

    it("refuses a proposal with neither a command nor a url, saying what's wrong", async () => {
      const caller = callerAnswering("shown");

      const result = await PROPOSE_CUSTOM_CONNECTOR_TOOL.call({ name: "Fake Notes" }, caller);

      expect(caller.showCustomConnectorCard).not.toHaveBeenCalled();
      expect(result.isError).toBe(true);
      expect(result.text).toContain('"command" or "url"');
    });

    it("says nothing was shown when Copilot can't tell which chat called", async () => {
      const result = await PROPOSE_CUSTOM_CONNECTOR_TOOL.call(
        { name: "Fake Notes", command: "node" },
        callerAnswering("shown", "unattributed")
      );

      expect(result.text).toBe(
        "Copilot couldn't tell which chat this came from, so nothing was shown."
      );
    });
  });

  describe("showConnectorCard()", () => {
    it("adds a card for the service after the given user turn", () => {
      const { cards, result } = showConnectorCard(EMPTY_CONNECTOR_CARDS, "notion", 1);

      expect(result).toBe("shown");
      expect(cards).toEqual([card("notion")]);
    });

    it(`${ISSUE} keeps one card per service, moving it after the newest user turn and clearing what was reported`, () => {
      const before = [card("notion", { reported: "ignored" }), card("linear")];

      const { cards, result } = showConnectorCard(before, "notion", 3);

      expect(result).toBe("shown");
      expect(cards).toEqual([card("linear"), card("notion", { afterUserTurn: 3 })]);
    });

    it(`${ISSUE} leaves a dismissed card dismissed and answers dismissed`, () => {
      const before = [card("notion", { dismissed: true })];

      const { cards, result } = showConnectorCard(before, "notion", 3);

      expect(result).toBe("dismissed");
      expect(cards).toBe(before);
    });
  });

  describe("showCustomConnectorCard()", () => {
    it(`${CUSTOM_ISSUE} adds a card proposing the connector after the given user turn`, () => {
      const { cards, result } = showCustomConnectorCard([card("notion")], FAKE_NOTES, 2);

      expect(result).toBe("add");
      expect(cards).toEqual([card("notion"), customCard({ afterUserTurn: 2 })]);
    });

    it(`${CUSTOM_ISSUE} turns a new proposal with the same name into an update of the connector an earlier card added, replacing that card`, () => {
      const fixed = { ...FAKE_NOTES, args: ["/srv/fake/fixed.mjs"] };
      const before = [customCard({ addedId: "fakenotes", reported: "couldnt-start" })];

      const { cards, result } = showCustomConnectorCard(
        before,
        { ...fixed, name: "fake notes" },
        3
      );

      expect(result).toBe("update");
      expect(cards).toEqual([
        customCard({
          proposal: { ...fixed, name: "fake notes" },
          updates: "fakenotes",
          afterUserTurn: 3,
        }),
      ]);
    });

    it(`${CUSTOM_ISSUE} replaces a card the user hasn't clicked with the new proposal, still as an add`, () => {
      const { cards, result } = showCustomConnectorCard(
        [customCard({ dismissed: true })],
        FAKE_NOTES,
        3
      );

      expect(result).toBe("add");
      expect(cards).toEqual([customCard({ afterUserTurn: 3 })]);
    });
  });

  describe("connectorCardKey()", () => {
    it("keys a service card by its service and a custom card by its name, ignoring case", () => {
      expect(connectorCardKey(card("notion"))).toBe("notion");
      expect(connectorCardKey(customCard())).toBe(
        connectorCardKey(customCard({ proposal: { ...FAKE_NOTES, name: "FAKE NOTES" } }))
      );
      expect(connectorCardKey(customCard())).not.toBe("fakenotes");
    });
  });

  describe("dismissConnectorCard()", () => {
    it("dismisses only the card with the given key", () => {
      const custom = customCard();

      expect(
        dismissConnectorCard([card("notion"), card("linear"), custom], connectorCardKey(custom))
      ).toEqual([card("notion"), card("linear"), customCard({ dismissed: true })]);
      expect(dismissConnectorCard([card("notion"), card("linear")], "notion")).toEqual([
        card("notion", { dismissed: true }),
        card("linear"),
      ]);
    });
  });

  describe("markConnectorCardAdded()", () => {
    it(`${CUSTOM_ISSUE} records which connector the user's click added on that custom card only`, () => {
      const other = customCard({ proposal: { ...FAKE_NOTES, name: "Other" } });

      expect(
        markConnectorCardAdded(
          [card("notion"), customCard(), other],
          connectorCardKey(customCard()),
          "fakenotes2"
        )
      ).toEqual([card("notion"), customCard({ addedId: "fakenotes2" }), other]);
    });
  });

  describe("takeConnectorCardOutcomes()", () => {
    it(`${ISSUE} tells the agent, once, which cards the user connected, dismissed (pointing to Settings → Connectors, since the card is gone) or ignored`, () => {
      const before = [card("notion"), card("linear", { dismissed: true }), card("todoist")];
      const isConnected = (serviceId: string) => serviceId === "notion";

      const first = takeConnectorCardOutcomes(before, isConnected);
      const second = takeConnectorCardOutcomes(first.cards, isConnected);

      expect(first.note).toBe(
        [
          "<connector-cards>",
          "The user connected Notion. Use its tools; if none are listed yet, they appear once the user clicks Reload at the top of the chat, or in a new chat if no Reload is shown.",
          "The user chose not to connect Linear. Continue without it; they can connect it later in Settings → Connectors.",
          "The user sent this message without connecting Todoist.",
          "</connector-cards>",
        ].join("\n")
      );
      expect(second.note).toBeNull();
      expect(second.cards).toBe(first.cards);
    });

    it("reports a card the user ignored at first and connected later", () => {
      const ignored = takeConnectorCardOutcomes([card("notion")], () => false);

      const later = takeConnectorCardOutcomes(ignored.cards, () => true);

      expect(later.note).toContain("The user connected Notion.");
    });

    it(`${ISSUE} doesn't report a connected card as ignored after its login lapses`, () => {
      const connected = takeConnectorCardOutcomes([card("notion")], () => true);

      expect(takeConnectorCardOutcomes(connected.cards, () => false).note).toBeNull();
    });

    it(`${CUSTOM_ISSUE} tells the agent, once, what came of each custom connector card: connected with its tools, couldn't start or reach with the reason and how to fix it, key not accepted, not now, or ignored`, () => {
      const named = (name: string, overrides: Partial<CustomConnectorCard> = {}) =>
        customCard({ proposal: { ...FAKE_NOTES, name }, ...overrides });
      const before = [
        named("Up", { addedId: "up" }),
        named("Broken", { addedId: "broken" }),
        named("Gone", { addedId: "gone" }),
        named("Locked", { addedId: "locked" }),
        named("Fixed", { addedId: "fixed", updates: "fixed" }),
        named("Declined", { dismissed: true }),
        named("Unclicked"),
      ];
      const customStatus = statusOf({
        up: { kind: "connected", toolCount: 2 },
        broken: { kind: "couldnt-start", reason: "fake-custom: FAKE_KEY is not set" },
        gone: { kind: "unreachable", reason: "connect ECONNREFUSED 127.0.0.1:8887" },
        locked: { kind: "key-not-accepted" },
        fixed: { kind: "connected", toolCount: 1 },
      });

      const first = takeConnectorCardOutcomes(before, () => false, customStatus);
      const second = takeConnectorCardOutcomes(first.cards, () => false, customStatus);

      expect(first.note).toBe(
        [
          "<connector-cards>",
          "The user added Up and it connected (2 tools). Use its tools; if none are listed yet, they appear once the user clicks Reload at the top of the chat, or in a new chat if no Reload is shown.",
          "The user added Broken, but it couldn't start: fake-custom: FAKE_KEY is not set. To fix it, call propose_custom_connector again with the same name.",
          "The user added Gone, but Copilot couldn't reach it: connect ECONNREFUSED 127.0.0.1:8887. To fix it, call propose_custom_connector again with the same name.",
          "The user added Locked, but it didn't accept the key the user entered. To fix it, call propose_custom_connector again with the same name.",
          "The user updated Fixed and it connected (1 tool). Use its tools; if none are listed yet, they appear once the user clicks Reload at the top of the chat, or in a new chat if no Reload is shown.",
          "The user chose not to add Declined. Continue without it.",
          "The user sent this message without adding Unclicked.",
          "</connector-cards>",
        ].join("\n")
      );
      expect(second.note).toBeNull();
    });

    it(`${CUSTOM_ISSUE} says a custom connector is still starting, then reports it again once it connects`, () => {
      const added = [customCard({ addedId: "fakenotes" })];

      const starting = takeConnectorCardOutcomes(
        added,
        () => false,
        statusOf({ fakenotes: { kind: "starting" } })
      );
      const later = takeConnectorCardOutcomes(
        starting.cards,
        () => false,
        statusOf({ fakenotes: { kind: "connected", toolCount: 2 } })
      );

      expect(starting.note).toContain("The user added Fake Notes; it's still starting.");
      expect(later.note).toContain("The user added Fake Notes and it connected (2 tools).");
    });

    it(`${CUSTOM_ISSUE} shortens a reason as long as a whole error page`, () => {
      const note = takeConnectorCardOutcomes(
        [customCard({ addedId: "fakenotes" })],
        () => false,
        statusOf({ fakenotes: { kind: "unreachable", reason: "x".repeat(1000) } })
      ).note;

      expect(note).toContain(`couldn't reach it: ${"x".repeat(300)}…. To fix it`);
    });

    it("has no note when there are no cards", () => {
      expect(takeConnectorCardOutcomes(EMPTY_CONNECTOR_CARDS, () => true)).toEqual({
        cards: EMPTY_CONNECTOR_CARDS,
        note: null,
      });
    });
  });
});
