import { CONNECTOR_CATALOG } from "@/connectors/catalog";
import type { ConnectionState, ConnectorsSnapshot } from "@/connectors/connectionManager";
import {
  CONNECTOR_CARDS,
  createConnectorCardsExtension,
  createSuggestConnectorTool,
  dismissConnectorCard,
  EMPTY_CONNECTOR_CARDS,
  showConnectorCard,
  takeConnectorCardOutcomes,
  type ConnectorCard,
} from "@/connectors/agentMode/connectorCards";
import { fakeChat, fakeChatView, type FakeChat } from "@/agentMode/session/testing/fakeChat";
import type { AgentChatMessage } from "@/agentMode/session/types";
import { USER_SENDER } from "@/constants";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/860";

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

const TRANSCRIPT: readonly AgentChatMessage[] = [
  { id: "u1", sender: USER_SENDER, message: "find my roadmap", isVisible: true, timestamp: null },
];

function chatWithCards(cards: readonly ConnectorCard[] = EMPTY_CONNECTOR_CARDS): FakeChat {
  const chat = fakeChat(fakeChatView(TRANSCRIPT));
  chat.updateChatState(CONNECTOR_CARDS, () => cards);
  return chat;
}

function cardsIn(chat: FakeChat): readonly ConnectorCard[] {
  return chat.readChatState(CONNECTOR_CARDS);
}

function card(serviceId: string, overrides: Partial<ConnectorCard> = {}): ConnectorCard {
  return {
    serviceId,
    afterUserTurn: 1,
    dismissed: false,
    reported: null,
    ...overrides,
  };
}

describe("connectorCards", () => {
  describe("createSuggestConnectorTool()", () => {
    it("offers a read-only, always-loaded tool that names only catalog services and takes one of their ids", () => {
      const { definition } = toolWith();

      expect(definition.name).toBe("suggest_connector");
      expect(definition.description).toContain("Notion, ");
      expect(definition.description).not.toMatch(/MCP/);
      expect(definition.inputSchema.properties.service.enum).toEqual(
        CONNECTOR_CATALOG.map(({ id }) => id)
      );
      expect(definition.annotations.readOnlyHint).toBe(true);
      expect(definition._meta["anthropic/alwaysLoad"]).toBe(true);
    });

    it("shows a card in the calling chat and tells the agent to end its reply until the user answers", async () => {
      const chat = chatWithCards();

      const result = await toolWith().call({ service: "notion" }, chat);

      expect(cardsIn(chat)).toEqual([card("notion")]);
      expect(result).toEqual({
        text: "Shown to the user as a card below your reply to connect Notion. End your reply now; their next message says whether they connected it.",
        isError: false,
      });
    });

    it(`${ISSUE} tells the agent not to ask again when the user already turned the card down in this chat, and points the user to Settings → Connectors instead`, async () => {
      const result = await toolWith().call(
        { service: "notion" },
        chatWithCards([card("notion", { dismissed: true })])
      );

      expect(result.text).toBe(
        "The user chose not to connect Notion in this chat. Continue without it and don't suggest it again; they can connect it later in Settings → Connectors."
      );
    });

    it("says nothing was shown when Copilot can't tell which chat called", async () => {
      const result = await toolWith().call({ service: "notion" }, null);

      expect(result.text).toBe(
        "Copilot couldn't tell which chat this came from, so nothing was shown."
      );
    });

    it(`${ISSUE} shows no card for a connected service and tells the agent to use its tools, mentioning Reload only for when they aren't listed yet`, async () => {
      const chat = chatWithCards();

      const result = await toolWith([{ id: "c1", serviceId: "notion", status: "connected" }]).call(
        { service: "notion" },
        chat
      );

      expect(cardsIn(chat)).toEqual([]);
      expect(result.text).toBe(
        "The user connected Notion. Use its tools; if none are listed yet, they appear once the user clicks Reload at the top of the chat, or in a new chat if no Reload is shown."
      );
    });

    it(`${ISSUE} shows a Reconnect card for a service whose login needs reconnecting, and tells the agent the login expired`, async () => {
      const chat = chatWithCards();

      const result = await toolWith([
        { id: "c1", serviceId: "notion", status: "needs-login" },
      ]).call({ service: "notion" }, chat);

      expect(cardsIn(chat)).toEqual([card("notion")]);
      expect(result.text).toBe(
        "Shown to the user as a card below your reply to reconnect Notion, whose login expired. End your reply now; their next message says whether they reconnected it."
      );
    });

    it(`${ISSUE} shows no card for a service Copilot couldn't reach, since its login still works, and tells the agent to continue without it`, async () => {
      const chat = chatWithCards();

      const result = await toolWith([
        { id: "c1", serviceId: "notion", status: "unreachable" },
      ]).call({ service: "notion" }, chat);

      expect(cardsIn(chat)).toEqual([]);
      expect(result.text).toBe(
        "Copilot couldn't reach Notion just now; its login still works, so no card was shown. Continue without it."
      );
    });

    it(`${ISSUE} shows the Connect card to a user without the Supporter preview even when a connection is stored`, async () => {
      const chat = chatWithCards();

      const result = await toolWith(
        [{ id: "c1", serviceId: "notion", status: "connected" }],
        false
      ).call({ service: "notion" }, chat);

      expect(cardsIn(chat)).toEqual([card("notion")]);
      expect(result.text).toMatch(
        /^Shown to the user as a card below your reply to connect Notion\./
      );
    });

    it("refuses a service outside the catalog without showing a card", async () => {
      const chat = chatWithCards();

      const result = await toolWith().call({ service: "gmail" }, chat);

      expect(cardsIn(chat)).toEqual([]);
      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/^service must be one of: airtable, apify,/);
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

  describe("dismissConnectorCard()", () => {
    it("dismisses only the named service's card", () => {
      expect(dismissConnectorCard([card("notion"), card("linear")], "notion")).toEqual([
        card("notion", { dismissed: true }),
        card("linear"),
      ]);
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

    it("has no note when there are no cards", () => {
      expect(takeConnectorCardOutcomes(EMPTY_CONNECTOR_CARDS, () => true)).toEqual({
        cards: EMPTY_CONNECTOR_CARDS,
        note: null,
      });
    });
  });

  describe("createConnectorCardsExtension()", () => {
    it(`${ISSUE} keeps a chat's cards across Reload`, () => {
      expect(createConnectorCardsExtension(() => false).keepOnReload).toBe(true);
    });

    describe("beforePrompt()", () => {
      it(`${ISSUE} adds what the user did with each card to their next message, and marks it told once delivered`, async () => {
        const extension = createConnectorCardsExtension((serviceId) => serviceId === "notion");
        const cards = [card("notion")];

        const prompt = (await extension.beforePrompt!(cards, fakeChatView()))!;

        expect(prompt.note).toContain("The user connected Notion.");
        const delivered = prompt.delivered(cards) as readonly ConnectorCard[];
        expect(delivered).toEqual([card("notion", { reported: "connected" })]);
        expect(await extension.beforePrompt!(delivered, fakeChatView())).toBeNull();
      });

      it(`${ISSUE} keeps a card shown while the agent replied unreported, so its news reaches the next message`, async () => {
        const extension = createConnectorCardsExtension(() => false);
        const cards = [card("notion")];
        const shownMidTurn = card("linear", { afterUserTurn: 2 });

        const delivered = (await extension.beforePrompt!(cards, fakeChatView()))!.delivered([
          ...cards,
          shownMidTurn,
        ]) as readonly ConnectorCard[];

        expect(delivered).toEqual([card("notion", { reported: "ignored" }), shownMidTurn]);
      });

      it("adds nothing when no card has news", async () => {
        expect(
          await createConnectorCardsExtension(() => false).beforePrompt!([], fakeChatView())
        ).toBeNull();
      });
    });
  });
});
