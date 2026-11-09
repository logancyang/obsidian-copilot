import {
  defineChatExtension,
  type ChatStateHost,
  type ChatStateKey,
  type ChatView,
} from "@/agentMode/session/chatExtension";
import { CONNECTOR_SERVICES, type ConnectorCatalogEntry } from "@/connectors/catalog";
import type { ConnectorsSnapshot } from "@/connectors/connectionManager";
import { SUGGEST_CONNECTOR_TOOL_NAME } from "@/connectors/connectorTools";
import { USER_SENDER } from "@/constants";

export interface ConnectorCard {
  readonly serviceId: string;
  readonly afterUserTurn: number;
  readonly dismissed: boolean;
  readonly reported: ConnectorCardOutcome | null;
}

export type ConnectorCardOutcome = "connected" | "dismissed" | "ignored";

export type ConnectorCardResult = "shown" | "dismissed" | "unattributed";

export const EMPTY_CONNECTOR_CARDS: readonly ConnectorCard[] = Object.freeze([]);

export const CONNECTOR_CARDS: ChatStateKey<readonly ConnectorCard[]> = Object.freeze({
  id: "connector-cards",
  initial: EMPTY_CONNECTOR_CARDS,
});

const RESULT_TEXT: Readonly<
  Record<ConnectorCardResult, (name: string, loginExpired: boolean) => string>
> = Object.freeze({
  shown: (name, loginExpired) =>
    loginExpired
      ? `Shown to the user as a card below your reply to reconnect ${name}, whose login expired. End your reply now; their next message says whether they reconnected it.`
      : `Shown to the user as a card below your reply to connect ${name}. End your reply now; their next message says whether they connected it.`,
  dismissed: (name) =>
    `The user chose not to connect ${name} in this chat. Continue without it and don't suggest it again; they can connect it later in Settings → Connectors.`,
  unattributed: () => "Copilot couldn't tell which chat this came from, so nothing was shown.",
});

const OUTCOME_TEXT: Readonly<Record<ConnectorCardOutcome, (name: string) => string>> =
  Object.freeze({
    connected: (name) =>
      `The user connected ${name}. Use its tools; if none are listed yet, they appear once the user clicks Reload at the top of the chat, or in a new chat if no Reload is shown.`,
    dismissed: (name) =>
      `The user chose not to connect ${name}. Continue without it; they can connect it later in Settings → Connectors.`,
    ignored: (name) => `The user sent this message without connecting ${name}.`,
  });

export interface SuggestConnectorToolDeps {
  catalog: readonly ConnectorCatalogEntry[];
  getSnapshot: () => ConnectorsSnapshot;
  isEnabled: () => boolean;
}

export function createSuggestConnectorTool({
  catalog,
  getSnapshot,
  isEnabled,
}: SuggestConnectorToolDeps) {
  return Object.freeze({
    definition: Object.freeze({
      name: SUGGEST_CONNECTOR_TOOL_NAME,
      description: `Show the user a card to connect a service when their request needs one that has no tools listed, or when a service's tool says its login expired. Nothing connects until they click. Services: ${catalog.map(({ name }) => name).join(", ")}.`,
      inputSchema: {
        type: "object",
        properties: { service: { type: "string", enum: catalog.map(({ id }) => id) } },
        required: ["service"],
      },
      // Codex asks the user to approve MCP calls unless the tool is read-only, and showing a card changes nothing.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/860
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      // Claude Code defers MCP tools behind tool search, hiding the description that says when to call it.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/860
      _meta: { "anthropic/alwaysLoad": true },
    }),
    turnedOffText: "Connectors aren't available on this device.",
    call: async (args: unknown, chat: ChatStateHost | null) => {
      const serviceId = (args as { service?: unknown } | null)?.service;
      const service = catalog.find(({ id }) => id === serviceId);
      if (!service) {
        return {
          text: `service must be one of: ${catalog.map(({ id }) => id).join(", ")}.`,
          isError: true,
        };
      }
      const stored = isEnabled()
        ? getSnapshot().connections.find(({ serviceId }) => serviceId === service.id)
        : undefined;
      if (stored?.status === "connected") {
        return { text: OUTCOME_TEXT.connected(service.name), isError: false };
      }
      // An outage keeps the login, so a card asking to log in again would send the user through OAuth for nothing.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/860
      if (stored?.status === "unreachable") {
        return {
          text: `Copilot couldn't reach ${service.name} just now; its login still works, so no card was shown. Continue without it.`,
          isError: false,
        };
      }
      // The card asks a service with a stored login to reconnect, so the agent's reply must not call it unconnected.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/860
      return {
        text: RESULT_TEXT[chat ? showCardIn(chat, service.id) : "unattributed"](
          service.name,
          stored !== undefined
        ),
        isError: false,
      };
    },
  });
}

function showCardIn(chat: ChatStateHost, serviceId: string): ConnectorCardResult {
  let result: ConnectorCardResult = "shown";
  chat.updateChatState(CONNECTOR_CARDS, (cards, view) => {
    const shown = showConnectorCard(cards, serviceId, userTurnCount(view));
    result = shown.result;
    return shown.cards;
  });
  return result;
}

// A Reload gives the chat's messages new IDs, so a card kept across it is placed by its user turn.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/860
function userTurnCount(chat: ChatView): number {
  return chat.getDisplayMessages().filter((message) => message.sender === USER_SENDER).length;
}

export function createConnectorCardsExtension(isConnected: (serviceId: string) => boolean) {
  return defineChatExtension({
    key: CONNECTOR_CARDS,
    // A card that just connected a service is why the user reloads, and its outcome is still owed to the agent.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/860
    keepOnReload: true,
    beforePrompt: (cards) => {
      const taken = takeConnectorCardOutcomes(cards, isConnected);
      if (!taken.note) return null;
      return {
        note: taken.note,
        // A card shown or dismissed while the agent replies still has news for the next message.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/860
        delivered: (latest) =>
          latest.map((card) => {
            const index = cards.indexOf(card);
            return index === -1 ? card : taken.cards[index];
          }),
      };
    },
  });
}

export function isServiceConnected(snapshot: ConnectorsSnapshot, serviceId: string): boolean {
  return snapshot.connections.some(
    (connection) => connection.serviceId === serviceId && connection.status === "connected"
  );
}

// A card the agent asks for again moves down to the newest turn, and one the user turned down stays down.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/860
export function showConnectorCard(
  cards: readonly ConnectorCard[],
  serviceId: string,
  afterUserTurn: number
): { cards: readonly ConnectorCard[]; result: ConnectorCardResult } {
  const existing = cards.find((card) => card.serviceId === serviceId);
  if (existing?.dismissed) return { cards, result: "dismissed" };
  const card: ConnectorCard = { serviceId, afterUserTurn, dismissed: false, reported: null };
  return {
    cards: [...cards.filter((other) => other !== existing), card],
    result: "shown",
  };
}

export function dismissConnectorCard(
  cards: readonly ConnectorCard[],
  serviceId: string
): readonly ConnectorCard[] {
  return cards.map((card) =>
    card.serviceId === serviceId && !card.dismissed ? { ...card, dismissed: true } : card
  );
}

export function takeConnectorCardOutcomes(
  cards: readonly ConnectorCard[],
  isConnected: (serviceId: string) => boolean
): { cards: readonly ConnectorCard[]; note: string | null } {
  const lines: string[] = [];
  const next = cards.map((card) => {
    const outcome: ConnectorCardOutcome = card.dismissed
      ? "dismissed"
      : isConnected(card.serviceId)
        ? "connected"
        : "ignored";
    // A login that lapses after the card connected it is the next card's news, not this one's.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/860
    if (card.reported === "connected" || outcome === card.reported) return card;
    const name = CONNECTOR_SERVICES.get(card.serviceId)?.name ?? card.serviceId;
    lines.push(OUTCOME_TEXT[outcome](name));
    return { ...card, reported: outcome };
  });
  if (lines.length === 0) return { cards, note: null };
  return {
    cards: next,
    note: `<connector-cards>\n${lines.join("\n")}\n</connector-cards>`,
  };
}
