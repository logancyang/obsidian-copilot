import type { AgentMcpServer } from "@/agentMode/session/types";
import { requireNodeModule } from "@/utils/desktopRuntime";
import {
  readRequestText,
  startLoopbackServer,
  writeJson,
  type LoopbackServer,
} from "@/utils/loopbackServer";

type IncomingMessage = import("node:http").IncomingMessage;
type ServerResponse = import("node:http").ServerResponse;

export const COPILOT_MCP_SERVER_NAME = "obsidian-copilot";
export const SEND_FEEDBACK_TOOL_NAME = "send_feedback";
export const CALLER_SESSION_ARGUMENT = "caller_session_id";

const MCP_PATH = "/mcp";
const MAX_REQUEST_BYTES = 64 * 1024;
const LATEST_PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_PROTOCOL_VERSIONS = new Set([
  "2025-11-25",
  LATEST_PROTOCOL_VERSION,
  "2025-03-26",
  "2024-11-05",
]);

export const SEND_FEEDBACK_TOOL = Object.freeze({
  name: SEND_FEEDBACK_TOOL_NAME,
  description: `Draft a bug report to the Copilot for Obsidian team at a high-signal moment: the user is frustrated with or complains about your behavior or Copilot; you retract a confident answer or notice your own mistake; a tool or product failure repeats; or a reasonable request is blocked by a missing capability. Not when the user vents about their own work or other topics.

The draft appears as a card the user reviews, edits, sends or dismisses; nothing is sent without their approval. The call returns at once: continue your reply and don't mention the card unless asked. At most once per problem.

Write only facts from this session, in English except user_said. Quote the user verbatim, never paraphrased into a stronger claim. Omit secrets and unrelated note content.`,
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "One-line summary, under 80 characters." },
      what_happened: {
        type: "string",
        description: "Observed vs. expected behavior; exact error text if short.",
      },
      user_said: {
        type: "string",
        description: "The user's words that prompted this, verbatim. Empty if they didn't comment.",
      },
      repro: { type: "string", description: "Minimal steps to reproduce." },
    },
    required: ["title", "what_happened", "repro"],
  },
  // Codex asks the user to approve MCP calls unless the tool is read-only, and drafting a card changes nothing.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/672
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  // Claude Code defers MCP tools behind tool search, hiding the description that says when to call it.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/672
  _meta: { "anthropic/alwaysLoad": true },
});

export interface FeedbackDraft {
  title: string;
  whatHappened: string;
  userSaid: string;
  repro: string;
}

export type FeedbackOfferResult = "shown" | "already_offered" | "turned_off" | "unattributed";

export type FeedbackOfferHandler = (
  draft: FeedbackDraft,
  callerSessionId: string | null
) => FeedbackOfferResult;

const OFFER_RESULT_TEXT: Readonly<Record<FeedbackOfferResult, string>> = Object.freeze({
  shown: "Shown to the user. Continue; don't mention it unless asked.",
  already_offered: `Already offered this session. Don't call ${SEND_FEEDBACK_TOOL_NAME} again.`,
  turned_off: `The user turned off feedback reports. Don't call ${SEND_FEEDBACK_TOOL_NAME} again.`,
  unattributed: `Copilot couldn't tell which chat this came from, so nothing was shown. Don't call ${SEND_FEEDBACK_TOOL_NAME} again.`,
});

const HOSTED_TOOLS = Object.freeze([
  Object.freeze({ definition: SEND_FEEDBACK_TOOL, turnedOffText: OFFER_RESULT_TEXT.turned_off }),
]);

type ToolSwitch = (toolName: string) => boolean;

export interface CopilotMcpServer {
  hasEnabledTools(): boolean;
  connect(sessionKey: string, onOffer: FeedbackOfferHandler): Promise<AgentMcpServer>;
  disconnect(sessionKey: string): void;
  dispose(): void;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

type JsonRpcReply = { result: unknown } | { error: { code: number; message: string } };

export function createCopilotMcpServer(isToolOn: ToolSwitch): CopilotMcpServer {
  const handlersByToken = new Map<string, FeedbackOfferHandler>();
  const tokensBySession = new Map<string, string>();
  let server: LoopbackServer | null = null;
  let disposed = false;

  return Object.freeze({
    hasEnabledTools(): boolean {
      return HOSTED_TOOLS.some((tool) => isToolOn(tool.definition.name));
    },
    async connect(sessionKey: string, onOffer: FeedbackOfferHandler): Promise<AgentMcpServer> {
      if (disposed) throw new Error("The Copilot MCP server is closed.");
      server ??= startLoopbackServer("Copilot MCP server", (request, response) =>
        handleHttpRequest(request, response, handlersByToken, isToolOn)
      );
      const url = `${await server.origin}${MCP_PATH}`;
      const crypto = requireNodeModule<typeof import("node:crypto")>("crypto");
      // A shared key keeps its token, so a later chat re-registering the server leaves the folder's connection on a valid token.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/672
      const token = tokensBySession.get(sessionKey) ?? crypto.randomBytes(32).toString("hex");
      tokensBySession.set(sessionKey, token);
      handlersByToken.set(token, onOffer);
      return Object.freeze({
        name: COPILOT_MCP_SERVER_NAME,
        url,
        headers: Object.freeze({ Authorization: `Bearer ${token}` }),
      });
    },
    disconnect(sessionKey: string): void {
      const token = tokensBySession.get(sessionKey);
      if (!token) return;
      tokensBySession.delete(sessionKey);
      handlersByToken.delete(token);
    },
    dispose(): void {
      disposed = true;
      handlersByToken.clear();
      tokensBySession.clear();
      server?.close();
      server = null;
    },
  });
}

async function handleHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  handlersByToken: ReadonlyMap<string, FeedbackOfferHandler>,
  isToolOn: ToolSwitch
): Promise<void> {
  if (request.url !== MCP_PATH) return writeJson(response, 404, { error: "Not found." });
  // Each session's token selects its own chat, so another vault, session or local page cannot raise a card in it.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/672
  const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? "")?.[1];
  const onOffer = token ? handlersByToken.get(token) : undefined;
  if (!onOffer) return writeJson(response, 401, { error: "Unauthorized." });
  // Copilot never pushes server-initiated messages, so the optional SSE stream is declined.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/672
  if (request.method !== "POST") return writeJson(response, 405, { error: "Method not allowed." });

  let message: JsonRpcRequest;
  try {
    message = JSON.parse(await readRequestText(request, MAX_REQUEST_BYTES)) as JsonRpcRequest;
  } catch (error) {
    return writeRpcError(response, -32700, error instanceof Error ? error.message : "Parse error.");
  }
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return writeRpcError(response, -32600, "Invalid request.");
  }
  if (message.id === undefined || typeof message.method !== "string") {
    response.writeHead(202).end();
    return;
  }
  writeJson(response, 200, {
    jsonrpc: "2.0",
    id: message.id,
    ...reply(message, onOffer, isToolOn),
  });
}

function reply(
  message: JsonRpcRequest,
  onOffer: FeedbackOfferHandler,
  isToolOn: ToolSwitch
): JsonRpcReply {
  switch (message.method) {
    case "initialize": {
      const requested = message.params?.protocolVersion;
      return {
        result: {
          protocolVersion:
            typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.has(requested)
              ? requested
              : LATEST_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: COPILOT_MCP_SERVER_NAME, version: "1.0.0" },
        },
      };
    }
    case "ping":
      return { result: {} };
    case "tools/list":
      return {
        result: {
          tools: HOSTED_TOOLS.filter((tool) => isToolOn(tool.definition.name)).map(
            (tool) => tool.definition
          ),
        },
      };
    case "tools/call":
      return { result: callTool(message.params ?? {}, onOffer, isToolOn) };
    default:
      return { error: { code: -32601, message: `Method not found: ${message.method}` } };
  }
}

function callTool(
  params: Record<string, unknown>,
  onOffer: FeedbackOfferHandler,
  isToolOn: ToolSwitch
) {
  const tool = HOSTED_TOOLS.find((hosted) => hosted.definition.name === params.name);
  if (!tool) return toolText(`Unknown tool: ${String(params.name)}`, true);
  // Agents read tools/list once per session, so a tool switched off mid-session still gets called; answering without an error stops the agent from retrying it.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/733
  if (!isToolOn(tool.definition.name)) return toolText(tool.turnedOffText, false);
  const draft = parseDraft(params.arguments);
  if (!draft) return toolText("title, what_happened and repro must be non-empty strings.", true);
  return toolText(OFFER_RESULT_TEXT[onOffer(draft, callerSessionId(params.arguments))], false);
}

function callerSessionId(args: unknown): string | null {
  const value = (args as Record<string, unknown>)[CALLER_SESSION_ARGUMENT];
  return typeof value === "string" && value ? value : null;
}

function parseDraft(args: unknown): FeedbackDraft | null {
  if (!args || typeof args !== "object") return null;
  const record = args as Record<string, unknown>;
  const field = (key: string) => {
    const value = record[key];
    return typeof value === "string" ? value.trim() : "";
  };
  const draft = {
    title: field("title"),
    whatHappened: field("what_happened"),
    userSaid: field("user_said"),
    repro: field("repro"),
  };
  return draft.title && draft.whatHappened && draft.repro ? draft : null;
}

function toolText(text: string, isError: boolean) {
  return { content: [{ type: "text", text }], isError };
}

function writeRpcError(response: ServerResponse, code: number, message: string): void {
  writeJson(response, 400, { jsonrpc: "2.0", id: null, error: { code, message } });
}
