import { CONNECTOR_SERVICES, type ConnectorCatalogEntry } from "@/connectors/catalog";
import type { ConnectorsSnapshot } from "@/connectors/connectionManager";
import { connectorRequestUrl } from "@/connectors/connectorLinks";
import type { CustomConnectorStatus } from "@/connectors/custom/customConnectors";
import {
  parseCustomConnectors,
  type CustomConnectorConfig,
} from "@/connectors/custom/customConnectorConfig";

export const SUGGEST_CONNECTOR_TOOL_NAME = "suggest_connector";
export const PROPOSE_CUSTOM_CONNECTOR_TOOL_NAME = "propose_custom_connector";

interface CardProgress {
  readonly afterUserTurn: number;
  readonly dismissed: boolean;
}

export interface ServiceConnectorCard extends CardProgress {
  readonly serviceId: string;
  readonly reported: ConnectorCardOutcome | null;
}

export interface CustomConnectorCard extends CardProgress {
  readonly proposal: CustomConnectorConfig;
  readonly updates: string | null;
  readonly addedId: string | null;
  readonly reported: CustomConnectorCardOutcome | null;
}

export type ConnectorCard = ServiceConnectorCard | CustomConnectorCard;

export type ConnectorCardOutcome = "connected" | "dismissed" | "ignored";

export type CustomConnectorCardOutcome = "dismissed" | "ignored" | CustomConnectorStatus["kind"];

export type ConnectorCardResult = "shown" | "dismissed" | "unattributed";

export type CustomConnectorCardResult = "add" | "update" | "unattributed";

export interface ConnectorCardCaller {
  showConnectorCard(serviceId: string): ConnectorCardResult;
  showCustomConnectorCard(proposal: CustomConnectorConfig): CustomConnectorCardResult;
}

export const UNATTRIBUTED_CARD_CALLER: ConnectorCardCaller = Object.freeze({
  showConnectorCard: () => "unattributed" as const,
  showCustomConnectorCard: () => "unattributed" as const,
});

export const EMPTY_CONNECTOR_CARDS: readonly ConnectorCard[] = Object.freeze([]);

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

const CUSTOM_FIX = `To fix it, call ${PROPOSE_CUSTOM_CONNECTOR_TOOL_NAME} again with the same name.`;
// A remote server's error can be a whole HTML page, which would flood the agent's next prompt.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/871
const MAX_REASON_LENGTH = 300;

const PROPOSAL_TEXT: Readonly<Record<CustomConnectorCardResult, (name: string) => string>> =
  Object.freeze({
    add: (name) =>
      `Shown to the user as a card below your reply to add ${name}; nothing runs until they click Add. End your reply now; their next message says what happened.`,
    update: (name) =>
      `Shown to the user as a card below your reply to update ${name}, which they added in this chat; nothing changes until they click Update. End your reply now; their next message says what happened.`,
    unattributed: () => RESULT_TEXT.unattributed("", false),
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
      description: `Show the user a card to connect a service when their request needs one that has no tools listed, or when a service's tool says its login expired. Nothing connects until they click. Services: ${catalog.map(({ name }) => name).join(", ")}. For any other service, call it with that service's name to learn the user's options.`,
      inputSchema: {
        type: "object",
        properties: { service: { type: "string", description: "The service's name." } },
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
    call: async (args: unknown, caller: ConnectorCardCaller) => {
      const asked = (args as { service?: unknown } | null)?.service;
      if (typeof asked !== "string" || !asked.trim()) {
        return { text: "service must be a service name.", isError: true };
      }
      const service = catalog.find(
        ({ id, name }) => id === asked || name.toLowerCase() === asked.trim().toLowerCase()
      );
      // A service outside the catalog can still be reached through a custom connector the agent sets up with the user.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/871
      if (!service) {
        const name = asked.trim();
        return {
          text: `${name} has no connector in Copilot. Offer the user three choices: set it up as a custom connector, either a local server command or a remote server URL with a key (ask which if they haven't said); request a connector from the Copilot team; or continue without it. For a custom connector, read the server's README with your own tools, check its prerequisites, then call ${PROPOSE_CUSTOM_CONNECTOR_TOOL_NAME}. Connector request link: ${connectorRequestUrl(name)}`,
          isError: false,
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
        text: RESULT_TEXT[caller.showConnectorCard(service.id)](service.name, stored !== undefined),
        isError: false,
      };
    },
  });
}

export const PROPOSE_CUSTOM_CONNECTOR_TOOL = Object.freeze({
  definition: Object.freeze({
    name: PROPOSE_CUSTOM_CONNECTOR_TOOL_NAME,
    description: `Show the user a card to add a custom connector for a service Copilot has no connector for: one local server (command, args, env) or remote server (url, headers) in the standard MCP config shape. First read the server's README with your own tools and check its prerequisites (for example that node, uvx or docker is installed). Give each env or header the server needs with the value "" and tell the user what to type for each; they type the values into the card and you never see them. Nothing is added or run until the user clicks Add. To fix a connector added from this chat, call this again with the same name.`,
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The connector's name, shown to the user." },
        command: { type: "string", description: "Local server: the command to run." },
        args: { type: "array", items: { type: "string" } },
        env: {
          type: "object",
          additionalProperties: { type: "string" },
          description: 'Local server: each environment variable it needs, with the value "".',
        },
        url: { type: "string", description: "Remote server: its Streamable HTTP URL." },
        headers: {
          type: "object",
          additionalProperties: { type: "string" },
          description: 'Remote server: each header it needs, with the value "".',
        },
      },
      required: ["name"],
    },
    // Codex asks the user to approve MCP calls unless the tool is read-only, and showing a card changes nothing until the user clicks Add.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/871
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    // Claude Code defers MCP tools behind tool search, hiding the description that teaches the config shape.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/871
    _meta: { "anthropic/alwaysLoad": true },
  }),
  turnedOffText: "Connectors aren't available on this device.",
  call: async (args: unknown, caller: ConnectorCardCaller) => {
    const {
      name,
      command,
      args: commandArgs,
      env,
      url,
      headers,
    } = (args ?? {}) as Record<string, unknown>;
    // Keys typed into the card go straight to the keychain, so a value the agent fills in would put a key in its own transcript.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/871
    const values = [env, headers].flatMap((field): unknown[] =>
      field && typeof field === "object" ? Object.values(field) : []
    );
    if (values.some((value) => value !== "")) {
      return {
        text: 'Leave every env and header value as "". The user types the values into the card, and you never see them.',
        isError: true,
      };
    }
    const parsed = parseCustomConnectors(
      JSON.stringify({ name, command, args: commandArgs, env, url, headers }),
      new Set()
    );
    if (!parsed.ok) return { text: parsed.error, isError: true };
    const [{ config }] = parsed.connectors;
    // A line break or a bidi or zero-width character would make the card show a command other than the one that runs.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/871
    const shown = "command" in config ? [config.command, ...config.args] : [config.url];
    if (shown.some((text) => /[\p{Cc}\p{Cf}]/u.test(text))) {
      return { text: "Use only visible characters in the command, args and url.", isError: true };
    }
    return {
      text: PROPOSAL_TEXT[caller.showCustomConnectorCard(config)](config.name),
      isError: false,
    };
  },
});

export function isServiceConnected(snapshot: ConnectorsSnapshot, serviceId: string): boolean {
  return snapshot.connections.some(
    (connection) => connection.serviceId === serviceId && connection.status === "connected"
  );
}

export function connectorCardKey(card: ConnectorCard): string {
  return "serviceId" in card ? card.serviceId : `custom:${card.proposal.name.toLowerCase()}`;
}

// A card the agent asks for again moves down to the newest turn, and one the user turned down stays down.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/860
export function showConnectorCard(
  cards: readonly ConnectorCard[],
  serviceId: string,
  afterUserTurn: number
): { cards: readonly ConnectorCard[]; result: ConnectorCardResult } {
  const existing = cards.find((card) => connectorCardKey(card) === serviceId);
  if (existing?.dismissed) return { cards, result: "dismissed" };
  const card: ConnectorCard = { serviceId, afterUserTurn, dismissed: false, reported: null };
  return {
    cards: [...cards.filter((other) => other !== existing), card],
    result: "shown",
  };
}

// A new proposal with the same name replaces the earlier card, and fixes the connector that card added instead of adding a second one.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/871
export function showCustomConnectorCard(
  cards: readonly ConnectorCard[],
  proposal: CustomConnectorConfig,
  afterUserTurn: number
): { cards: readonly ConnectorCard[]; result: "add" | "update" } {
  const card: CustomConnectorCard = {
    proposal,
    updates: null,
    addedId: null,
    afterUserTurn,
    dismissed: false,
    reported: null,
  };
  const existing = cards.find(
    (other): other is CustomConnectorCard => connectorCardKey(other) === connectorCardKey(card)
  );
  const updates = existing ? (existing.addedId ?? existing.updates) : null;
  return {
    cards: [...cards.filter((other) => other !== existing), { ...card, updates }],
    result: updates ? "update" : "add",
  };
}

export function dismissConnectorCard(
  cards: readonly ConnectorCard[],
  key: string
): readonly ConnectorCard[] {
  return cards.map((card) =>
    connectorCardKey(card) === key && !card.dismissed ? { ...card, dismissed: true } : card
  );
}

export function markConnectorCardAdded(
  cards: readonly ConnectorCard[],
  key: string,
  connectorId: string
): readonly ConnectorCard[] {
  return cards.map((card) =>
    "proposal" in card && connectorCardKey(card) === key ? { ...card, addedId: connectorId } : card
  );
}

export function takeConnectorCardOutcomes(
  cards: readonly ConnectorCard[],
  isConnected: (serviceId: string) => boolean,
  customStatus: (connectorId: string) => CustomConnectorStatus | undefined = () => undefined
): { cards: readonly ConnectorCard[]; note: string | null } {
  const lines: string[] = [];
  const next = cards.map((card): ConnectorCard => {
    // A login that lapses after the card connected it is the next card's news, not this one's.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/860
    if (card.reported === "connected") return card;
    if ("serviceId" in card) {
      const outcome: ConnectorCardOutcome = card.dismissed
        ? "dismissed"
        : isConnected(card.serviceId)
          ? "connected"
          : "ignored";
      if (outcome === card.reported) return card;
      const name = CONNECTOR_SERVICES.get(card.serviceId)?.name ?? card.serviceId;
      lines.push(OUTCOME_TEXT[outcome](name));
      return { ...card, reported: outcome };
    }
    const status = card.addedId ? customStatus(card.addedId) : undefined;
    const outcome: CustomConnectorCardOutcome = card.dismissed
      ? "dismissed"
      : (status?.kind ?? "ignored");
    if (outcome === card.reported) return card;
    lines.push(customOutcomeText(card, status));
    return { ...card, reported: outcome };
  });
  if (lines.length === 0) return { cards, note: null };
  return {
    cards: next,
    note: `<connector-cards>\n${lines.join("\n")}\n</connector-cards>`,
  };
}

function customOutcomeText(card: CustomConnectorCard, status: CustomConnectorStatus | undefined) {
  const { name } = card.proposal;
  const update = card.updates !== null;
  const did = `The user ${update ? "updated" : "added"} ${name}`;
  if (card.dismissed)
    return `The user chose not to ${update ? "update" : "add"} ${name}. Continue without it.`;
  switch (status?.kind) {
    case undefined:
      return `The user sent this message without ${update ? "updating" : "adding"} ${name}.`;
    case "connected":
      return `${did} and it connected (${status.tools.length} ${status.tools.length === 1 ? "tool" : "tools"}). Use its tools; if none are listed yet, they appear once the user clicks Reload at the top of the chat, or in a new chat if no Reload is shown.`;
    case "couldnt-start":
      return `${did}, but it couldn't start: ${shortReason(status.reason)}. ${CUSTOM_FIX}`;
    case "unreachable":
      return `${did}, but Copilot couldn't reach it: ${shortReason(status.reason)}. ${CUSTOM_FIX}`;
    case "key-not-accepted":
      return `${did}, but it didn't accept the key the user entered. ${CUSTOM_FIX}`;
    default:
      return `${did}; it's still starting.`;
  }
}

function shortReason(reason: string): string {
  return reason.length > MAX_REASON_LENGTH ? `${reason.slice(0, MAX_REASON_LENGTH)}…` : reason;
}
