import type { ChatStateHost } from "@/agentMode/session/chatExtension";
import { offerFeedback } from "@/agentMode/session/feedback/feedbackOffer";
import type { AgentMcpServer, BackendId } from "@/agentMode/session/types";
import { logWarn } from "@/logger";
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
// Agents show a tool as mcp__obsidian-copilot__<name>, and some agents reject tool names over 64 characters.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/857
export const MAX_PROVIDED_TOOL_NAME_LENGTH = 64 - `mcp__${COPILOT_MCP_SERVER_NAME}__`.length;

const MCP_PATH = "/mcp";
// openartifacts_publish takes a whole page as an argument, and OpenArtifacts accepts pages up to 10 MB.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/746
const MAX_REQUEST_BYTES = 16 * 1024 * 1024;
const LATEST_PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_PROTOCOL_VERSIONS = new Set([
  "2025-11-25",
  LATEST_PROTOCOL_VERSION,
  "2025-03-26",
  "2024-11-05",
]);

export const SEND_FEEDBACK_TOOL = Object.freeze({
  name: SEND_FEEDBACK_TOOL_NAME,
  // OpenCode's Code Mode catalog shows only the first ~120 characters of this description, so the opening carries the exclusion.
  // https://github.com/logancyang/obsidian-copilot/issues/3866
  description: `Draft a bug report to the Copilot for Obsidian team when Copilot itself fails, never for your own mistakes, answers or edits, even if the user is frustrated with them. Copilot fails when an obsidian-copilot tool, Copilot skill or attached context errors, a tool you need is missing, or the user reports Copilot crashing, erroring or losing chat text. Not for the user venting about their own work or other topics.

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

export type FindCallingChat = (callerSessionId: string | null) => ChatStateHost | null;

const OFFER_RESULT_TEXT: Readonly<Record<FeedbackOfferResult, string>> = Object.freeze({
  shown: "Shown to the user. Continue; don't mention it unless asked.",
  already_offered: `Already offered this session. Don't call ${SEND_FEEDBACK_TOOL_NAME} again.`,
  turned_off: `The user turned off feedback reports. Don't call ${SEND_FEEDBACK_TOOL_NAME} again.`,
  unattributed: `Copilot couldn't tell which chat this came from, so nothing was shown. Don't call ${SEND_FEEDBACK_TOOL_NAME} again.`,
});

export interface HostedToolResult {
  text: string;
  isError: boolean;
  image?: { data: string; mimeType: string };
}

export interface McpToolDefinition {
  readonly name: string;
  readonly annotations?: { readonly readOnlyHint?: boolean };
}

export interface HostedTool {
  definition: McpToolDefinition;
  turnedOffText: string;
  call: (args: unknown, chat: ChatStateHost | null) => Promise<HostedToolResult>;
}

export interface ProvidedToolResult {
  content: readonly unknown[];
  isError: boolean;
}

export interface ToolListing {
  sessionKey: string;
  backendId: BackendId;
}

export interface ToolProvider {
  refresh(): Promise<void>;
  tools(listedBy?: ToolListing): readonly McpToolDefinition[];
  call(name: string, args: unknown): Promise<ProvidedToolResult> | null;
  forget(sessionKey: string): void;
  dispose(): Promise<void>;
}

interface SessionHandlers {
  findChat: FindCallingChat;
  listing: ToolListing;
}

const SEND_FEEDBACK_HOSTED_TOOL: HostedTool = Object.freeze({
  definition: SEND_FEEDBACK_TOOL,
  turnedOffText: OFFER_RESULT_TEXT.turned_off,
  call: async (args: unknown, chat: ChatStateHost | null) => {
    const draft = parseDraft(args);
    if (!draft) {
      return { text: "title, what_happened and repro must be non-empty strings.", isError: true };
    }
    return {
      text: OFFER_RESULT_TEXT[chat ? offerFeedback(chat, draft) : "unattributed"],
      isError: false,
    };
  },
});

type ToolSwitch = (toolName: string) => boolean;

export interface CopilotMcpServer {
  connect(
    sessionKey: string,
    backendId: BackendId,
    findChat: FindCallingChat
  ): Promise<AgentMcpServer>;
  readOnlyToolNames(): Promise<ReadonlyArray<string>>;
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

export function createCopilotMcpServer(
  isToolOn: ToolSwitch,
  tools: readonly HostedTool[],
  toolProvider?: ToolProvider
): CopilotMcpServer {
  const hostedTools: readonly HostedTool[] = Object.freeze([SEND_FEEDBACK_HOSTED_TOOL, ...tools]);
  const handlersByToken = new Map<string, SessionHandlers>();
  const tokensBySession = new Map<string, string>();
  let server: LoopbackServer | null = null;
  let disposed = false;
  const refreshProvidedTools = async (): Promise<void> =>
    toolProvider
      ?.refresh()
      .catch((error) => logWarn("[AgentMode] Couldn't refresh connector tools", error));
  const listReadOnlyToolNames = (): ReadonlyArray<string> =>
    Object.freeze(
      [...hostedTools.map((tool) => tool.definition), ...providedTools(hostedTools, toolProvider)]
        .filter((definition) => definition.annotations?.readOnlyHint === true)
        .map((definition) => definition.name)
    );

  return Object.freeze({
    async connect(
      sessionKey: string,
      backendId: BackendId,
      findChat: FindCallingChat
    ): Promise<AgentMcpServer> {
      if (disposed) throw new Error("The Copilot MCP server is closed.");
      server ??= startLoopbackServer("Copilot MCP server", (request, response) =>
        handleHttpRequest(request, response, handlersByToken, isToolOn, hostedTools, toolProvider)
      );
      // Agents read the tool list once per session, so each new session first brings connected services up to date.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/857
      const [origin] = await Promise.all([server.origin, refreshProvidedTools()]);
      const url = `${origin}${MCP_PATH}`;
      const crypto = requireNodeModule<typeof import("node:crypto")>("crypto");
      // A shared key keeps its token, so a later chat re-registering the server leaves the folder's connection on a valid token.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/672
      const token = tokensBySession.get(sessionKey) ?? crypto.randomBytes(32).toString("hex");
      tokensBySession.set(sessionKey, token);
      handlersByToken.set(token, { findChat, listing: { sessionKey, backendId } });
      return Object.freeze({
        name: COPILOT_MCP_SERVER_NAME,
        url,
        headers: Object.freeze({ Authorization: `Bearer ${token}` }),
        readOnlyToolNames: listReadOnlyToolNames(),
      });
    },
    async readOnlyToolNames(): Promise<ReadonlyArray<string>> {
      await refreshProvidedTools();
      return listReadOnlyToolNames();
    },
    disconnect(sessionKey: string): void {
      const token = tokensBySession.get(sessionKey);
      if (!token) return;
      tokensBySession.delete(sessionKey);
      handlersByToken.delete(token);
      toolProvider?.forget(sessionKey);
    },
    dispose(): void {
      disposed = true;
      handlersByToken.clear();
      tokensBySession.clear();
      server?.close();
      server = null;
      void toolProvider?.dispose();
    },
  });
}

async function handleHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  handlersByToken: ReadonlyMap<string, SessionHandlers>,
  isToolOn: ToolSwitch,
  hostedTools: readonly HostedTool[],
  toolProvider: ToolProvider | undefined
): Promise<void> {
  if (request.url !== MCP_PATH) return writeJson(response, 404, { error: "Not found." });
  // Each session's token selects its own chat, so another vault, session or local page cannot raise a card in it.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/672
  const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? "")?.[1];
  const handlers = token ? handlersByToken.get(token) : undefined;
  if (!handlers) return writeJson(response, 401, { error: "Unauthorized." });
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
    ...(await reply(message, handlers, isToolOn, hostedTools, toolProvider)),
  });
}

async function reply(
  message: JsonRpcRequest,
  handlers: SessionHandlers,
  isToolOn: ToolSwitch,
  hostedTools: readonly HostedTool[],
  toolProvider: ToolProvider | undefined
): Promise<JsonRpcReply> {
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
          tools: [
            ...hostedTools
              .filter((tool) => isToolOn(tool.definition.name))
              .map((tool) => tool.definition),
            ...providedTools(hostedTools, toolProvider, handlers.listing),
          ],
        },
      };
    case "tools/call":
      return {
        result: await callTool(message.params ?? {}, handlers, isToolOn, hostedTools, toolProvider),
      };
    default:
      return { error: { code: -32601, message: `Method not found: ${message.method}` } };
  }
}

// A custom connector can name a tool like one of Copilot's own, and a call by that name always reaches Copilot's tool.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/862
function providedTools(
  hostedTools: readonly HostedTool[],
  toolProvider: ToolProvider | undefined,
  listing?: ToolListing
): readonly McpToolDefinition[] {
  return (toolProvider?.tools(listing) ?? []).filter(
    ({ name }) => !hostedTools.some(({ definition }) => definition.name === name)
  );
}

async function callTool(
  params: Record<string, unknown>,
  { findChat }: SessionHandlers,
  isToolOn: ToolSwitch,
  hostedTools: readonly HostedTool[],
  toolProvider: ToolProvider | undefined
) {
  const { callerSessionId, args } = splitCaller(params.arguments);
  const tool = hostedTools.find((hosted) => hosted.definition.name === params.name);
  if (!tool) {
    const provided = toolProvider?.call(String(params.name), args);
    return provided ? await provided : toolText(`Unknown tool: ${String(params.name)}`, true);
  }
  // Agents read tools/list once per session, so a tool switched off mid-session still gets called; answering without an error stops the agent from retrying it.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/733
  if (!isToolOn(tool.definition.name)) return toolText(tool.turnedOffText, false);
  const result = await tool.call(args, findChat(callerSessionId));
  const reply = toolText(result.text, result.isError);
  return result.image
    ? { ...reply, content: [...reply.content, { type: "image", ...result.image }] }
    : reply;
}

// OpenCode stamps the calling session on every Copilot tool call, and a connected service must never receive that extra argument.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/672
function splitCaller(args: unknown): { callerSessionId: string | null; args: unknown } {
  if (!args || typeof args !== "object" || !(CALLER_SESSION_ARGUMENT in args)) {
    return { callerSessionId: null, args };
  }
  const { [CALLER_SESSION_ARGUMENT]: value, ...rest } = args as Record<string, unknown>;
  return { callerSessionId: typeof value === "string" && value ? value : null, args: rest };
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
