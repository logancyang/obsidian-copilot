import { logError } from "@/logger";
import type { AgentMcpServer } from "@/agentMode/session/types";
import { requireNodeModule } from "@/utils/desktopRuntime";

type HttpServer = import("node:http").Server;
type IncomingMessage = import("node:http").IncomingMessage;
type ServerResponse = import("node:http").ServerResponse;

export const FEEDBACK_MCP_SERVER_NAME = "obsidian-copilot";
export const SEND_FEEDBACK_TOOL_NAME = "send_feedback";

const MCP_PATH = "/mcp";
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_FIELD_CHARS = 8 * 1024;
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

export type FeedbackOfferResult = "shown" | "already_offered" | "turned_off";

export type FeedbackOfferHandler = (draft: FeedbackDraft) => FeedbackOfferResult;

const OFFER_RESULT_TEXT: Readonly<Record<FeedbackOfferResult, string>> = Object.freeze({
  shown: "Shown to the user. Continue; don't mention it unless asked.",
  already_offered: `Already offered this session. Don't call ${SEND_FEEDBACK_TOOL_NAME} again.`,
  turned_off: `The user turned off feedback reports. Don't call ${SEND_FEEDBACK_TOOL_NAME} again.`,
});

export interface FeedbackMcpServer {
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

export function createFeedbackMcpServer(): FeedbackMcpServer {
  const handlersByToken = new Map<string, FeedbackOfferHandler>();
  const tokensBySession = new Map<string, string>();
  let server: HttpServer | null = null;
  let urlPromise: Promise<string> | null = null;
  let disposed = false;

  const start = (): Promise<string> => {
    const http = requireNodeModule<typeof import("node:http")>("http");
    return new Promise((resolve, reject) => {
      const next = http.createServer((request, response) => {
        void handleHttpRequest(request, response, handlersByToken);
      });
      server = next;
      next.once("error", reject);
      next.listen(0, "127.0.0.1", () => {
        if (disposed) {
          next.close();
          reject(new Error("The feedback MCP server is closed."));
          return;
        }
        next.on("error", (error) => logError("[AgentMode] feedback MCP server failed", error));
        next.unref();
        const { port } = next.address() as import("node:net").AddressInfo;
        resolve(`http://127.0.0.1:${port}${MCP_PATH}`);
      });
    });
  };

  return Object.freeze({
    async connect(sessionKey: string, onOffer: FeedbackOfferHandler): Promise<AgentMcpServer> {
      if (disposed) throw new Error("The feedback MCP server is closed.");
      urlPromise ??= start();
      const url = await urlPromise;
      const crypto = requireNodeModule<typeof import("node:crypto")>("crypto");
      const token = crypto.randomBytes(32).toString("hex");
      tokensBySession.set(sessionKey, token);
      handlersByToken.set(token, onOffer);
      return Object.freeze({
        name: FEEDBACK_MCP_SERVER_NAME,
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
      urlPromise = null;
    },
  });
}

async function handleHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  handlersByToken: ReadonlyMap<string, FeedbackOfferHandler>
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
    message = JSON.parse(await readBody(request)) as JsonRpcRequest;
  } catch (error) {
    return writeJson(response, 400, {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: error instanceof Error ? error.message : "Parse error." },
    });
  }
  if (message.id === undefined || typeof message.method !== "string") {
    response.writeHead(202).end();
    return;
  }
  writeJson(response, 200, { jsonrpc: "2.0", id: message.id, ...reply(message, onOffer) });
}

function reply(message: JsonRpcRequest, onOffer: FeedbackOfferHandler): JsonRpcReply {
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
          serverInfo: { name: FEEDBACK_MCP_SERVER_NAME, version: "1.0.0" },
        },
      };
    }
    case "ping":
      return { result: {} };
    case "tools/list":
      return { result: { tools: [SEND_FEEDBACK_TOOL] } };
    case "tools/call":
      return { result: callTool(message.params ?? {}, onOffer) };
    default:
      return { error: { code: -32601, message: `Method not found: ${message.method}` } };
  }
}

function callTool(params: Record<string, unknown>, onOffer: FeedbackOfferHandler) {
  if (params.name !== SEND_FEEDBACK_TOOL_NAME) {
    return toolText(`Unknown tool: ${String(params.name)}`, true);
  }
  const draft = parseDraft(params.arguments);
  if (!draft) return toolText("title, what_happened and repro must be non-empty strings.", true);
  return toolText(OFFER_RESULT_TEXT[onOffer(draft)], false);
}

function parseDraft(args: unknown): FeedbackDraft | null {
  if (!args || typeof args !== "object") return null;
  const record = args as Record<string, unknown>;
  const field = (key: string) => {
    const value = record[key];
    return typeof value === "string" ? value.trim().slice(0, MAX_FIELD_CHARS) : "";
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

async function readBody(request: IncomingMessage): Promise<string> {
  request.setEncoding("utf8");
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > MAX_REQUEST_BYTES) throw new Error("Request body is too large.");
  }
  return body;
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
